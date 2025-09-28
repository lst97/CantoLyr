/**
 * JSONL parser for streaming large files and normalizing entries
 */

import { TextLineStream } from "jsr:@std/streams/text-line-stream";
import { z } from "zod";
import { ToneMap } from "../../domain/value-objects/ToneMap.ts";
import { countSyllables, extractTones, isValidJyutping, normalizeJyutping } from "./jyutping.ts";
import type {
  NormalizedEntry,
  NormalizedReading,
  ParseResult,
  ParseStats,
  RawEntry,
  RawReading,
} from "../types/data.ts";
import type { PartOfSpeech, Register } from "../types/common.ts";

/**
 * Zod schema for validating raw JSONL entries
 */
const RawReadingSchema = z.object({
  // Accept string or array form for jyutping
  jyutping: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  // New optional fields from updated normalizers
  tone: z.string().optional(),
  pronunciation: z.string().optional(),
  consonants: z.array(z.string()).optional(),
  rhymes: z.array(z.string()).optional(),
  // Existing fields
  freq: z.number(),
  pos: z.string(),
  register: z.string(),
  gloss: z.string(),
  source: z.string(),
});

const RawEntrySchema = z.object({
  surface: z.string().min(1),
  type: z.enum(["vocab", "char"]),
  lang: z.string().min(1),
  readings: z.array(RawReadingSchema).min(1),
});

/**
 * JSONL parser class for streaming and normalizing entries
 */
export class JsonlParser {
  /**
   * Parse a JSONL file and yield normalized entries
   *
   * @param filePath - Path to the JSONL file
   * @yields ParseResult for each line
   */
  async *parseFile(filePath: string): AsyncGenerator<ParseResult> {
    const file = await Deno.open(filePath);
    const lines = file.readable
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream());

    const reader = lines.getReader();
    let lineNumber = 0;
    let done = false;

    while (!done) {
      const { value: line, done: d } = await reader.read();
      done = d;
      if (line !== undefined) {
        lineNumber++;

        // Skip empty lines
        if (line.trim() === "") {
          continue;
        }

        yield this.parseLine(line, lineNumber);
      }
    }
  }

  /**
   * Parse a single JSONL line
   *
   * @param line - Raw JSONL line
   * @param lineNumber - Line number for error reporting
   * @returns ParseResult
   */
  parseLine(line: string, lineNumber: number): ParseResult {
    try {
      // Parse JSON
      const rawData = JSON.parse(line);

      // Validate schema
      const rawEntry = this.validateEntry(rawData);

      // Normalize entry
      const normalizedEntry = this.normalizeEntry(rawEntry);

      return {
        success: true,
        entry: normalizedEntry,
        lineNumber,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        lineNumber,
      };
    }
  }

  /**
   * Validate a raw entry against the expected schema
   *
   * @param entry - Raw entry data
   * @returns Validated RawEntry
   * @throws Error if validation fails
   */
  validateEntry(entry: unknown): RawEntry {
    const result = RawEntrySchema.safeParse(entry);

    if (!result.success) {
      const errors = result.error.issues.map((err: any) => `${err.path.join(".")}: ${err.message}`)
        .join(", ");
      throw new Error(`Schema validation failed: ${errors}`);
    }

    return result.data;
  }

  /**
   * Normalize a raw entry for database insertion
   *
   * @param rawEntry - Raw entry from JSONL
   * @returns Normalized entry
   * @throws Error if normalization fails
   */
  normalizeEntry(rawEntry: RawEntry): NormalizedEntry {
    const normalizedReadings: NormalizedReading[] = [];

    for (const rawReading of rawEntry.readings) {
      try {
        const normalizedReading = this.normalizeReading(rawReading);
        normalizedReadings.push(normalizedReading);
      } catch (error) {
        throw new Error(
          `Failed to normalize reading "${rawReading.jyutping}": ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    }

    if (normalizedReadings.length === 0) {
      throw new Error("No valid readings found after normalization");
    }

    return {
      surface: rawEntry.surface.trim(),
      type: rawEntry.type,
      lang: rawEntry.lang.trim(),
      readings: normalizedReadings,
    };
  }

  /**
   * Normalize a raw reading
   *
   * @param rawReading - Raw reading from JSONL
   * @returns Normalized reading
   * @throws Error if normalization fails
   */
  private normalizeReading(rawReading: RawReading): NormalizedReading {
    // Normalize jyutping (accept array or string)
    const jpInput = Array.isArray(rawReading.jyutping)
      ? rawReading.jyutping.join(" ").trim()
      : rawReading.jyutping;
    const jyutping = normalizeJyutping(jpInput);

    // Validate jyutping
    if (!isValidJyutping(jyutping)) {
      throw new Error(`Invalid jyutping: "${jyutping}"`);
    }

    // Determine original tones: prefer provided 'tone' else extract
    const tone = rawReading.tone && rawReading.tone.trim().length > 0
      ? rawReading.tone.trim()
      : extractTones(jyutping);

    // Map tones
    const pronunciation = rawReading.pronunciation && rawReading.pronunciation.trim().length > 0
      ? rawReading.pronunciation.trim()
      : ToneMap.mapTones(tone).value;

    // Count syllables
    const syllables = countSyllables(jyutping);

    // Normalize part of speech
    const pos = this.normalizePartOfSpeech(rawReading.pos);

    // Normalize register
    const register = this.normalizeRegister(rawReading.register);

    // If raw provides array tokens or decomposition, include them
    const jyutpingTokens = Array.isArray(rawReading.jyutping)
      ? rawReading.jyutping.map((s) => normalizeJyutping(s))
      : jyutping.split(/\s+/);
    const consonants = rawReading.consonants && Array.isArray(rawReading.consonants)
      ? rawReading.consonants
      : undefined;
    const rhymes = rawReading.rhymes && Array.isArray(rawReading.rhymes)
      ? rawReading.rhymes
      : undefined;

    const reading: NormalizedReading = {
      jyutping: jyutpingTokens,
      tone,
      pronunciation,
      syllables,
      freq: rawReading.freq,
      pos,
      register,
      gloss: rawReading.gloss.trim(),
      source: rawReading.source.trim(),
    };

    if (consonants) {
      reading.consonants = consonants;
    }
    if (rhymes) {
      reading.rhymes = rhymes;
    }

    return reading;
  }

  /**
   * Normalize part of speech to known values
   *
   * @param pos - Raw part of speech string
   * @returns Normalized PartOfSpeech
   */
  private normalizePartOfSpeech(pos: string): PartOfSpeech {
    const normalized = pos.toUpperCase().trim();

    const validPOS: PartOfSpeech[] = [
      "NOUN",
      "ADJ",
      "NUM",
      "LETTER",
      "VERB",
      "ADV",
      "PREP",
      "CONJ",
      "INTJ",
      "PRON",
      "DET",
      "PART",
    ];

    if (validPOS.includes(normalized as PartOfSpeech)) {
      return normalized as PartOfSpeech;
    }

    // Map common variations
    const posMapping: Record<string, PartOfSpeech> = {
      "N": "NOUN",
      "NOUN": "NOUN",
      "ADJ": "ADJ",
      "ADJECTIVE": "ADJ",
      "V": "VERB",
      "VERB": "VERB",
      "ADV": "ADV",
      "ADVERB": "ADV",
      "NUM": "NUM",
      "NUMBER": "NUM",
      "NUMERAL": "NUM",
      "PREP": "PREP",
      "PREPOSITION": "PREP",
      "CONJ": "CONJ",
      "CONJUNCTION": "CONJ",
      "INTJ": "INTJ",
      "INTERJECTION": "INTJ",
      "PRON": "PRON",
      "PRONOUN": "PRON",
      "DET": "DET",
      "DETERMINER": "DET",
      "PART": "PART",
      "PARTICLE": "PART",
      "LETTER": "LETTER",
    };

    return posMapping[normalized] || "UNKNOWN";
  }

  /**
   * Normalize register to known values
   *
   * @param register - Raw register string
   * @returns Normalized Register
   */
  private normalizeRegister(register: string): Register {
    const normalized = register.toLowerCase().trim();

    const registerMapping: Record<string, Register> = {
      "formal": "formal",
      "neutral": "neutral",
      "colloquial": "colloquial",
      "standard": "neutral",
      "informal": "colloquial",
      "casual": "colloquial",
    };

    return registerMapping[normalized] || "neutral";
  }

  /**
   * Parse a JSONL file and collect statistics
   *
   * @param filePath - Path to the JSONL file
   * @returns Parse statistics
   */
  async parseFileWithStats(filePath: string): Promise<ParseStats> {
    const stats: ParseStats = {
      totalLines: 0,
      successfulEntries: 0,
      failedEntries: 0,
      errors: [],
    };

    for await (const result of this.parseFile(filePath)) {
      stats.totalLines++;

      if (result.success) {
        stats.successfulEntries++;
      } else {
        stats.failedEntries++;
        stats.errors.push({
          lineNumber: result.lineNumber,
          error: result.error || "Unknown error",
        });
      }
    }

    return stats;
  }
}

/**
 * Convenience function to create a new JSONL parser
 */
export function createJsonlParser(): JsonlParser {
  return new JsonlParser();
}
