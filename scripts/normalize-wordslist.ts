/**
 * Script to normalize wordslist.json data to JSONL format
 * Usage: deno run -A scripts/normalize-wordslist.ts [input-file] [output-file]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "std/path/mod.ts";
import {
  processWordslistToJSONL,
  type WordslistData,
} from "../src/shared/utils/wordslistNormalizer.ts";

async function main() {
  try {
    const inputFile = Deno.args[0] || "data/sample/wordslist.json";
    const outputFile = Deno.args[1] || "data/normalized/vocab.jsonl";
    const wordDetailFile = Deno.args[2] || "data/sample/word_detail.json";
    const charlistFile = Deno.args[3] || "data/sample/charlist.json";

    console.log(`🔄 Normalizing wordslist data from: ${inputFile}`);

    // Check if input file exists
    if (!existsSync(inputFile)) {
      console.error(`❌ Input file not found: ${inputFile}`);
      Deno.exit(1);
    }

    // Read and parse the wordslist data
    const rawData = readFileSync(inputFile, "utf-8");

    // Handle empty file
    if (!rawData.trim()) {
      console.log(`⚠️  Input file is empty: ${inputFile}`);
      console.log(`📝 Creating empty JSONL file: ${outputFile}`);
      writeFileSync(outputFile, "", "utf-8");
      return;
    }

    let wordslistData: WordslistData = JSON.parse(rawData);

    // Deduplicate: remove words that already exist in charlist
    if (existsSync(charlistFile)) {
      try {
        const rawChar = readFileSync(charlistFile, "utf-8");
        const charData = JSON.parse(rawChar) as Record<string, unknown>;
        const charSurfaces = new Set(Object.keys(charData));
        const before = Object.keys(wordslistData).length;
        const filtered: WordslistData = {};
        for (const [w, arr] of Object.entries(wordslistData)) {
          if (!charSurfaces.has(w)) filtered[w] = arr;
        }
        const after = Object.keys(filtered).length;
        const removed = before - after;
        if (removed > 0) {
          console.log(
            `🧹 Removed ${removed} duplicated entries present in charlist (${before} -> ${after}).`,
          );
        }
        wordslistData = filtered;
      } catch (e) {
        console.warn(
          `⚠️  Failed to load/parse charlist for dedup at ${charlistFile}. Proceeding without dedup.`,
        );
      }
    } else {
      console.log(`ℹ️  Charlist not found, skipping dedup: ${charlistFile}`);
    }

    console.log(`📊 Processing ${Object.keys(wordslistData).length} words...`);

    // Process the data
    let jsonlOutput = processWordslistToJSONL(
      wordslistData,
      "words_hk_v28042025",
    );

    // Apply word frequency overrides from book_word_freq.ts (per-million)
    // Only apply to multi-character words (length > 1)
    const bookWordFreqFile = process.argv[6] || "data/sample/book_word_freq.ts";
    if (existsSync(bookWordFreqFile)) {
      console.log(
        `📐 Applying word frequency overrides from: ${bookWordFreqFile}`,
      );
      const freqMap = loadWordFreqPerMillion(bookWordFreqFile);
      if (freqMap.size > 0) {
        // Compute a conservative baseline so any word present in book freq
        // is strictly higher than non-listed words
        const values = Array.from(freqMap.values()).filter(
          (v) => Number.isFinite(v) && v > 0,
        );
        const minPositive = values.length ? Math.min(...values) : undefined;
        const baseline = minPositive !== undefined ? Math.max(1e-6, minPositive / 2) : 1e-6;
        console.log(
          `   ↳ Using baseline freq for missing words: ${baseline.toFixed(6)}`,
        );
        const lines = jsonlOutput.split("\n").filter(Boolean);
        const updated: string[] = [];
        let changed = 0;
        let baselineApplied = 0;
        let skippedZhHK = 0;
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (
              entry &&
              entry.type === "vocab" &&
              typeof entry.surface === "string" &&
              entry.surface.length > 1 &&
              Array.isArray(entry.readings)
            ) {
              // Keep zh-HK frequencies as-is (default 1)
              if (entry.lang === "zh-HK") {
                skippedZhHK++;
              } else {
                const override = freqMap.get(entry.surface);
                if (typeof override === "number") {
                  for (const r of entry.readings) r.freq = override;
                  changed++;
                } else {
                  for (const r of entry.readings) r.freq = baseline;
                  baselineApplied++;
                }
              }
            }
            updated.push(JSON.stringify(entry));
          } catch {
            updated.push(line);
          }
        }
        jsonlOutput = updated.join("\n");
        console.log(
          `🎚️  Word frequency overrides applied to ${changed} vocab entries; baseline set on ${baselineApplied}; skipped zh-HK: ${skippedZhHK}.`,
        );
      } else {
        console.log("ℹ️  No valid word frequency overrides found. Skipping.");
      }
    } else {
      console.log(
        `ℹ️  Word frequency file not found, keeping original freqs: ${bookWordFreqFile}`,
      );
    }

    // Enrich with word_detail.json if available: set gloss from explanation and lang to zh-TW
    if (existsSync(wordDetailFile)) {
      console.log(`🔎 Enriching with details from: ${wordDetailFile}`);
      const rawDetail = readFileSync(wordDetailFile, "utf-8");
      type WordDetailItem = { word: string; explanation?: string };
      let details: WordDetailItem[] = [];
      try {
        const parsed = JSON.parse(rawDetail);
        details = Array.isArray(parsed) ? (parsed as WordDetailItem[]) : [parsed as WordDetailItem];
      } catch {
        // Fallback: parse as concatenated JSON objects
        const objs: string[] = [];
        let depth = 0,
          inStr = false,
          esc = false,
          start = -1;
        for (let i = 0; i < rawDetail.length; i++) {
          const ch = rawDetail[i];
          if (inStr) {
            if (esc) esc = false;
            else if (ch === "\\") esc = true;
            else if (ch === '"') inStr = false;
          } else {
            if (ch === '"') inStr = true;
            else if (ch === "{") {
              if (depth === 0) start = i;
              depth++;
            } else if (ch === "}") {
              depth--;
              if (depth === 0 && start >= 0) {
                objs.push(rawDetail.slice(start, i + 1));
                start = -1;
              }
            }
          }
        }
        details = objs
          .map((s, idx) => {
            try {
              return JSON.parse(s) as WordDetailItem;
            } catch {
              console.warn(
                `Skipping invalid JSON object #${idx + 1} in detail file`,
              );
              return null as unknown as WordDetailItem;
            }
          })
          .filter(
            (x): x is WordDetailItem => !!x && typeof (x as any).word === "string",
          );
      }

      const glossMap = new Map<string, string>();
      for (const item of details) {
        if (!item || typeof item.word !== "string") continue;
        const gloss = (item.explanation || "").trim();
        if (gloss) glossMap.set(item.word, gloss);
      }

      const lines = jsonlOutput.split("\n").filter(Boolean);
      const updated: string[] = [];
      let enriched = 0;
      let untouched = 0;
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const gloss = glossMap.get(entry.surface);
          if (gloss) {
            entry.lang = "zh-TW";
            if (Array.isArray(entry.readings)) {
              for (const r of entry.readings) r.gloss = gloss;
            }
            enriched++;
            updated.push(JSON.stringify(entry));
          } else {
            // keep as-is
            untouched++;
            updated.push(line);
          }
        } catch {
          // keep unparseable lines as-is
          untouched++;
          updated.push(line);
        }
      }
      jsonlOutput = updated.join("\n");
      console.log(
        `🧴 Enriched ${enriched} vocab entries with gloss; ${untouched} unchanged.`,
      );
    } else {
      console.log(
        `ℹ️  Detail file not found, skipping enrichment: ${wordDetailFile}`,
      );
    }

    // Apply sentiment-based register/POS updates (coarse then detailed)
    const coarseSentPath = "data/sample/sentiment_dict/sentiment_dictionary.json";
    const detailedSentPath = "data/sample/sentiment_dict/大連理工情感詞彙本體/sentiments.json";
    let coarseMap = new Map<string, string>();
    let detailedRegMap = new Map<string, string>();
    let detailedPosMap = new Map<string, string>();
    if (existsSync(coarseSentPath)) {
      try {
        const raw = readFileSync(coarseSentPath, "utf-8");
        const obj = JSON.parse(raw) as Record<string, string[]>;
        for (const [k, arr] of Object.entries(obj)) {
          const keyUpper = k.toUpperCase();
          if (Array.isArray(arr)) {
            for (const w of arr) {
              if (typeof w === "string" && w.trim()) {
                coarseMap.set(w.trim(), keyUpper);
              }
            }
          }
        }
        console.log(`🧭 Loaded coarse sentiments for ${coarseMap.size} terms.`);
      } catch {
        console.warn(
          `⚠️  Failed to parse coarse sentiment dictionary at ${coarseSentPath}`,
        );
      }
    } else {
      console.log(
        `ℹ️  Coarse sentiment dictionary not found: ${coarseSentPath}`,
      );
    }

    if (existsSync(detailedSentPath)) {
      try {
        const raw = readFileSync(detailedSentPath, "utf-8");
        const arr = JSON.parse(raw) as Array<Record<string, any>>;
        for (const it of arr) {
          if (!it) continue;
          const w = (it["詞語"] ?? it["word"] ?? it["surface"]) as
            | string
            | undefined;
          if (typeof w !== "string" || !w.trim()) continue;
          const reg = (it["情感分類"] ?? it["register"]) as string | undefined;
          const pos = (it["詞性種類"] ?? it["pos"]) as string | undefined;
          if (typeof reg === "string" && reg.trim()) {
            detailedRegMap.set(w.trim(), reg.trim().toUpperCase());
          }
          if (typeof pos === "string" && pos.trim()) {
            detailedPosMap.set(w.trim(), pos.trim().toUpperCase());
          }
        }
        console.log(
          `🧭 Loaded detailed sentiments for ${detailedRegMap.size} terms; POS for ${detailedPosMap.size}.`,
        );
      } catch {
        console.warn(
          `⚠️  Failed to parse detailed sentiment dictionary at ${detailedSentPath}`,
        );
      }
    } else {
      console.log(
        `ℹ️  Detailed sentiment dictionary not found: ${detailedSentPath}`,
      );
    }

    if (
      coarseMap.size > 0 ||
      detailedRegMap.size > 0 ||
      detailedPosMap.size > 0
    ) {
      const lines2 = jsonlOutput.split("\n").filter(Boolean);
      const updated2: string[] = [];
      let coarseApplied = 0,
        regReplaced = 0,
        posReplaced = 0;
      for (const line of lines2) {
        try {
          const entry = JSON.parse(line);
          const surface = entry?.surface as string | undefined;
          if (surface && Array.isArray(entry?.readings)) {
            const c = coarseMap.get(surface);
            if (typeof c === "string") {
              for (const r of entry.readings) r.register = c;
              coarseApplied++;
            }
            const dReg = detailedRegMap.get(surface);
            if (typeof dReg === "string") {
              for (const r of entry.readings) r.register = dReg;
              regReplaced++;
            }
            const dPos = detailedPosMap.get(surface);
            if (typeof dPos === "string") {
              for (const r of entry.readings) r.pos = dPos;
              posReplaced++;
            }
          }
          updated2.push(JSON.stringify(entry));
        } catch {
          updated2.push(line);
        }
      }
      jsonlOutput = updated2.join("\n");
      console.log(
        `🧾 Sentiment updates -> coarse: ${coarseApplied}, detailed register: ${regReplaced}, POS: ${posReplaced}`,
      );
    }

    // Ensure output directory exists and write file
    mkdirSync(dirname(outputFile), { recursive: true });
    writeFileSync(outputFile, jsonlOutput, "utf-8");

    console.log(`✅ Normalized data written to: ${outputFile}`);

    if (jsonlOutput.trim()) {
      const lines = jsonlOutput.split("\n").filter((line) => line.trim());
      console.log(`📊 Generated ${lines.length} entries`);

      // Show sample output
      console.log("\n📋 Sample normalized entries:");
      lines.slice(0, 5).forEach((line, index) => {
        const entry = JSON.parse(line);
        console.log(
          `${
            index + 1
          }. ${entry.surface} (${entry.type}, ${entry.lang}) - ${entry.readings.length} reading(s)`,
        );
      });

      if (lines.length > 5) {
        console.log(`... and ${lines.length - 5} more entries`);
      }

      // Show statistics
      const entries = lines.map((line) => JSON.parse(line));
      const vocabEntries = entries.filter((e) => e.type === "vocab").length;
      const zhEntries = entries.filter((e) => e.lang === "zh-HK").length;
      const zhTWEntries = entries.filter((e) => e.lang === "zh-TW").length;
      const enEntries = entries.filter((e) => e.lang === "en").length;
      const miscEntries = entries.filter((e) => e.lang === "misc").length;

      console.log("\n📈 Statistics:");
      console.log(`   Vocabulary entries: ${vocabEntries}`);
      console.log(`   Chinese (zh-HK): ${zhEntries}`);
      console.log(`   Chinese (zh-TW): ${zhTWEntries}`);
      console.log(`   English: ${enEntries}`);
      console.log(`   Miscellaneous: ${miscEntries}`);
    } else {
      console.log(`📊 No valid entries generated`);
    }
  } catch (error) {
    console.error("❌ Error normalizing wordslist data:", error);
    process.exit(1);
  }
}

// Load word raw counts from a file like data/sample/book_word_freq.ts and return per-million frequencies
function loadWordFreqPerMillion(filePath: string): Map<string, number> {
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split(/\r?\n/);
  const pairs: Array<{ w: string; c: number }> = [];

  // Try to parse as TSV-like lines: <word>\t<count>
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*")
    ) {
      continue;
    }
    // Remove potential trailing commas or semicolons
    const clean = trimmed.replace(/[;,]$/, "");
    // Try simple tab or whitespace split (word may contain spaces rarely; prefer last numeric token)
    const match = clean.match(/^(.*?)\s+(\d+(?:\.\d+)?)(?:\s*)$/);
    if (match) {
      const w = match[1]?.trim();
      const c = Number(match[2]);
      if (w && Number.isFinite(c)) {
        pairs.push({ w, c });
      }
    }
  }

  // Fallback: if no pairs parsed, try JSON (array or object)
  if (pairs.length === 0) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const it of parsed as any[]) {
          if (!it) continue;
          const w = (it.word ?? it.surface ?? it.w ?? it[0]) as
            | string
            | undefined;
          const c = (it.count ?? it.freq ?? it.c ?? it[1]) as
            | number
            | undefined;
          if (
            typeof w === "string" &&
            typeof c === "number" &&
            Number.isFinite(c)
          ) {
            pairs.push({ w, c });
          }
        }
      } else if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed as Record<string, any>)) {
          const c = Number(v);
          if (k && Number.isFinite(c)) pairs.push({ w: k, c });
        }
      }
    } catch {
      // ignore
    }
  }

  if (pairs.length === 0) return new Map();

  // Sum total counts
  const total = pairs.reduce((acc, p) => acc + p.c, 0);
  if (!Number.isFinite(total) || total <= 0) return new Map();

  // Convert to per-million frequency
  const map = new Map<string, number>();
  for (const { w, c } of pairs) {
    // Skip single-character tokens as requested
    if (typeof w === "string" && w.length > 1) {
      const perMillion = (c / total) * 1_000_000;
      map.set(w, perMillion);
    }
  }
  return map;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
