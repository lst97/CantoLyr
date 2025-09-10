/**
 * Types for data normalization and JSONL parsing
 */

import { EntryType, PartOfSpeech, Register } from "./common.js";

/**
 * Raw entry structure as it appears in JSONL files
 */
export interface RawEntry {
  surface: string;
  type: EntryType;
  lang: string;
  readings: RawReading[];
}

/**
 * Raw reading structure as it appears in JSONL files
 */
export interface RawReading {
  // Updated: allow array form matching surface tokenization
  jyutping: string | string[];
  // New optional fields accepted from newer normalizers
  tone?: string | undefined; // original tones
  pronunciation?: string | undefined; // mapped tones
  consonants?: string[] | undefined;
  rhymes?: string[] | undefined;
  // Existing fields
  freq: number;
  pos: string;
  register: string;
  gloss: string;
  source: string;
}

/**
 * Normalized entry structure ready for database insertion
 */
export interface NormalizedEntry {
  surface: string;
  type: EntryType;
  lang: string;
  readings: NormalizedReading[];
}

/**
 * Normalized reading structure with extracted and mapped tones
 */
export interface NormalizedReading {
  jyutping: string[];
  tone: string;
  pronunciation: string;
  consonants?: string[];
  rhymes?: string[];
  syllables: number;
  freq: number;
  pos: PartOfSpeech;
  register: Register;
  gloss: string;
  source: string;
}

/**
 * Result of parsing a single JSONL line
 */
export interface ParseResult {
  success: boolean;
  entry?: NormalizedEntry;
  error?: string;
  lineNumber: number;
}

/**
 * Statistics from parsing a JSONL file
 */
export interface ParseStats {
  totalLines: number;
  successfulEntries: number;
  failedEntries: number;
  errors: Array<{
    lineNumber: number;
    error: string;
    rawLine?: string;
  }>;
}
