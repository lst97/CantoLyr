// SegmentationService (Application Layer)
// Orchestrates domain segmentation and builds digit set + warnings
// NOTE: Pure synchronous logic; no IO. Domain algorithm already deterministic.

import { generatePatterns } from "../../domain/lyric/segmentation.ts";
import { SegmentationPattern } from "../../domain/lyric/entities.ts";
import { LyricErrorCode, LyricWarningCode } from "../../shared/lyric-codes.ts";

export interface SegmentationResult {
  raw: string;
  patterns: SegmentationPattern[];
  digitSet: string[]; // unique groups across all patterns
  warnings: string[]; // warning codes
}

export class SegmentationService {
  constructor(private readonly maxLength = 20) {}

  segment(toneSequence: string, seed?: number): SegmentationResult {
    if (typeof toneSequence !== "string" || toneSequence.length === 0) {
      throw new Error(LyricErrorCode.ERROR_INVALID_INPUT);
    }
    if (!/^[0-9]+$/.test(toneSequence)) {
      throw new Error(LyricErrorCode.ERROR_INVALID_INPUT);
    }
    // Validate allowed digits per spec: {0,2,3,4,5,9}
    const allowedSingles = new Set(["0", "2", "3", "4", "5", "9"]);
    for (const ch of toneSequence) {
      if (!allowedSingles.has(ch)) {
        throw new Error("INVALID_DIGIT");
      }
    }
    if (toneSequence.length > this.maxLength) {
      throw new Error("TOO_LONG");
    }

    const patterns = generatePatterns(toneSequence, seed);
    // Build digit set = union of groups across patterns (dedupe)
    const set = new Set<string>();
    for (const p of patterns) {
      for (const g of p.groups) set.add(g);
    }
    const digitSet = Array.from(set);

    const warnings: string[] = [];
    if (digitSet.length < patterns.reduce<number>((acc, p) => Math.max(acc, p.groups.length), 0)) {
      warnings.push(LyricWarningCode.WARN_LOW_SEMANTIC); // reuse as generic coverage warning (placeholder)
    }

    return { raw: toneSequence, patterns, digitSet, warnings };
  }
}

export default SegmentationService;
