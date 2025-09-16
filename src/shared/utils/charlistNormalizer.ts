/**
 * Normalizer for charlist.json data format
 * Converts character frequency data to standardized Entry/Reading format
 */

import { normalizeJyutping } from "./jyutping.ts";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NormalizedEntry, NormalizedReading } from "../types/data.ts";
import { getLogger } from "jsr:@std/log";

const logger = getLogger();

export interface CharlistData {
  [surface: string]: {
    [jyutping: string]: number; // frequency
  };
}

/**
 * Determines if a surface text should be classified as 'char' or 'vocab'
 */
function determineEntryType(surface: string): "char" | "vocab" {
  // Single character entries are 'char', multi-character are 'vocab'
  return surface.length === 1 ? "char" : "vocab";
}

/**
 * Determines the language based on surface text characteristics
 */
function determineLanguage(surface: string): string {
  // ASCII letters and digits
  if (/^[A-Za-z0-9]$/.test(surface)) {
    return "misc";
  }

  // Chinese characters (CJK Unified Ideographs and extensions)
  // Only match actual Chinese characters, not punctuation or symbols
  if (/^[\u4e00-\u9fff\u3400-\u4dbf]$/.test(surface)) {
    return "zh-HK";
  }

  // Default to misc for other characters (punctuation, symbols, etc.)
  return "misc";
}

// ---- Cantonese Pinyin Table loading and helpers ----
type CantonesePinyinTable = {
  consonants: string[];
  rhymes: string[];
  tones: Record<string, string>;
};

let CANTONESE_TABLE: CantonesePinyinTable | null = null;

function loadCantoneseTable(): CantonesePinyinTable {
  if (CANTONESE_TABLE) return CANTONESE_TABLE;
  const tablePath = path.resolve(
    Deno.cwd(),
    "data/sample/cantonese_pinyin_table.json",
  );
  const raw = readFileSync(tablePath, "utf-8");
  CANTONESE_TABLE = JSON.parse(raw) as CantonesePinyinTable;
  return CANTONESE_TABLE!;
}

function mapTonesToPronunciation(original: string): string {
  const table = loadCantoneseTable();
  return original
    .split("")
    .map(
      (d) =>
        table.tones[d] ??
          (() => {
            throw new Error(`Invalid original tone digit: "${d}"`);
          })(),
    )
    .join("");
}

function splitSyllable(s: string): {
  initial: string;
  rhyme: string;
  tone: string;
} {
  const table = loadCantoneseTable();
  const m = s.match(/^([a-z]+?)([1-6])$/);
  if (!m) {
    // Try special cases like "m4" or "ng4" or malformed tokens; best-effort
    const t = s.match(/[1-6](?=[^1-6]*$)/)?.[0] ?? "";
    const base = t ? s.replace(new RegExp(`${t}$`), "") : s;
    return { initial: "", rhyme: base, tone: t };
  }
  const base = m[1];
  const tone = m[2];
  // Choose the longest matching initial
  const initials = table.consonants.slice().sort((a, b) => b.length - a.length);
  let initial = "";
  for (const c of initials) {
    if (base?.startsWith(c)) {
      initial = c;
      break;
    }
  }
  const rhyme = base?.slice(initial.length);
  // If rhyme not in table, keep as-is (best effort)
  return { initial, rhyme: rhyme!, tone: tone! };
}

function groupTokensIntoKGroups(tokens: string[], k: number): string[] {
  if (k <= 1) return [tokens.join(" ")];
  if (tokens.length === k) return tokens.slice();
  const groups: string[][] = Array.from({ length: k }, () => []);
  let idx = 0;
  for (const tok of tokens) {
    groups[idx]?.push(tok);
    // Distribute as evenly as possible
    if (idx < k - 1 && groups[idx]!.length > Math.ceil(tokens.length / k)) {
      idx++;
    } else if (idx < k - 1) {
      const remainingTokens = tokens.length - groups.flat().length;
      const remainingGroups = k - 1 - idx;
      const idealNext = Math.ceil(remainingTokens / remainingGroups);
      if (groups[idx]!.length >= idealNext) idx++;
    }
  }
  return groups.map((g) => g.join(" ").trim()).map((s) => (s.length ? s : ""));
}

/**
 * Determines part of speech based on surface text
 */
function determinePOS(
  surface: string,
): import("../types/common.ts").PartOfSpeech {
  // Numbers
  if (/^[0-9]$/.test(surface)) {
    return "NUM";
  }

  // ASCII letters
  if (/^[A-Za-z]$/.test(surface)) {
    return "LETTER";
  }

  // For Chinese characters, default to NOUN
  // In a real system, this would require linguistic analysis
  return "NOUN";
}

/**
 * Generates a gloss (definition) for the character
 */
function generateGloss(surface: string, _pos: string): string {
  // Numbers
  if (/^[0-9]$/.test(surface)) {
    const digitNames = {
      "0": "zero",
      "1": "one",
      "2": "two",
      "3": "three",
      "4": "four",
      "5": "five",
      "6": "six",
      "7": "seven",
      "8": "eight",
      "9": "nine",
    };
    return `digit ${digitNames[surface as keyof typeof digitNames] || surface}`;
  }

  // ASCII letters
  if (/^[A-Za-z]$/.test(surface)) {
    return `Latin letter ${surface.toUpperCase()}`;
  }

  // For Chinese characters, use a generic description
  // In a real system, this would come from a dictionary
  return `Chinese character ${surface}`;
}

/**
 * Normalizes charlist data to standardized Entry format
 */
export function normalizeCharlistData(
  data: CharlistData,
  sourceVersion: string = "words_hk_v28042025",
): NormalizedEntry[] {
  const entries: NormalizedEntry[] = [];

  for (const [surface, jyutpingFreqs] of Object.entries(data)) {
    const entryType = determineEntryType(surface);
    const lang = determineLanguage(surface);
    const pos = determinePOS(surface);

    const readings: NormalizedReading[] = [];
    const seen = new Set<string>();

    for (const [jyutping, freq] of Object.entries(jyutpingFreqs)) {
      try {
        // Normalize jyutping
        const normalizedJyutping = normalizeJyutping(jyutping);

        // Extract per-syllable components
        const syllableTokens = normalizedJyutping.split(/\s+/).filter(Boolean);
        const components = syllableTokens.map(splitSyllable);
        const tone = components.map((c) => c.tone).join("");
        const pronunciation = mapTonesToPronunciation(tone);
        const consonants = components.map((c) => c.initial);
        const rhymes = components.map((c) => c.rhyme);
        const syllables = components.length;

        // Group jyutping by surface tokens length
        const surfaceTokenCount = surface.trim().split(/\s+/).filter(Boolean).length || 1;
        const groupedJyutping = groupTokensIntoKGroups(
          syllableTokens,
          surfaceTokenCount,
        );

        const reading: NormalizedReading = {
          jyutping: groupedJyutping,
          tone,
          pronunciation,
          consonants,
          rhymes,
          syllables,
          freq,
          pos,
          register: "neutral", // Default register for character data
          gloss: generateGloss(surface, pos),
          source: sourceVersion,
        };

        const sig = `${normalizedJyutping}|${tone}`;
        if (!seen.has(sig)) {
          readings.push(reading);
          seen.add(sig);
        }
      } catch (error) {
        logger.warn(
          `Failed to normalize reading "${jyutping}" for character "${surface}":`,
          error,
        );
        continue;
      }
    }

    // Sort readings by frequency (descending)
    readings.sort((a, b) => b.freq - a.freq);

    // Skip entries that have no valid readings (invalid jyutping)
    if (readings.length === 0) {
      continue;
    }

    entries.push({
      surface,
      type: entryType,
      lang,
      readings,
    });
  }

  return entries;
}

/**
 * Converts normalized entries to JSONL format
 */
export function entriesToJSONL(entries: NormalizedEntry[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

/**
 * Main function to process charlist.json and output JSONL
 */
export function processCharlistToJSONL(
  charlistData: CharlistData,
  sourceVersion: string = "words_hk_v28042025",
): string {
  const normalizedEntries = normalizeCharlistData(charlistData, sourceVersion);
  return entriesToJSONL(normalizedEntries);
}
