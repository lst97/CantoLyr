# Contract Ports (Phase 1)

## Overview

Abstract interfaces (conceptual) to enable test-first development. Concrete implementations
deferred.

## Port: SegmentationService

- Method: generateVariants(toneSequence: string, count=3) -> SegmentVariant[]
- Errors: InvalidToneSequenceError, InsufficientVariantsError

## Port: RetrievalService

- Method: buildCandidatePool(context: { lineIndex: number; scene: SceneOutline; toneSequence:
  ToneSequence; variants: SegmentVariant[] }) -> { candidates: LexicalCandidate[]; summary:
  RetrievalSummary }
- Guarantees: attempts fallback if coverage < threshold

## Port: GenerationService

- Method: generateSentences(input: { scene: SceneOutline; variant: SegmentVariant; lexicalMap:
  Record<string, LexicalCandidate[]>; continuity: string[] }) -> SentenceCandidate[]
- Constraints: outputs length == configured attempts (default 5) unless irrecoverable failure

## Port: RankingService

- Method: rankAndSelect(input: { sentences: SentenceCandidate[]; targetCount: number; scene:
  SceneOutline; continuity: string[] }) -> SentenceCandidate[]
- Includes: relevance scoring + MMR diversity

## Port: ContinuityService

- Method: updateContext(prior: string[], accepted: string) -> { updatedContext: string[];
  narrativeSummary: string }

## Port: ToneValidationService

- Method: validate(sequence: string) -> { valid: boolean; reason?: string }

## Non-Functional Expectations

- Deterministic segmentation for same random seed.
- Idempotent retrieval for identical inputs (modulo random exploratory injection flagged in
  metadata).
- Ranking stable under identical scoring inputs.

## Test Contracts (Planned)

- Segmentation: ensures probability distribution for 3-length groups ~10% over large sample
  (statistical test tolerance ±5%).
- Retrieval: ensures min pool coverage per unique digit.
- Generation: all outputs use only provided lexical candidates.
- Ranking: MMR result contains no pair with similarity > configured threshold (e.g., 0.9).

## Pending Clarifications

- Do multi-digit groups map to multiple lexical units or compound lexical item? (Assume 1 group → 1
  lexical unit for v1)
