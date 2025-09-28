/**
 * Utilities for normalizing wordslist data to JSONL format
 */

import { normalizeJyutping } from "./jyutping.ts";
import { resolve } from "jsr:@std/path";
import { getLogger } from "jsr:@std/log";

const logger = getLogger();

/**
 * Raw wordslist data structure - maps words to arrays of jyutping pronunciations
 */
export interface WordslistData {
  [word: string]: string[]; // array of jyutping pronunciations
}

/** Normalized reading structure */
export interface WordslistReading {
  jyutping: string[];
  tone: string;
  pronunciation: string;
  consonants: string[];
  rhymes: string[];
  syllables: number;
  freq: number;
  pos: string;
  register: string;
  gloss: string;
  source: string;
}

/** Normalized entry structure */
export interface WordslistEntry {
  surface: string;
  type: "char" | "vocab";
  lang: string;
  readings: WordslistReading[];
}

/**
 * Normalize wordslist data to structured entries
 *
 * @param data - Raw wordslist data
 * @param source - Source identifier for the data
 * @returns Array of normalized entries
 */
export function normalizeWordslistData(
  data: WordslistData,
  source: string = "words_hk_v28042025",
): WordslistEntry[] {
  const entries: WordslistEntry[] = [];

  for (const [word, jyutpingArray] of Object.entries(data)) {
    if (!word || typeof word !== "string" || !Array.isArray(jyutpingArray)) {
      continue;
    }

    const normalizedReadings: WordslistReading[] = [];
    const seen = new Set<string>();

    for (const jyutping of jyutpingArray) {
      try {
        // Sanitize and normalize jyutping
        const sanitized = sanitizeJyutping(jyutping);
        if (!sanitized.trim()) {
          // Skip if empty after sanitization
          continue;
        }
        const normalizedJyutping = normalizeJyutping(sanitized);

        // Extract per-syllable components
        const syllableTokens = normalizedJyutping.split(/\s+/).filter(Boolean);
        const components = syllableTokens.map(splitSyllable);
        const tone = components.map((c) => c.tone).join("");
        const pronunciation = mapTonesToPronunciation(tone);
        const consonants = components.map((c) => c.initial);
        const rhymes = components.map((c) => c.rhyme);
        const syllables = components.length;

        // Group jyutping by surface tokens length
        const surfaceTokenCount = word.trim().split(/\s+/).filter(Boolean).length || 1;
        const groupedJyutping = groupTokensIntoKGroups(
          syllableTokens,
          surfaceTokenCount,
        );

        // Create normalized reading
        const reading: WordslistReading = {
          jyutping: groupedJyutping,
          tone,
          pronunciation,
          consonants,
          rhymes,
          syllables,
          freq: 1, // Default frequency since wordslist doesn't provide frequency data
          pos: determinePOS(word),
          register: inferRegister(word, syllables),
          gloss: generateGloss(word),
          source: source.startsWith("words_hk_v") ? source : `words_hk_v${source}`,
        };

        // Deduplicate readings by jyutping + tone signature
        const sig = `${normalizedJyutping}|${tone}`;
        if (!seen.has(sig)) {
          normalizedReadings.push(reading);
          seen.add(sig);
        }
      } catch (error) {
        logger.warn(
          `Failed to normalize reading "${jyutping}" for word "${word}":`,
          error,
        );
        continue;
      }
    }

    if (normalizedReadings.length > 0) {
      entries.push({
        surface: word.trim(),
        type: determineEntryType(word),
        lang: determineLanguage(word),
        readings: normalizedReadings,
      });
    }
  }

  return entries;
}

/**
 * Convert normalized entries to JSONL format
 *
 * @param entries - Array of normalized entries
 * @returns JSONL string
 */
export function entriesToJSONL(entries: WordslistEntry[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

/**
 * Process wordslist data and convert to JSONL format
 *
 * @param data - Raw wordslist data
 * @param source - Source identifier
 * @returns JSONL string
 */
export function processWordslistToJSONL(
  data: WordslistData,
  source: string = "words_hk_v28042025",
): string {
  const entries = normalizeWordslistData(data, source);
  return entriesToJSONL(entries);
}

/**
 * Determine language based on word characteristics
 *
 * @param word - The word to analyze
 * @returns Language code
 */
function determineLanguage(word: string): string {
  // Digits only → misc
  if (/^[0-9]+$/.test(word)) return "misc";
  // English words (letters, space, hyphen, apostrophe) → en
  if (/^[A-Za-z][A-Za-z\s\-']*$/.test(word)) return "en";
  // Contains Chinese character → zh-HK
  if (
    /[\u4e00-\u9fff\u3400-\u4dbf\u20000-\u2a6df\u2a700-\u2b73f\u2b740-\u2b81f\u2b820-\u2ceaf]/
      .test(
        word,
      )
  ) {
    return "zh-HK";
  }
  // Fallback
  return "misc";
}

function determineEntryType(surface: string): "char" | "vocab" {
  return surface.length === 1 ? "char" : "vocab";
}

/**
 * Infer part of speech based on word characteristics
 *
 * @param word - The word to analyze
 * @param syllables - Number of syllables
 * @returns Part of speech
 */
function determinePOS(word: string): string {
  // Numbers
  if (/^[0-9]+$/.test(word)) return "NUM";
  // ASCII letters only
  if (/^[A-Za-z]$/.test(word)) return "LETTER";
  // Contains Chinese
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(word)) return "NOUN";
  // Default
  return "NOUN";
}

/**
 * Infer register based on word characteristics
 *
 * @param word - The word to analyze
 * @param syllables - Number of syllables
 * @returns Register level
 */
function inferRegister(word: string, syllables: number): string {
  // Simple heuristics for register inference

  // Longer words tend to be more formal
  if (word.length >= 4 || syllables >= 4) {
    return "FORMAL";
  }

  // Single character words are often colloquial
  if (word.length === 1) {
    return "COLLOQUIAL";
  }

  return "NEUTRAL";
}

/**
 * Generate a basic gloss (English translation) for the word
 *
 * @param word - The word to generate gloss for
 * @returns Basic gloss
 */
function generateGloss(word: string): string {
  // Placeholder gloss; preserve previous text shape
  if (/^[0-9]+$/.test(word)) {
    const digitNames: Record<string, string> = {
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
    if (word.length === 1) return `digit ${digitNames[word] ?? word}`;
  }
  if (/^[A-Za-z]+(?:\s+[A-Za-z]+)*$/.test(word)) return `English word ${word}`;
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(word)) return `Chinese word ${word}`;
  return `[${word}]`;
}

/**
 * Sanitize raw jyutping string inputs from wordslist
 * - Removes disruptive symbols like '!' (ASCII) and '！' (full-width)
 */
function sanitizeJyutping(input: string): string {
  if (!input) return "";
  return input.replace(/[!！]/g, "").trim();
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
  const tablePath = resolve(
    Deno.cwd(),
    "data/sample/cantonese_pinyin_table.json",
  );
  const raw = new TextDecoder().decode(Deno.readFileSync(tablePath));
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
    const t = s.match(/[1-6](?=[^1-6]*$)/)?.[0] ?? "";
    const base = t ? s.replace(new RegExp(`${t}$`), "") : s;
    return { initial: "", rhyme: base, tone: t };
  }
  const base = m[1];
  const tone = m[2];
  const initials = table.consonants.slice().sort((a, b) => b.length - a.length);
  let initial = "";
  for (const c of initials) {
    if (base?.startsWith(c)) {
      initial = c;
      break;
    }
  }
  const rhyme = base?.slice(initial.length);
  return { initial, rhyme: rhyme!, tone: tone! };
}

function groupTokensIntoKGroups(tokens: string[], k: number): string[] {
  if (k <= 1) return [tokens.join(" ")];
  if (tokens.length === k) return tokens.slice();
  const groups: string[][] = Array.from({ length: k }, () => []);
  let idx = 0;
  for (const tok of tokens) {
    groups[idx]?.push(tok);
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
