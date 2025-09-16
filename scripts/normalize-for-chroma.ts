/**
 * Normalize JSONL into Chroma-ready documents.
 *
 * Supports:
 *  - Lexicon lists: chars + vocab (existing behavior)
 *  - Lyrics: enriched JSONL lines under a directory tree
 *
 * Default Inputs:
 *  - data/nfunction groupTonePatternByTokens(tonePattern: number[], tokens: { text: string; pos: string }[]): string {
  if (!tonePattern.length || !tokens.length) return tonePattern.join(" ");
  const groups: string[] = [];
  let index = 0;
  for (const token of tokens) {
    const sylCount = token.text?.length ?? 1; // Assume 1 syllable per character
    if (index + sylCount > tonePattern.length) break;
    const group = tonePattern.slice(index, index + sylCount).join("");
    groups.push(group);
    index += sylCount;
  }
  return groups.join(" ");
}malized-chars.jsonl
 *  - data/normalized/normalized-vocab.jsonl
 *  - data/preprocess/lyrics (recursive)
 *
 * Default Outputs:
 *  - data/vector/chroma-chars.jsonl
 *  - data/vector/chroma-vocab.jsonl
 *  - data/vector/chroma-lexicon.jsonl (chars + vocab merged)
 *  - data/vector/chroma-lyrics.jsonl
 *
 * Each output line is a JSON object:
 *  {
 *    id: string,
 *    document: string,
 *    metadata: { ...flattened fields for filtering... }
 *  }
 */

import { dirname } from "jsr:@std/path";
import { getLogger } from "jsr:@std/log";

const logger = getLogger();

// ------------------------------------------------------------
// Types – Lexicon
// ------------------------------------------------------------
type Reading = {
  jyutping?: string[]; // tokens
  pronunciation?: string; // mapped tones (new schema keeps this)
  tone?: string; // tone digits (new)
  consonants?: string[]; // initial(s) per syllable (new)
  rhymes?: string[]; // rhyme(s) per syllable (new)
  syllables?: number;
  freq?: number;
  pos?: string;
  register?: string;
  gloss?: string;
  source?: string;
};

type NormalizedLine = {
  surface: string;
  type: "char" | "vocab" | string;
  lang?: string;
  readings?: Reading[];
};

// ------------------------------------------------------------
// Types – Lyrics (from feitsui preprocess/sample JSONL)
// ------------------------------------------------------------
type LyricLine = {
  id?: string;
  text: string;
  structure?: {
    line_index?: number;
    char_count?: number;
  };
  semantics?: {
    themes?: string[];
    sentiment?: string;
    keywords?: string[];
  };
  prosody?: {
    tone_pattern?: number[];
    tone_pattern_cantonese_jyutping?: string[];
  };
  nlp?: {
    tokens?: { text: string; pos: string }[];
  };
  source?: {
    title?: string;
    artists?: string[];
    lyricists?: string[];
    year?: number;
    genre?: string[];
  };
  context_links?: {
    doc_id?: string;
    prev_line_id?: string | null;
    next_line_id?: string | null;
    paragraph_id?: string;
  };
};

// ------------------------------------------------------------
// Utilities
// ------------------------------------------------------------
async function ensureDirFor(filePath: string) {
  const dir = dirname(filePath);
  try {
    await Deno.stat(dir);
  } catch {
    await Deno.mkdir(dir, { recursive: true });
  }
}

function sanitizeForId(s: string | undefined): string {
  if (!s) return "";
  // Avoid whitespace in IDs; keep pipes as delimiters
  return s.trim().replace(/\s+/g, "_");
}

function pad4(n: number | undefined): string {
  if (!Number.isFinite(n)) return "0000";
  const v = Math.max(0, Math.min(9999, Math.trunc(n as number)));
  return v.toString().padStart(4, "0");
}

// Simple djb2 hash to produce a short, stable suffix
function hash8(input: string): string {
  let h = 5381 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

// ------------------------------------------------------------
// Lexicon (chars + vocab)
// ------------------------------------------------------------
function buildId(type: string, surface: string, r: Reading): string {
  const jp = sanitizeForId(
    Array.isArray(r.jyutping) ? r.jyutping.join(" ") : "",
  );
  // ID scheme uses tone (not pronunciation) per docs and new schema
  const toneToken = r.tone ? `tone${r.tone}` : "tone";
  return `lex|${type}|${surface}|${jp}|${toneToken}`;
}

function buildDocument(n: NormalizedLine, r: Reading): string {
  const prefix = n.type === "char" ? "字" : "詞";
  const surface = n.surface;
  const jyutping = Array.isArray(r.jyutping) ? r.jyutping.join(" ") : "";
  const pronunciation = r.pronunciation ?? "";
  const tone = r.tone ?? "";
  const rhymesStr = Array.isArray(r.rhymes) ? r.rhymes.join(" ") : "";
  const pos = r.pos ?? "";
  const register = r.register ?? "";
  const gloss = r.gloss ?? "";

  // Use full-width parentheses for the first block and ASCII for the rest, per example
  // Example target:
  // 詞：9up（粵音：gau1 ap1, 韻母:au ap, 發音:33, 調：11）(詞性：VERB), (情感: NEUTRAL)。意：([9up])
  return `${prefix}：${surface}（粵音：${jyutping}, 韻母:${rhymesStr}, 發音:${pronunciation}, 調:${tone}）(詞性：${pos}), (情感: ${register})。意：(${gloss})。`;
}

function toChromaLexiconJSONLines(
  inputJsonl: string,
  typeHint: "char" | "vocab",
  producedIds: Set<string>,
) {
  const lines = inputJsonl.split(/\r?\n/).filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    let obj: NormalizedLine | undefined;
    try {
      obj = JSON.parse(line) as NormalizedLine;
    } catch {
      continue; // skip invalid JSON lines
    }
    if (!obj || typeof obj.surface !== "string") continue;
    const type = (obj.type as string) || typeHint || "vocab";
    const base: NormalizedLine = { ...obj, type };
    if (!Array.isArray(base.readings) || base.readings.length === 0) continue;

    for (const r of base.readings) {
      const id = buildId(type, base.surface, r);
      if (producedIds.has(id)) continue; // skip duplicates
      const document = buildDocument(base, r);
      const metadata = {
        surface: base.surface,
        type: type,
        lang: base.lang ?? "",
        jyutping: Array.isArray(r.jyutping) ? r.jyutping.join(" ") : "",
        pronunciation: r.pronunciation ?? "",
        tone: r.tone ?? "",
        // No arrays in metadata (Chroma restriction); keep stringified variants
        consonantsStr: Array.isArray(r.consonants) ? r.consonants.join(" ") : "",
        rhymesStr: Array.isArray(r.rhymes) ? r.rhymes.join(" ") : "",
        syllables: r.syllables,
        pos: r.pos ?? "",
        register: r.register ?? "",
        freq: r.freq,
        gloss: r.gloss ?? "",
        source: r.source ?? "",
      } as Record<string, unknown>;

      // Add per-syllable fields for simple equality filters (e.g., consonant1, rhyme1)
      const cList = Array.isArray(r.consonants) ? r.consonants : [];
      const rList = Array.isArray(r.rhymes) ? r.rhymes : [];
      for (let i = 0; i < Math.max(cList.length, rList.length); i++) {
        if (cList[i]) (metadata as any)[`consonant${i + 1}`] = cList[i];
        if (rList[i]) (metadata as any)[`rhyme${i + 1}`] = rList[i];
      }

      out.push(JSON.stringify({ id, document, metadata }));
      producedIds.add(id);
    }
  }
  return out.join("\n");
}

// ------------------------------------------------------------
// Lyrics
// ------------------------------------------------------------
function groupTonePatternByTokens(tonePattern: number[], tokens: any[]): string {
  if (!tonePattern.length || !tokens.length) return tonePattern.join(" ");
  const groups: string[] = [];
  let index = 0;
  for (const token of tokens) {
    const sylCount = token.text?.length ?? 1; // Assume 1 syllable per character
    if (index + sylCount > tonePattern.length) break;
    const group = tonePattern.slice(index, index + sylCount).join("");
    groups.push(group);
    index += sylCount;
  }
  return groups.join(" ");
}

function buildLyricId(
  docId: string | undefined,
  lineIndex: number | undefined,
  text: string,
): string {
  const cleanDocId = sanitizeForId(docId) || "doc";
  return `lyr|${cleanDocId}|${pad4(lineIndex)}|${hash8(text)}`;
}

function buildLyricDocument(l: LyricLine): string {
  const line = l.text ?? "";
  const themes = (l.semantics?.themes ?? []).join(" ");
  const keywords = (l.semantics?.keywords ?? []).join(" ");
  const sentiment = l.semantics?.sentiment ?? "";
  const title = l.source?.title ?? "";
  // 句：[line]（主題：…；關鍵詞：…；情感：…）— [歌名]
  return `句：${line}（主題：${themes}；關鍵詞：${keywords}；情感：${sentiment}）— ${title}`;
}

function toChromaLyricsJSONLines(inputJsonl: string, producedIds: Set<string>) {
  const lines = inputJsonl.split(/\r?\n/).filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    let obj: LyricLine | undefined;
    try {
      obj = JSON.parse(line) as LyricLine;
    } catch {
      continue;
    }
    if (!obj || typeof obj.text !== "string") continue;
    const id = buildLyricId(obj.context_links?.doc_id, obj.structure?.line_index, obj.text);
    if (producedIds.has(id)) continue;

    const document = buildLyricDocument(obj);
    const artists = obj.source?.artists ?? [];
    const lyricists = obj.source?.lyricists ?? [];
    const genres = obj.source?.genre ?? [];
    const themes = obj.semantics?.themes ?? [];
    const keywords = obj.semantics?.keywords ?? [];
    const metadata: Record<string, unknown> = {
      type: "lyric",
      lang: "zh-HK",
      text: obj.text ?? "",
      docId: obj.context_links?.doc_id ?? "",
      lineIndex: obj.structure?.line_index,
      paragraphId: obj.context_links?.paragraph_id ?? "",
      prevLineId: obj.context_links?.prev_line_id ?? "",
      nextLineId: obj.context_links?.next_line_id ?? "",
      charCount: obj.structure?.char_count,
      title: obj.source?.title ?? "",
      artistsStr: artists.join("|"),
      lyricistsStr: lyricists.join("|"),
      year: obj.source?.year ?? 0,
      genresStr: genres.join("|"),
      themesStr: themes.join("|"),
      sentiment: obj.semantics?.sentiment ?? "",
      keywordsStr: keywords.join("|"),
      tonePatternStr: groupTonePatternByTokens(
        obj.prosody?.tone_pattern ?? [],
        obj.nlp?.tokens ?? [],
      ),
      jyutping: (obj.prosody?.tone_pattern_cantonese_jyutping ?? []).join(" "),
      syllables: (obj.prosody?.tone_pattern_cantonese_jyutping ?? []).length ||
        obj.structure?.char_count,
      hasProsody: Boolean(obj.prosody),
      hasNlp: Boolean(obj.nlp),
    };

    // Convenience first-N fields for equality filters
    if (artists[0]) metadata["artist1"] = artists[0];
    if (lyricists[0]) metadata["lyricist1"] = lyricists[0];
    if (genres[0]) metadata["genre1"] = genres[0];
    if (genres[1]) metadata["genre2"] = genres[1];
    if (themes[0]) metadata["theme1"] = themes[0];
    if (themes[1]) metadata["theme2"] = themes[1];
    if (themes[2]) metadata["theme3"] = themes[2];

    out.push(JSON.stringify({ id, document, metadata }));
    producedIds.add(id);
  }
  return out.join("\n");
}

async function readAllJsonlUnder(dir: string): Promise<string> {
  const chunks: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        chunks.push(await readAllJsonlUnder(full));
      } else if (entry.isFile && entry.name.endsWith(".jsonl")) {
        try {
          const txt = await Deno.readTextFile(full);
          chunks.push(txt);
        } catch {
          // skip unreadable files
        }
      }
    }
  } catch {
    // directory may not exist; return empty
  }
  return chunks.filter(Boolean).join("\n");
}

async function main() {
  const args = Deno.args;
  const charsIn = args[0] || "data/preprocess/lexicon/chars.posr.jsonl";
  const vocabIn = args[1] || "data/preprocess/lexicon/vocab.posr.jsonl";
  const lyricsDir = args[2] || "data/preprocess/lyrics"; // recursive root
  const charsOut = args[3] || "data/vector/chroma-chars.jsonl";
  const vocabOut = args[4] || "data/vector/chroma-vocab.jsonl";
  const lyricsOut = args[5] || "data/vector/chroma-lyrics.jsonl";
  const lexiconOut = args[6] || "data/vector/chroma-lexicon.jsonl";

  try {
    await Deno.stat(charsIn);
  } catch {
    logger.error(`❌ Missing input file: ${charsIn}`);
    Deno.exit(1);
  }
  try {
    await Deno.stat(vocabIn);
  } catch {
    logger.error(`❌ Missing input file: ${vocabIn}`);
    Deno.exit(1);
  }

  logger.info(`🔄 Reading: ${charsIn}`);
  const charsRaw = await Deno.readTextFile(charsIn);
  logger.info(`🔄 Reading: ${vocabIn}`);
  const vocabRaw = await Deno.readTextFile(vocabIn);

  // Lyrics are optional; if directory exists, we will aggregate JSONL contents recursively
  let lyricsRaw = "";
  try {
    await Deno.stat(lyricsDir);
    logger.info(`🔄 Reading lyrics from: ${lyricsDir} (recursive)`);
    lyricsRaw = await readAllJsonlUnder(lyricsDir);
  } catch {
    logger.warn?.(`⚠️ Lyrics directory not found: ${lyricsDir} (skipping)`);
  }

  logger.info(`🧪 Converting chars -> Chroma JSONL`);
  const producedIds = new Set<string>();
  const charsChroma = toChromaLexiconJSONLines(charsRaw, "char", producedIds);

  logger.info(`🧪 Converting vocab -> Chroma JSONL`);
  const vocabChroma = toChromaLexiconJSONLines(vocabRaw, "vocab", producedIds);

  let lyricsChroma = "";
  if (lyricsRaw.trim()) {
    logger.info(`🧪 Converting lyrics -> Chroma JSONL`);
    lyricsChroma = toChromaLyricsJSONLines(lyricsRaw, producedIds);
  }

  await ensureDirFor(charsOut);
  await ensureDirFor(vocabOut);
  await ensureDirFor(lyricsOut);
  await ensureDirFor(lexiconOut);

  await Deno.writeTextFile(charsOut, charsChroma + (charsChroma ? "\n" : ""));
  logger.info(
    `✅ Wrote ${charsOut} (${charsChroma.split(/\n/).filter(Boolean).length} lines)`,
  );

  await Deno.writeTextFile(vocabOut, vocabChroma + (vocabChroma ? "\n" : ""));
  logger.info(
    `✅ Wrote ${vocabOut} (${vocabChroma.split(/\n/).filter(Boolean).length} lines)`,
  );

  if (lyricsChroma) {
    await Deno.writeTextFile(lyricsOut, lyricsChroma + (lyricsChroma ? "\n" : ""));
    logger.info(
      `✅ Wrote ${lyricsOut} (${lyricsChroma.split(/\n/).filter(Boolean).length} lines)`,
    );
  }

  const merged = [charsChroma, vocabChroma].filter(Boolean).join("\n");
  await Deno.writeTextFile(lexiconOut, merged + (merged ? "\n" : ""));
  logger.info(
    `✅ Wrote ${lexiconOut} (${merged.split(/\n/).filter(Boolean).length} lines)`,
  );

  // Show a few samples
  const show = (label: string, s: string) => {
    const lines = s.split(/\n/).filter(Boolean);
    logger.info(`\n📋 Sample (${label}):`);
    for (const [i, line] of lines.slice(0, 3).entries()) {
      try {
        const j = JSON.parse(line);
        logger.info(
          `${i + 1}. id=${j.id} document=${j.document.substring(0, 80)}…`,
        );
      } catch {
        logger.info(`${i + 1}. ${line.substring(0, 80)}…`);
      }
    }
  };
  show("chars", charsChroma);
  show("vocab", vocabChroma);
  if (lyricsChroma) show("lyrics", lyricsChroma);
}

if (import.meta.main) {
  main();
}
