import { type Prisma, PrismaClient } from "../prisma/generated/client.ts";
import { exists } from "jsr:@std/fs/exists";
import { walk } from "jsr:@std/fs/walk";
import { createDatabaseSeeder } from "../src/shared/utils/databaseSeeder.ts";
import { getLogger } from "jsr:@std/log";
import { load } from "jsr:@std/dotenv";

const logger = getLogger();

interface TokenRecord {
  text: string;
  pos?: string | null;
}

interface LyricJsonlRecord {
  id: string;
  text: string;
  structure: {
    line_index: number;
    char_count: number;
  };
  semantics: {
    themes: string[];
    sentiment: string | null;
    keywords: string[];
  };
  prosody: {
    tone_pattern: number[];
    tone_pattern_cantonese_jyutping: string[];
  };
  nlp: {
    tokens: TokenRecord[];
    syntax_notes: string | null;
  };
  source: {
    title: string;
    artists: string[];
    lyricists: string[];
    year: number | null;
  };
  context_links: {
    doc_id: string;
    prev_line_id: string | null;
    next_line_id: string | null;
    paragraph_id: string | null;
  };
}

interface EntityCaches {
  artists: Map<string, bigint>;
  lyricists: Map<string, bigint>;
  themes: Map<string, bigint>;
  keywords: Map<string, bigint>;
}

interface ProcessLyricResult {
  docId: string;
  songCreated: boolean;
  linesCreated: number;
}

interface JyutpingResources {
  sortedConsonants: string[];
  consonantSet: Set<string>;
  rhymeSet: Set<string>;
}

interface JyutpingSplitResult {
  normalized: string | null;
  consonant: string | null;
  rhyme: string | null;
  toneRaw: number | null;
  toneDigit: number | null;
}

const TONE_DIGIT_MAP: Record<number, number> = { 1: 3, 2: 9, 3: 4, 4: 0, 5: 5, 6: 2 };

interface PreparedSyllable {
  position: number;
  jyutping: string;
  jyutpingNormalized: string | null;
  consonant: string | null;
  rhyme: string | null;
  toneRaw: number | null;
  toneDigit: number | null;
  char: string | null;
}

interface PreparedLine {
  lyricId: string;
  lineData: Prisma.LyricLineCreateManyInput;
  tokens: Array<{
    position: number;
    text: string;
    pos: string | null;
  }>;
  syllables: PreparedSyllable[];
  toneNgrams: Array<{
    n: number;
    value: string;
    position: number;
    syllableCount: number;
    tokenCount: number;
  }>;
  themeIds: bigint[];
  keywordIds: bigint[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function sanitizeName(name: string): string {
  return name.trim();
}

async function loadJyutpingResources(): Promise<JyutpingResources> {
  const tablePath = "data/sample/cantonese_pinyin_table.json";
  try {
    const raw = await Deno.readTextFile(tablePath);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const consonants = Array.isArray(parsed.consonants)
      ? (parsed.consonants as unknown[])
        .map((value) => typeof value === "string" ? value.trim().toLowerCase() : "")
        .filter((value) => value.length > 0)
      : [];
    const rhymes = Array.isArray(parsed.rhymes)
      ? (parsed.rhymes as unknown[])
        .map((value) => typeof value === "string" ? value.trim().toLowerCase() : "")
        .filter((value) => value.length > 0)
      : [];
    const sortedConsonants = consonants.slice().sort((a, b) => b.length - a.length);
    return {
      sortedConsonants,
      consonantSet: new Set(consonants),
      rhymeSet: new Set(rhymes),
    } satisfies JyutpingResources;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to load jyutping resources from ${tablePath}: ${reason}`);
    throw error;
  }
}

function stripToneDigits(value: string): string {
  return value.replace(/\d+$/u, "");
}

function splitJyutping(
  jyutping: string,
  resources: JyutpingResources,
): JyutpingSplitResult {
  if (!jyutping) {
    return {
      normalized: null,
      consonant: null,
      rhyme: null,
      toneRaw: null,
      toneDigit: null,
    };
  }
  const normalized = stripToneDigits(jyutping).toLowerCase();
  if (normalized.length === 0) {
    return {
      normalized: null,
      consonant: null,
      rhyme: null,
      toneRaw: null,
      toneDigit: null,
    };
  }

  let matchedConsonant = "";
  for (const candidate of resources.sortedConsonants) {
    if (candidate.length === 0) continue;
    if (normalized.startsWith(candidate)) {
      matchedConsonant = candidate;
      break;
    }
  }

  let remainder = normalized.slice(matchedConsonant.length);
  if (remainder.length === 0 && matchedConsonant.length === 0) {
    remainder = normalized;
  }

  let rhyme = remainder;
  if (!resources.rhymeSet.has(rhyme) && resources.rhymeSet.has(normalized)) {
    rhyme = normalized;
  }
  if (!resources.rhymeSet.has(rhyme)) {
    rhyme = remainder.length > 0 ? remainder : normalized;
    if (!resources.rhymeSet.has(rhyme)) {
      rhyme = remainder.length > 0 ? remainder : normalized;
    }
  }

  const consonantValue = matchedConsonant.length > 0 ? matchedConsonant : null;
  const rhymeValue = rhyme.length > 0 ? rhyme : null;
  const toneRawMatch = /([1-6])$/u.exec(jyutping);
  const toneRaw = toneRawMatch ? Number(toneRawMatch[1]) : null;
  const toneDigit = typeof toneRaw === "number" ? TONE_DIGIT_MAP[toneRaw] ?? null : null;

  return {
    normalized,
    consonant: consonantValue,
    rhyme: rhymeValue,
    toneRaw,
    toneDigit,
  } satisfies JyutpingSplitResult;
}

function toLyricRecord(
  raw: Record<string, unknown>,
  fallbackLineIndex: number,
): LyricJsonlRecord | null {
  const idValue = raw["id"];
  const textValue = raw["text"];
  const contextRaw = raw["context_links"];
  const sourceRaw = raw["source"];

  if (typeof idValue !== "string" || typeof textValue !== "string") {
    return null;
  }
  if (!isRecord(contextRaw) || typeof contextRaw["doc_id"] !== "string") {
    return null;
  }
  if (!isRecord(sourceRaw)) {
    return null;
  }

  const structureRaw = isRecord(raw["structure"]) ? raw["structure"] : null;
  const semanticsRaw = isRecord(raw["semantics"]) ? raw["semantics"] : null;
  const prosodyRaw = isRecord(raw["prosody"]) ? raw["prosody"] : null;
  const nlpRaw = isRecord(raw["nlp"]) ? raw["nlp"] : null;

  const structure = {
    line_index: typeof structureRaw?.["line_index"] === "number"
      ? Math.trunc(structureRaw["line_index"] as number)
      : fallbackLineIndex,
    char_count: typeof structureRaw?.["char_count"] === "number"
      ? Math.trunc(structureRaw["char_count"] as number)
      : textValue.length,
  };

  const semantics = {
    themes: isStringArray(semanticsRaw?.["themes"]) ? semanticsRaw["themes"] as string[] : [],
    sentiment: typeof semanticsRaw?.["sentiment"] === "string"
      ? (semanticsRaw["sentiment"] as string)
      : null,
    keywords: isStringArray(semanticsRaw?.["keywords"]) ? semanticsRaw["keywords"] as string[] : [],
  };

  const tonePattern = isNumberArray(prosodyRaw?.["tone_pattern"])
    ? (prosodyRaw["tone_pattern"] as number[]).map((value) => Math.trunc(value))
    : [];
  const tonePatternJyutping = isStringArray(prosodyRaw?.["tone_pattern_cantonese_jyutping"])
    ? prosodyRaw["tone_pattern_cantonese_jyutping"] as string[]
    : [];

  const tokenValues: TokenRecord[] = [];
  if (Array.isArray(nlpRaw?.["tokens"])) {
    for (const token of nlpRaw["tokens"] as unknown[]) {
      if (isRecord(token) && typeof token["text"] === "string") {
        const posValue = typeof token["pos"] === "string" ? token["pos"] : null;
        tokenValues.push({ text: token["text"], pos: posValue });
      }
    }
  }

  const syntaxNotes = typeof nlpRaw?.["syntax_notes"] === "string"
    ? (nlpRaw["syntax_notes"] as string)
    : null;

  const titleValue = typeof sourceRaw["title"] === "string" ? sourceRaw["title"] as string : "";
  const yearValue = typeof sourceRaw["year"] === "number" && Number.isFinite(sourceRaw["year"])
    ? Math.trunc(sourceRaw["year"] as number)
    : null;

  return {
    id: idValue,
    text: textValue,
    structure,
    semantics,
    prosody: {
      tone_pattern: tonePattern,
      tone_pattern_cantonese_jyutping: tonePatternJyutping,
    },
    nlp: {
      tokens: tokenValues,
      syntax_notes: syntaxNotes,
    },
    source: {
      title: titleValue,
      artists: isStringArray(sourceRaw["artists"]) ? sourceRaw["artists"] as string[] : [],
      lyricists: isStringArray(sourceRaw["lyricists"]) ? sourceRaw["lyricists"] as string[] : [],
      year: yearValue !== null && yearValue > 0 ? yearValue : null,
    },
    context_links: {
      doc_id: contextRaw["doc_id"] as string,
      prev_line_id: typeof contextRaw["prev_line_id"] === "string"
        ? contextRaw["prev_line_id"] as string
        : null,
      next_line_id: typeof contextRaw["next_line_id"] === "string"
        ? contextRaw["next_line_id"] as string
        : null,
      paragraph_id: typeof contextRaw["paragraph_id"] === "string"
        ? contextRaw["paragraph_id"] as string
        : null,
    },
  };
}

async function readLyricRecords(filePath: string): Promise<LyricJsonlRecord[]> {
  const content = await Deno.readTextFile(filePath);
  const lines = content.split(/\r?\n/);
  const records: LyricJsonlRecord[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx]?.trim();
    if (!rawLine) {
      continue;
    }
    try {
      const parsed = JSON.parse(rawLine) as unknown;
      if (!isRecord(parsed)) {
        logger.warn(
          `Skipping non-object lyric entry in ${filePath} at line ${idx + 1}`,
        );
        continue;
      }
      const record = toLyricRecord(parsed, idx + 1);
      if (record) {
        records.push(record);
      } else {
        logger.warn(
          `Skipping malformed lyric entry in ${filePath} at line ${idx + 1}`,
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn(
        `Failed to parse lyric entry in ${filePath} at line ${idx + 1}: ${reason}`,
      );
    }
  }

  return records;
}

async function ensureArtist(
  prisma: PrismaClient,
  cache: Map<string, bigint>,
  name: string,
): Promise<bigint> {
  const normalized = sanitizeName(name);
  if (normalized.length === 0) {
    throw new Error("Artist name cannot be empty");
  }
  const cached = cache.get(normalized);
  if (cached) {
    return cached;
  }
  const existing = await prisma.artist.findUnique({ where: { name: normalized } });
  if (existing) {
    cache.set(normalized, existing.id);
    return existing.id;
  }
  const created = await prisma.artist.create({ data: { name: normalized } });
  cache.set(normalized, created.id);
  return created.id;
}

async function ensureLyricist(
  prisma: PrismaClient,
  cache: Map<string, bigint>,
  name: string,
): Promise<bigint> {
  const normalized = sanitizeName(name);
  if (normalized.length === 0) {
    throw new Error("Lyricist name cannot be empty");
  }
  const cached = cache.get(normalized);
  if (cached) {
    return cached;
  }
  const existing = await prisma.lyricist.findUnique({ where: { name: normalized } });
  if (existing) {
    cache.set(normalized, existing.id);
    return existing.id;
  }
  const created = await prisma.lyricist.create({ data: { name: normalized } });
  cache.set(normalized, created.id);
  return created.id;
}

async function ensureTheme(
  prisma: PrismaClient,
  cache: Map<string, bigint>,
  name: string,
): Promise<bigint> {
  const normalized = sanitizeName(name);
  if (normalized.length === 0) {
    throw new Error("Theme name cannot be empty");
  }
  const cached = cache.get(normalized);
  if (cached) {
    return cached;
  }
  const existing = await prisma.theme.findUnique({ where: { name: normalized } });
  if (existing) {
    cache.set(normalized, existing.id);
    return existing.id;
  }
  const created = await prisma.theme.create({ data: { name: normalized } });
  cache.set(normalized, created.id);
  return created.id;
}

async function ensureKeyword(
  prisma: PrismaClient,
  cache: Map<string, bigint>,
  name: string,
): Promise<bigint> {
  const normalized = sanitizeName(name);
  if (normalized.length === 0) {
    throw new Error("Keyword cannot be empty");
  }
  const cached = cache.get(normalized);
  if (cached) {
    return cached;
  }
  const existing = await prisma.keyword.findUnique({ where: { word: normalized } });
  if (existing) {
    cache.set(normalized, existing.id);
    return existing.id;
  }
  const created = await prisma.keyword.create({ data: { word: normalized } });
  cache.set(normalized, created.id);
  return created.id;
}

function computeToneBigrams(pattern: number[]): Array<{
  n: number;
  value: string;
  position: number;
  syllableCount: number;
  tokenCount: number;
}> {
  const bigrams: Array<
    { n: number; value: string; position: number; syllableCount: number; tokenCount: number }
  > = [];
  for (let idx = 0; idx < pattern.length - 1; idx++) {
    const first = pattern[idx];
    const second = pattern[idx + 1];
    if (Number.isInteger(first) && Number.isInteger(second)) {
      bigrams.push({
        n: 2,
        value: `${first}${second}`,
        position: idx + 1,
        syllableCount: 2,
        tokenCount: 2,
      });
    }
  }
  return bigrams;
}

async function processLyricFile(
  prisma: PrismaClient,
  filePath: string,
  caches: EntityCaches,
  processedDocIds: Set<string>,
  jyutpingResources: JyutpingResources,
): Promise<ProcessLyricResult | null> {
  const records = await readLyricRecords(filePath);
  if (records.length === 0) {
    return null;
  }

  const docId = records[0].context_links.doc_id;
  if (docId.length === 0) {
    logger.warn(`Lyric file ${filePath} has empty doc_id; skipping.`);
    return null;
  }

  if (processedDocIds.has(docId)) {
    return { docId, songCreated: false, linesCreated: 0 };
  }
  processedDocIds.add(docId);

  const titleCandidate =
    records.find((record) => record.source.title.trim().length > 0)?.source.title.trim() ?? "";
  const title = titleCandidate.length > 0 ? titleCandidate : docId;
  const yearCandidate = records.find((record) => record.source.year !== null)?.source.year ?? null;

  const existingSong = await prisma.song.findUnique({ where: { docId } });
  let songRecord = existingSong;
  let songCreated = false;
  if (!songRecord) {
    songRecord = await prisma.song.create({
      data: {
        docId,
        title,
        year: yearCandidate,
      },
    });
    songCreated = true;
  } else if (songRecord.title !== title || (songRecord.year ?? null) !== yearCandidate) {
    songRecord = await prisma.song.update({
      where: { id: songRecord.id },
      data: {
        title,
        year: yearCandidate,
      },
    });
  }

  if (!songRecord) {
    throw new Error(`Failed to resolve song record for docId ${docId}`);
  }

  const artistNames = new Set<string>();
  const lyricistNames = new Set<string>();
  for (const record of records) {
    for (const artist of record.source.artists) {
      const normalized = sanitizeName(artist);
      if (normalized.length > 0) {
        artistNames.add(normalized);
      }
    }
    for (const lyricist of record.source.lyricists) {
      const normalized = sanitizeName(lyricist);
      if (normalized.length > 0) {
        lyricistNames.add(normalized);
      }
    }
  }

  const artistIds = await Promise.all(
    Array.from(artistNames).map((name) => ensureArtist(prisma, caches.artists, name)),
  );
  const lyricistIds = await Promise.all(
    Array.from(lyricistNames).map((name) => ensureLyricist(prisma, caches.lyricists, name)),
  );

  await Promise.all(
    artistIds.map((artistId) =>
      prisma.songArtist.upsert({
        where: {
          songId_artistId: {
            songId: songRecord.id,
            artistId,
          },
        },
        create: {
          songId: songRecord.id,
          artistId,
        },
        update: {},
      })
    ),
  );

  await Promise.all(
    lyricistIds.map((lyricistId) =>
      prisma.songLyricist.upsert({
        where: {
          songId_lyricistId: {
            songId: songRecord.id,
            lyricistId,
          },
        },
        create: {
          songId: songRecord.id,
          lyricistId,
        },
        update: {},
      })
    ),
  );

  const preparedLines: PreparedLine[] = [];

  for (const record of records) {
    const tonePattern = record.prosody.tone_pattern;
    const tonePatternText = tonePattern.length > 0
      ? tonePattern.map((digit) => digit.toString()).join(",")
      : "";
    const toneJyutping = record.prosody.tone_pattern_cantonese_jyutping;

    const tokens = record.nlp.tokens
      .map((token, index) => ({
        position: index + 1,
        text: token.text,
        pos: token.pos ?? null,
      }))
      .filter((token) => token.text.length > 0);

    const syllables = toneJyutping.map((jyutping, index) => {
      const split = splitJyutping(jyutping, jyutpingResources);
      const mappedTone = split.toneDigit ??
        (Number.isInteger(tonePattern[index]) ? tonePattern[index] : null);
      return {
        position: index + 1,
        jyutping,
        jyutpingNormalized: split.normalized,
        consonant: split.consonant,
        rhyme: split.rhyme,
        toneRaw: split.toneRaw,
        toneDigit: mappedTone,
        char: null,
      } satisfies PreparedSyllable;
    });

    const toneNgrams = computeToneBigrams(tonePattern);

    const themeNames = Array.from(new Set(record.semantics.themes.map(sanitizeName)))
      .filter((name) => name.length > 0);
    const keywordNames = Array.from(new Set(record.semantics.keywords.map(sanitizeName)))
      .filter((name) => name.length > 0);

    const themeIds = themeNames.length > 0
      ? await Promise.all(themeNames.map((name) => ensureTheme(prisma, caches.themes, name)))
      : [];
    const keywordIds = keywordNames.length > 0
      ? await Promise.all(keywordNames.map((name) => ensureKeyword(prisma, caches.keywords, name)))
      : [];

    const lineData: Prisma.LyricLineCreateManyInput = {
      lyricId: record.id,
      songId: songRecord.id,
      text: record.text,
      lineIndex: record.structure.line_index,
      charCount: record.structure.char_count,
      paragraphId: record.context_links.paragraph_id ?? null,
      prevLineId: record.context_links.prev_line_id ?? null,
      nextLineId: record.context_links.next_line_id ?? null,
      sentiment: record.semantics.sentiment?.toUpperCase() ?? null,
      syntaxNotes: record.nlp.syntax_notes ?? null,
      syllableCount: syllables.length,
      tokenCount: tokens.length,
      jyutpingCount: toneJyutping.length,
      tonePatternText,
    };

    preparedLines.push({
      lyricId: record.id,
      lineData,
      tokens,
      syllables,
      toneNgrams,
      themeIds,
      keywordIds,
    });
  }

  if (preparedLines.length === 0) {
    return { docId, songCreated, linesCreated: 0 };
  }

  const lyricIds = preparedLines.map((line) => line.lyricId);
  const existingLines = await prisma.lyricLine.findMany({
    where: { lyricId: { in: lyricIds } },
    select: { id: true, lyricId: true },
  });
  const existingMap = new Map(existingLines.map((line) => [line.lyricId, line.id] as const));

  const linesToInsert = preparedLines.filter((line) => !existingMap.has(line.lyricId));
  if (linesToInsert.length === 0) {
    return { docId, songCreated, linesCreated: 0 };
  }

  await prisma.$transaction(async (tx) => {
    const lineInsertData = linesToInsert.map((line) => line.lineData);
    if (lineInsertData.length > 0) {
      await tx.lyricLine.createMany({ data: lineInsertData, skipDuplicates: true });
    }

    const updatedLines = await tx.lyricLine.findMany({
      where: { lyricId: { in: lyricIds } },
      select: { id: true, lyricId: true },
    });
    const idMap = new Map(updatedLines.map((line) => [line.lyricId, line.id] as const));

    const tokenData: Prisma.TokenCreateManyInput[] = [];
    const syllableData: Prisma.SyllableCreateManyInput[] = [];
    const toneNgramData: Prisma.ToneNgramCreateManyInput[] = [];
    const themeLinkData: Prisma.LyricThemeCreateManyInput[] = [];
    const keywordLinkData: Prisma.LyricKeywordCreateManyInput[] = [];

    for (const line of linesToInsert) {
      const lineId = idMap.get(line.lyricId);
      if (!lineId) continue;

      for (const token of line.tokens) {
        tokenData.push({
          lyricId: lineId,
          position: token.position,
          text: token.text,
          pos: token.pos,
        });
      }

      for (const syllable of line.syllables) {
        syllableData.push({
          lyricId: lineId,
          position: syllable.position,
          jyutping: syllable.jyutping,
          jyutpingNormalized: syllable.jyutpingNormalized,
          consonant: syllable.consonant,
          rhyme: syllable.rhyme,
          toneRaw: syllable.toneRaw,
          toneDigit: syllable.toneDigit,
          char: syllable.char,
        });
      }

      for (const ngram of line.toneNgrams) {
        toneNgramData.push({
          lyricId: lineId,
          n: ngram.n,
          value: ngram.value,
          position: ngram.position,
          syllableCount: ngram.syllableCount,
          tokenCount: ngram.tokenCount,
        });
      }

      if (line.themeIds.length > 0) {
        for (const themeId of line.themeIds) {
          themeLinkData.push({ lyricId: lineId, themeId });
        }
      }
      if (line.keywordIds.length > 0) {
        for (const keywordId of line.keywordIds) {
          keywordLinkData.push({ lyricId: lineId, keywordId });
        }
      }
    }

    if (tokenData.length > 0) {
      await tx.token.createMany({ data: tokenData });
    }
    if (syllableData.length > 0) {
      await tx.syllable.createMany({ data: syllableData });
    }
    if (toneNgramData.length > 0) {
      await tx.toneNgram.createMany({ data: toneNgramData });
    }
    if (themeLinkData.length > 0) {
      await tx.lyricTheme.createMany({ data: themeLinkData, skipDuplicates: true });
    }
    if (keywordLinkData.length > 0) {
      await tx.lyricKeyword.createMany({ data: keywordLinkData, skipDuplicates: true });
    }
  });

  return { docId, songCreated, linesCreated: linesToInsert.length };
}

async function seedLyricsFromDirectory(
  prisma: PrismaClient,
  directory: string,
  jyutpingResources: JyutpingResources,
): Promise<{ songsInserted: number; linesInserted: number; filesProcessed: number }> {
  const directoryExists = await exists(directory);
  if (!directoryExists) {
    logger.warn(`Lyric directory not found: ${directory}`);
    return { songsInserted: 0, linesInserted: 0, filesProcessed: 0 };
  }

  const caches: EntityCaches = {
    artists: new Map<string, bigint>(),
    lyricists: new Map<string, bigint>(),
    themes: new Map<string, bigint>(),
    keywords: new Map<string, bigint>(),
  };
  const processedDocIds = new Set<string>();

  let songsInserted = 0;
  let linesInserted = 0;
  let filesProcessed = 0;

  for await (const entry of walk(directory, { includeDirs: false, match: [/\.jsonl$/i] })) {
    filesProcessed += 1;
    const result = await processLyricFile(
      prisma,
      entry.path,
      caches,
      processedDocIds,
      jyutpingResources,
    );
    if (!result) {
      continue;
    }
    if (result.songCreated) {
      songsInserted += 1;
    }
    linesInserted += result.linesCreated;

    if (filesProcessed % 100 === 0) {
      logger.info(
        `   ↳ Processed ${filesProcessed} lyric files (${linesInserted} lines inserted so far)`,
      );
    }
  }

  return { songsInserted, linesInserted, filesProcessed };
}

async function populateMainDatabase() {
  await load({ export: true });

  logger.info("🚀 Starting main database population...");

  const databaseUrl = Deno.env.get("DATABASE_URL");
  logger.info(databaseUrl);
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

  try {
    await prisma.$connect();
    logger.info("✅ Connected to main database");

    const existingCount = await prisma.entry.count();

    if (typeof existingCount === "number" && existingCount > 0) {
      logger.info(
        `⚠️  Database already contains ${existingCount} entries. Skipping population.`,
      );
      logger.info("   To repopulate, first run: npm run db:reset");
      return;
    }

    logger.info("📖 Checking for preprocessed data files...");
    const charsFile = "data/preprocess/lexicon/chars.posr.jsonl";
    const vocabFile = "data/preprocess/lexicon/vocab.posr.jsonl";

    const charsExists = await exists(charsFile);
    const vocabExists = await exists(vocabFile);

    if (!charsExists || !vocabExists) {
      logger.error("❌ Required preprocessed files are missing:");
      if (!charsExists) {
        logger.error(`   ❌ Missing: ${charsFile}`);
      }
      if (!vocabExists) {
        logger.error(`   ❌ Missing: ${vocabFile}`);
      }
      logger.error("\n🔧 To generate these files, please run:");
      logger.error("   1. First run normalization scripts:");
      logger.error("      npm run normalize:chars");
      logger.error("      npm run normalize:vocab");
      logger.error("   2. Then run preprocessing scripts:");
      logger.error("      npm run preprocess:lexicon");
      logger.error("\n   Or run the complete preprocessing pipeline:");
      logger.error("      npm run preprocess:all");
      throw new Error(
        "Preprocessed files not found. Please run preprocessing scripts first.",
      );
    }

    logger.info("✅ Found preprocessed files:");
    logger.info(`   ✅ ${charsFile}`);
    logger.info(`   ✅ ${vocabFile}`);

    logger.info(
      "💾 Inserting lexicon data into main database from preprocessed JSONL...",
    );
    const seeder = createDatabaseSeeder(prisma, {
      batchSize: 2048,
      logProgress: true,
    });
    let totalEntries = 0;
    let totalReadings = 0;

    const charsRes = await seeder.seedFromFile(charsFile);
    totalEntries += charsRes.insertedEntries;
    totalReadings += charsRes.insertedReadings;
    logger.info(
      `   ↳ Seeded chars: ${charsRes.insertedEntries} entries, ${charsRes.insertedReadings} readings`,
    );

    const vocabRes = await seeder.seedFromFile(vocabFile);
    totalEntries += vocabRes.insertedEntries;
    totalReadings += vocabRes.insertedReadings;
    logger.info(
      `   ↳ Seeded vocab: ${vocabRes.insertedEntries} entries, ${vocabRes.insertedReadings} readings`,
    );

    logger.info(
      `✅ Lexicon seeding completed! Inserted: ${totalEntries} entries, ${totalReadings} readings.`,
    );

    const jyutpingResources = await loadJyutpingResources();

    const lyricDirectory = "data/preprocess/lyrics/feitsui";
    logger.info(`🎼 Seeding lyrics from ${lyricDirectory} ...`);
    const lyricStats = await seedLyricsFromDirectory(
      prisma,
      lyricDirectory,
      jyutpingResources,
    );
    if (lyricStats.filesProcessed === 0) {
      logger.warn("   ⚠️ No lyric files processed.");
    } else {
      logger.info(
        `   ↳ Processed ${lyricStats.filesProcessed} lyric files: ${lyricStats.songsInserted} songs inserted, ${lyricStats.linesInserted} lyric lines created`,
      );
    }

    const finalEntryCount = await prisma.entry.count();
    const finalReadingCount = await prisma.reading.count();
    const finalSongCount = await prisma.song.count();
    const finalLyricLineCount = await prisma.lyricLine.count();

    logger.info(
      `   🔍 Lexicon counts: ${finalEntryCount} entries, ${finalReadingCount} readings`,
    );
    logger.info(
      `   🔍 Lyrics counts: ${finalSongCount} songs, ${finalLyricLineCount} lyric lines`,
    );
  } catch (error) {
    logger.error("❌ Error populating database:", error);
    Deno.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) {
  populateMainDatabase().catch((err) => {
    logger.error(`❌ An unexpected error occurred: ${(err as Error).message}`);
    Deno.exit(1);
  });
}
