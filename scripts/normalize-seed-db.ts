/**
 * One-shot bootstrap script:
 * - Ensures DB is reachable and schema is applied
 * - Normalizes sample data (chars + words), enriches gloss from detail files
 * - Seeds the normalized data into the main database
 *
 * Usage: tsx scripts/normalize-seed-db.ts
 */

import { load } from "jsr:@std/dotenv";
import { PrismaClient } from "../prisma/generated/client.ts";
import {
  type CharlistData,
  entriesToJSONL as charsToJSONL,
  normalizeCharlistData,
} from "../src/shared/utils/charlistNormalizer.ts";
import {
  entriesToJSONL as wordsToJSONL,
  normalizeWordslistData,
  type WordslistData,
} from "../src/shared/utils/wordslistNormalizer.ts";
import { createDatabaseSeeder } from "../src/shared/utils/databaseSeeder.ts";
import { loadCharDetail, loadWordDetail } from "./utils/dataFiles.ts";
import { getLogger } from "jsr:@std/log";
import { join } from "jsr:@std/path";
import pinyinTable from "../data/sample/cantonese_pinyin_table.json" with { type: "json" };

const logger = getLogger();

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readTextFile(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

async function writeTextFile(path: string, content: string): Promise<void> {
  await Deno.writeTextFile(path, content);
}

async function readDir(path: string): Promise<string[]> {
  const files: string[] = [];

  async function scanDir(dirPath: string, relativePath: string = "") {
    for await (const entry of Deno.readDir(dirPath)) {
      const fullPath = relativePath ? join(relativePath, entry.name) : entry.name;

      if (entry.isDirectory) {
        const subDirPath = join(dirPath, entry.name);
        await scanDir(subDirPath, fullPath);
      } else if (entry.isFile && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }

  await scanDir(path);
  return files;
}

type LyricLineData = {
  id: string;
  text: string;
  structure: { line_index: number; char_count: number };
  semantics: { themes: string[]; sentiment: string; keywords: string[] };
  prosody: { tone_pattern: number[]; tone_pattern_cantonese_jyutping: string[] };
  nlp: { tokens: { text: string; pos: string }[]; syntax_notes?: string };
  source: { title: string; artists: string[]; lyricists: string[]; year: number; genre: string[] };
  context_links: {
    doc_id: string;
    prev_line_id?: string | null;
    next_line_id?: string | null;
    paragraph_id?: string;
  };
};

function parseJyutping(
  syllable: string,
): {
  consonant: string | null;
  rhyme: string | null;
  toneRaw: number | null;
  toneDigit: number | null;
} {
  const toneMatch = syllable.match(/(\d)$/);
  const toneRaw = toneMatch ? Number(toneMatch[1]) : null;
  const base = syllable.replace(/\d$/, "");

  const consonants = [...pinyinTable.consonants].sort((a, b) => b.length - a.length);
  const rhymes = [...pinyinTable.rhymes].sort((a, b) => b.length - a.length);

  let consonant: string | null = null;
  for (const c of consonants) {
    if (base.startsWith(c)) {
      consonant = c;
      break;
    }
  }

  let rest = base;
  if (consonant) rest = base.slice(consonant.length);

  let rhyme: string | null = null;
  for (const r of rhymes) {
    if (rest === r) {
      rhyme = r;
      break;
    }
  }

  const toneDigit = toneRaw && pinyinTable.tones[String(toneRaw) as keyof typeof pinyinTable.tones]
    ? Number(pinyinTable.tones[String(toneRaw) as keyof typeof pinyinTable.tones])
    : null;

  return { consonant, rhyme, toneRaw, toneDigit };
}

async function main() {
  // Ensure .env vars are loaded when running standalone
  await load({ export: true });
  logger.info("🚀 Bootstrapping database and data...");

  const databaseUrl = Deno.env.get("DATABASE_URL");
  if (!databaseUrl) {
    logger.error(
      "❌ DATABASE_URL is not set. Please export it before running.",
    );
    Deno.exit(1);
  }

  // 1) Ensure DB is reachable
  logger.info("🔎 Checking database connectivity...");
  const dbReady = true; // assume ready; replace with a connection check if needed
  if (!dbReady) {
    logger.error("❌ Database not reachable after retries. Is Docker DB up?");
    Deno.exit(1);
  }
  logger.info("✅ Database is reachable");

  // Track char surfaces for dedup
  const charSurfaces = new Set<string>();

  // 3) Normalize and enrich charlist
  const charInput = "data/sample/charlist.json";
  const charDetail = "data/sample/char_detail.json";
  const charOut = "data/normalized/normalized-chars.jsonl";
  if (await fileExists(charInput)) {
    logger.info(`🔤 Normalizing chars from ${charInput}`);
    const rawChar = await readTextFile(charInput);
    const charData: CharlistData = JSON.parse(rawChar);
    const charEntries = normalizeCharlistData(
      charData,
      "words_hk_charlist_v28042025",
    );
    for (const e of charEntries) charSurfaces.add(e.surface);
    const glossMap = await fileExists(charDetail) ? loadCharDetail(charDetail) : new Map();
    for (const entry of charEntries) {
      const g = glossMap.get(entry.surface);
      if (g) {
        entry.lang = "zh-TW";
        for (const r of entry.readings) r.gloss = g;
      }
    }
    await writeTextFile(charOut, charsToJSONL(charEntries));
    logger.info(`✅ Wrote ${charOut}`);
  } else {
    logger.info(`ℹ️  Skipping char normalization; missing ${charInput}`);
  }

  // 4) Normalize and enrich wordslist (dedup against char surfaces)
  const wordInput = "data/sample/wordslist.json";
  const wordDetail = "data/sample/word_detail.json";
  const wordOut = "data/normalized/normalized-vocab.jsonl";
  if (await fileExists(wordInput)) {
    logger.info(`🧾 Normalizing words from ${wordInput}`);
    const rawWords = await readTextFile(wordInput);
    const wordsData: WordslistData = JSON.parse(rawWords);
    let wordEntries = normalizeWordslistData(
      wordsData,
      "words_hk_wordslist_v28042025",
    );
    if (charSurfaces.size > 0) {
      const before = wordEntries.length;
      wordEntries = wordEntries.filter((e) => !charSurfaces.has(e.surface));
      const after = wordEntries.length;
      const removed = before - after;
      if (removed > 0) {
        logger.info(
          `🧹 Deduped ${removed} vocab entries present in chars (${before} -> ${after}).`,
        );
      }
    }
    const glossMap = await fileExists(wordDetail) ? loadWordDetail(wordDetail) : new Map();
    for (const entry of wordEntries) {
      const g = glossMap.get(entry.surface);
      if (g) {
        entry.lang = "zh-TW";
        for (const r of entry.readings) r.gloss = g;
      }
    }
    await writeTextFile(wordOut, wordsToJSONL(wordEntries));
    logger.info(`✅ Wrote ${wordOut}`);
  } else {
    logger.info(`ℹ️  Skipping words normalization; missing ${wordInput}`);
  }

  // 5) Seed database from normalized files
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  const seeder = createDatabaseSeeder(prisma, {
    batchSize: 200,
    logProgress: true,
  });

  try {
    await prisma.$connect();
    logger.info("🔌 Connected to DB. Seeding...");
    let totalEntries = 0;
    let totalReadings = 0;

    if (await fileExists(charOut)) {
      const res = await seeder.seedFromFile(charOut);
      totalEntries += res.insertedEntries;
      totalReadings += res.insertedReadings;
      logger.info(
        `   ↳ Seeded chars: ${res.insertedEntries} entries, ${res.insertedReadings} readings`,
      );
    }
    if (await fileExists(wordOut)) {
      const res = await seeder.seedFromFile(wordOut);
      totalEntries += res.insertedEntries;
      totalReadings += res.insertedReadings;
      logger.info(
        `   ↳ Seeded vocab: ${res.insertedEntries} entries, ${res.insertedReadings} readings`,
      );
    }

    logger.info(
      `✅ Seeding done. Total inserted: ${totalEntries} entries, ${totalReadings} readings.`,
    );
  } catch (e) {
    logger.error(`❌ Seeding failed: ${(e as Error).message}`);
    Deno.exit(1);
  } finally {
    await prisma.$disconnect();
  }

  // 6) Seed lyrics data
  logger.info("🎵 Seeding lyrics data...");
  await seedLyricsData(prisma);
  logger.info("✅ Lyrics seeding completed.");
}

async function seedLyricsData(prisma: PrismaClient) {
  const lyricsDir = "data/preprocess/lyrics/feitsui";
  if (!(await fileExists(lyricsDir))) {
    logger.info(`ℹ️  Skipping lyrics seeding; missing ${lyricsDir}`);
    return;
  }

  const files = await readDir(lyricsDir);
  for (const file of files) {
    const filePath = join(lyricsDir, file);
    logger.info(`📄 Processing ${filePath}`);
    const content = await readTextFile(filePath);
    const lines = content.split(/\r?\n/).filter(Boolean);

    const batch: LyricLineData[] = lines.map((line) => JSON.parse(line));
    await bulkInsertLyricsData(prisma, batch);
  }
}

// Chunk helper to avoid exceeding parameter limits
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function bulkInsertLyricsData(prisma: PrismaClient, batch: LyricLineData[]) {
  if (batch.length === 0) return;

  // 1) Collect unique primitives
  const artistSet = new Set<string>();
  const lyricistSet = new Set<string>();
  const themeSet = new Set<string>();
  const keywordSet = new Set<string>();
  const songByDoc = new Map<string, { title: string; year: number | null }>();

  for (const d of batch) {
    d.source.artists?.forEach((a) => a && artistSet.add(a));
    d.source.lyricists?.forEach((l) => l && lyricistSet.add(l));
    d.semantics.themes?.forEach((t) => t && themeSet.add(t));
    d.semantics.keywords?.forEach((k) => k && keywordSet.add(k));
    const doc = d.context_links.doc_id;
    if (!songByDoc.has(doc)) {
      songByDoc.set(doc, { title: d.source.title, year: d.source.year ?? null });
    }
  }

  // 2) Bulk insert base tables with skipDuplicates
  const CREATE_MANY_CHUNK = 1000;

  const artistRows = Array.from(artistSet).map((name) => ({ name }));
  for (const c of chunk(artistRows, CREATE_MANY_CHUNK)) {
    if (c.length) await (prisma as any).artist.createMany({ data: c, skipDuplicates: true });
  }

  const lyricistRows = Array.from(lyricistSet).map((name) => ({ name }));
  for (const c of chunk(lyricistRows, CREATE_MANY_CHUNK)) {
    if (c.length) await (prisma as any).lyricist.createMany({ data: c, skipDuplicates: true });
  }

  const themeRows = Array.from(themeSet).map((name) => ({ name }));
  for (const c of chunk(themeRows, CREATE_MANY_CHUNK)) {
    if (c.length) await (prisma as any).theme.createMany({ data: c, skipDuplicates: true });
  }

  const keywordRows = Array.from(keywordSet).map((word) => ({ word }));
  for (const c of chunk(keywordRows, CREATE_MANY_CHUNK)) {
    if (c.length) await (prisma as any).keyword.createMany({ data: c, skipDuplicates: true });
  }

  // 3) Fetch id maps for base tables
  const [artists, lyricists, themes, keywords] = await Promise.all([
    (prisma as any).artist.findMany({
      where: { name: { in: Array.from(artistSet) } },
      select: { id: true, name: true },
    }),
    (prisma as any).lyricist.findMany({
      where: { name: { in: Array.from(lyricistSet) } },
      select: { id: true, name: true },
    }),
    (prisma as any).theme.findMany({
      where: { name: { in: Array.from(themeSet) } },
      select: { id: true, name: true },
    }),
    (prisma as any).keyword.findMany({
      where: { word: { in: Array.from(keywordSet) } },
      select: { id: true, word: true },
    }),
  ]);
  const artistIdByName = new Map<string, bigint>();
  const lyricistIdByName = new Map<string, bigint>();
  const themeIdByName = new Map<string, bigint>();
  const keywordIdByWord = new Map<string, bigint>();
  for (const a of artists) artistIdByName.set(a.name, a.id);
  for (const l of lyricists) lyricistIdByName.set(l.name, l.id);
  for (const t of themes) themeIdByName.set(t.name, t.id);
  for (const k of keywords) keywordIdByWord.set(k.word, k.id);

  // 4) Songs bulk insert and fetch ids
  const songRows = Array.from(songByDoc.entries()).map(([docId, { title, year }]) => ({
    docId,
    title,
    year,
  }));
  for (const c of chunk(songRows, CREATE_MANY_CHUNK)) {
    if (c.length) await (prisma as any).song.createMany({ data: c, skipDuplicates: true });
  }
  const songs = await (prisma as any).song.findMany({
    where: { docId: { in: songRows.map((s) => s.docId) } },
    select: { id: true, docId: true },
  });
  const songIdByDoc = new Map<string, bigint>();
  for (const s of songs) songIdByDoc.set(s.docId, s.id);

  // 5) Song-Artist and Song-Lyricist join tables
  const songArtistRows: Array<{ songId: bigint; artistId: bigint }> = [];
  const songLyricistRows: Array<{ songId: bigint; lyricistId: bigint }> = [];
  for (const d of batch) {
    const sid = songIdByDoc.get(d.context_links.doc_id);
    if (!sid) continue;
    for (const name of d.source.artists ?? []) {
      const aid = name ? artistIdByName.get(name) : undefined;
      if (aid) songArtistRows.push({ songId: sid, artistId: aid });
    }
    for (const name of d.source.lyricists ?? []) {
      const lid = name ? lyricistIdByName.get(name) : undefined;
      if (lid) songLyricistRows.push({ songId: sid, lyricistId: lid });
    }
  }
  // Dedup within batch to reduce conflict checks
  const keySetSA = new Set<string>();
  const uniqueSA = songArtistRows.filter((r) => {
    const k = `${r.songId}:${r.artistId}`;
    if (keySetSA.has(k)) return false;
    keySetSA.add(k);
    return true;
  });
  const keySetSL = new Set<string>();
  const uniqueSL = songLyricistRows.filter((r) => {
    const k = `${r.songId}:${r.lyricistId}`;
    if (keySetSL.has(k)) return false;
    keySetSL.add(k);
    return true;
  });
  for (const c of chunk(uniqueSA, CREATE_MANY_CHUNK)) {
    if (c.length) await (prisma as any).songArtist.createMany({ data: c, skipDuplicates: true });
  }
  for (const c of chunk(uniqueSL, CREATE_MANY_CHUNK)) {
    if (c.length) await (prisma as any).songLyricist.createMany({ data: c, skipDuplicates: true });
  }

  // 6) Lyric lines bulk insert
  const lyricRows = batch.map((d) => {
    const songId = songIdByDoc.get(d.context_links.doc_id)!;
    const syllableCount = d.prosody.tone_pattern.length;
    const tokenCount = d.nlp.tokens.length;
    const tonePatternText = d.prosody.tone_pattern.join(",");
    return {
      lyricId: d.id,
      songId,
      text: d.text,
      lineIndex: d.structure.line_index,
      charCount: d.structure.char_count,
      paragraphId: d.context_links.paragraph_id,
      prevLineId: d.context_links.prev_line_id,
      nextLineId: d.context_links.next_line_id,
      sentiment: d.semantics.sentiment,
      syntaxNotes: d.nlp.syntax_notes,
      syllableCount,
      tokenCount,
      tonePatternText,
      jyutpingCount: d.prosody.tone_pattern_cantonese_jyutping.length,
    };
  });
  for (const c of chunk(lyricRows, CREATE_MANY_CHUNK)) {
    if (c.length) await (prisma as any).lyricLine.createMany({ data: c, skipDuplicates: true });
  }

  // Fetch lyric ids for relation inserts
  const lyricIds = batch.map((d) => d.id);
  const lyricRowsInserted = await (prisma as any).lyricLine.findMany({
    where: { lyricId: { in: lyricIds } },
    select: { id: true, lyricId: true },
  });
  const lyricIdByLyricKey = new Map<string, bigint>();
  for (const l of lyricRowsInserted) lyricIdByLyricKey.set(l.lyricId, l.id);

  // Clean per-lyric child tables to avoid duplication on re-runs
  const lyricPkIds = Array.from(lyricIdByLyricKey.values());
  for (const c of chunk(lyricPkIds, CREATE_MANY_CHUNK)) {
    if (!c.length) continue;
    await Promise.all([
      (prisma as any).token.deleteMany({ where: { lyricId: { in: c } } }),
      (prisma as any).syllable.deleteMany({ where: { lyricId: { in: c } } }),
      (prisma as any).toneNgram.deleteMany({ where: { lyricId: { in: c } } }),
    ]);
  }

  // 7) Lyric-Theme and Lyric-Keyword join tables
  const lyricThemeRows: Array<{ lyricId: bigint; themeId: bigint }> = [];
  const lyricKeywordRows: Array<{ lyricId: bigint; keywordId: bigint }> = [];
  for (const d of batch) {
    const lid = lyricIdByLyricKey.get(d.id);
    if (!lid) continue;
    for (const t of d.semantics.themes ?? []) {
      const tid = themeIdByName.get(t);
      if (tid) lyricThemeRows.push({ lyricId: lid, themeId: tid });
    }
    for (const k of d.semantics.keywords ?? []) {
      const kid = keywordIdByWord.get(k);
      if (kid) lyricKeywordRows.push({ lyricId: lid, keywordId: kid });
    }
  }
  // Dedup
  const keySetLT = new Set<string>();
  const uniqueLT = lyricThemeRows.filter((r) => {
    const k = `${r.lyricId}:${r.themeId}`;
    if (keySetLT.has(k)) return false;
    keySetLT.add(k);
    return true;
  });
  const keySetLK = new Set<string>();
  const uniqueLK = lyricKeywordRows.filter((r) => {
    const k = `${r.lyricId}:${r.keywordId}`;
    if (keySetLK.has(k)) return false;
    keySetLK.add(k);
    return true;
  });
  for (const c of chunk(uniqueLT, CREATE_MANY_CHUNK)) {
    if (c.length) await (prisma as any).lyricTheme.createMany({ data: c, skipDuplicates: true });
  }
  for (const c of chunk(uniqueLK, CREATE_MANY_CHUNK)) {
    if (c.length) await (prisma as any).lyricKeyword.createMany({ data: c, skipDuplicates: true });
  }

  // 8) Tokens
  const tokenRows: Array<{ lyricId: bigint; position: number; text: string; pos: string | null }> =
    [];
  for (const d of batch) {
    const lid = lyricIdByLyricKey.get(d.id);
    if (!lid) continue;
    for (let i = 0; i < d.nlp.tokens.length; i++) {
      const t = d.nlp.tokens[i];
      tokenRows.push({ lyricId: lid, position: i + 1, text: t.text, pos: t.pos ?? null });
    }
  }
  for (const c of chunk(tokenRows, CREATE_MANY_CHUNK)) {
    if (c.length) await (prisma as any).token.createMany({ data: c });
  }

  // 9) Syllables
  const syllableRows: Array<
    {
      lyricId: bigint;
      position: number;
      jyutping: string;
      consonant: string | null;
      rhyme: string | null;
      toneRaw: number | null;
      toneDigit: number | null;
    }
  > = [];
  for (const d of batch) {
    const lid = lyricIdByLyricKey.get(d.id);
    if (!lid) continue;
    const jyut = d.prosody.tone_pattern_cantonese_jyutping;
    const toneDigits = d.prosody.tone_pattern;
    for (let i = 0; i < jyut.length; i++) {
      const parsed = parseJyutping(jyut[i]);
      syllableRows.push({
        lyricId: lid,
        position: i + 1,
        jyutping: jyut[i],
        consonant: parsed.consonant,
        rhyme: parsed.rhyme,
        toneRaw: parsed.toneRaw,
        toneDigit: toneDigits[i] ?? null,
      });
    }
  }
  for (const c of chunk(syllableRows, CREATE_MANY_CHUNK)) {
    if (c.length) await (prisma as any).syllable.createMany({ data: c });
  }

  // 10) Tone ngrams (unigrams and bigrams)
  const ngramRows: Array<
    {
      lyricId: bigint;
      n: number;
      value: string;
      position: number;
      syllableCount: number;
      tokenCount: number;
    }
  > = [];
  for (const d of batch) {
    const lid = lyricIdByLyricKey.get(d.id);
    if (!lid) continue;
    const toneDigits = d.prosody.tone_pattern;
    const syllableCount = toneDigits.length;
    const tokenCount = d.nlp.tokens.length;
    for (let i = 0; i < toneDigits.length; i++) {
      ngramRows.push({
        lyricId: lid,
        n: 1,
        value: String(toneDigits[i]),
        position: i + 1,
        syllableCount,
        tokenCount,
      });
    }
    for (let i = 0; i < toneDigits.length - 1; i++) {
      ngramRows.push({
        lyricId: lid,
        n: 2,
        value: `${toneDigits[i]}${toneDigits[i + 1]}`,
        position: i + 1,
        syllableCount,
        tokenCount,
      });
    }
  }
  for (const c of chunk(ngramRows, CREATE_MANY_CHUNK)) {
    if (c.length) await (prisma as any).toneNgram.createMany({ data: c });
  }
}

if (import.meta.main) {
  main().catch((e) => {
    logger.error(e);
    Deno.exit(1);
  });
}
