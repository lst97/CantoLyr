// Validation & Invariant Helpers (pure)

import { ParagraphVariant, SegmentationPattern, SentenceCandidate } from "./entities.ts";

export class DomainInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainInvariantError";
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new DomainInvariantError(message);
}

export function validateSegmentationPattern(
  pattern: SegmentationPattern,
): void {
  assert(pattern.id.length > 0, "SegmentationPattern id empty");
  assert(pattern.groups.length > 0, "SegmentationPattern groups empty");
  for (const g of pattern.groups) {
    assert(/^[0-9]{1,2}$/.test(g), `Invalid tone group '${g}'`);
  }
  assert(
    pattern.patternString === pattern.groups.join(" "),
    "patternString mismatch",
  );
}

export function validateSentenceCandidate(c: SentenceCandidate): void {
  assert(c.id.length > 0, "SentenceCandidate id empty");
  assert(c.text.length > 0, "SentenceCandidate text empty");
}

export function validateParagraphVariant(p: ParagraphVariant): void {
  assert(p.sentences.length > 0, "ParagraphVariant empty sentences");
  assert(
    p.finalScore >= 0 && p.finalScore <= 1,
    "ParagraphVariant finalScore out of range",
  );
}

export function safeNormalizeScore(
  value: number | undefined,
  fallback = 0,
): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
