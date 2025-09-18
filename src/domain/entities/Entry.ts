import { Reading } from "./Reading.ts";
import type { EntryType } from "../../shared/types/common.ts";

/**
 * Entry entity represents a Cantonese character or vocabulary word
 */
export class Entry {
  readonly id: bigint;
  readonly surface: string;
  readonly type: EntryType;
  readonly lang: string;
  readonly readings: Reading[];
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(params: {
    id: bigint;
    surface: string;
    type: EntryType;
    lang: string;
    readings?: Reading[];
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    // Validate surface text
    if (!params.surface || params.surface.trim().length === 0) {
      throw new Error("Surface text cannot be empty");
    }

    // Validate language code
    if (!params.lang || params.lang.trim().length === 0) {
      throw new Error("Language code cannot be empty");
    }

    // Validate entry type matches surface text characteristics
    if (params.type === "char" && params.surface.trim().length > 1) {
      // Allow multi-character entries for char type (some characters may have variants)
      // but log a warning in production
    }

    this.id = params.id;
    this.surface = params.surface.trim();
    this.type = params.type;
    this.lang = params.lang.trim();
    this.readings = params.readings || [];
    this.createdAt = params.createdAt || new Date();
    this.updatedAt = params.updatedAt || new Date();
  }

  /**
   * Add a reading to this entry
   */
  addReading(reading: Reading): Entry {
    // Validate that the reading belongs to this entry
    if (reading.entryId !== this.id) {
      throw new Error("Reading entryId does not match this entry");
    }

    return new Entry({
      id: this.id,
      surface: this.surface,
      type: this.type,
      lang: this.lang,
      readings: [...this.readings, reading],
      createdAt: this.createdAt,
      updatedAt: new Date(),
    });
  }

  /**
   * Get all readings that match a tone pattern
   */
  getReadingsForTonePattern(
    pattern: string,
    isPrefix: boolean = false,
  ): Reading[] {
    return this.readings.filter((reading) => reading.matchesTonePattern(pattern, isPrefix));
  }

  /**
   * Get the primary reading (highest frequency)
   */
  getPrimaryReading(): Reading | null {
    if (this.readings.length === 0) {
      return null;
    }

    return this.readings.reduce((primary, current) =>
      current.freq > primary.freq ? current : primary
    );
  }

  /**
   * Get all unique tone patterns for this entry
   */
  getTonePatterns(): string[] {
    // pronunciation already stores mapped tone digits
    const patterns = new Set(this.readings.map((r) => r.pronunciation));
    return Array.from(patterns).sort();
  }

  /**
   * Check if this entry has any readings matching the tone pattern
   */
  hasTonePattern(pattern: string, isPrefix: boolean = false): boolean {
    return this.readings.some((reading) => reading.matchesTonePattern(pattern, isPrefix));
  }

  /**
   * Get display information for this entry
   */
  getDisplayInfo(): {
    id: bigint;
    surface: string;
    type: EntryType;
    lang: string;
    readingCount: number;
    tonePatterns: string[];
    primaryReading: Reading | null;
  } {
    return {
      id: this.id,
      surface: this.surface,
      type: this.type,
      lang: this.lang,
      readingCount: this.readings.length,
      tonePatterns: this.getTonePatterns(),
      primaryReading: this.getPrimaryReading(),
    };
  }

  /**
   * Create an Entry from raw data (for data import)
   */
  static fromRawData(params: {
    id: bigint;
    surface: string;
    type: string;
    lang: string;
    readings?: any[];
  }): Entry {
    // Validate and normalize type
    const normalizedType = params.type.toLowerCase();
    if (normalizedType !== "vocab" && normalizedType !== "char") {
      throw new Error(
        `Invalid entry type: ${params.type}. Must be 'vocab' or 'char'`,
      );
    }

    return new Entry({
      id: params.id,
      surface: params.surface,
      type: normalizedType as EntryType,
      lang: params.lang,
      readings: [], // Readings will be added separately
    });
  }
}
