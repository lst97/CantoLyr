# Data Model (Phase 1 Updated for Spec v2)

Deterministic three-pattern segmentation, two-layer retrieval (semantic + frequency enrichment), 15
sentence generation, Top 3 ranking, paragraph synthesis.

## Entity Catalog

| Entity              | Purpose                        | Core Fields                                                                                                                                                | Key Invariants                                      |
| ------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| GenerationSession   | Request-scoped orchestration   | id, prompt, seed?, config, createdAt                                                                                                                       | config numeric params >= 0                          |
| ToneSequence        | User tone digits per line      | id, index, raw, digits[], uniqueDigitSet[], segmentationPatterns[3]                                                                                        | exactly 3 patterns; length <= 20                    |
| SegmentationPattern | One deterministic grouping     | id, toneSequenceId, patternIndex (0..2), groups[], patternString, ruleLabel                                                                                | groups cover raw w/ 1–2 digit groups only           |
| SceneIntent         | Micro-scene narrative metadata | id, lineIndex, title, emotions[≥3], microIntent, continuityNotes                                                                                           | emotions distinct, non-empty strings                |
| LexicalCandidate    | Word/phrase candidate          | id, lineIndex, surface, toneDigit, provenanceCategory, frequencyRank?, sceneRelevanceScore?, semanticVectorRef?, excludedFlags[]                           | toneDigit ∈ digitSet; surface non-empty             |
| SentenceCandidate   | Generated sentence attempt     | id, lineIndex, patternId, text, usedSurfaces[], toneComplianceScore, sceneAlignmentScore, continuityScore, diversityPenalty, rawRelevanceScore, finalRank? | usedSurfaces length == pattern.groups length        |
| LineResult          | Aggregated per-line state      | id, index, toneSequenceRef, digitSet[], candidatePoolStats, warnings[], topSentences[≤3]                                                                   | if ERROR_DIGIT_INSUFFICIENT then topSentences empty |
| ParagraphVariant    | Full paragraph alternative     | id, sentences[], coherenceScore, emotionalArcScore, diversityScore, finalRank                                                                              | sentences length == #ToneSequences                  |
| Metrics             | Stage timings & counts         | id, scope (session                                                                                                                                         | line), stage, durationMs, counts(json)              |

## Detailed Definitions

### GenerationSession

config fields (defaults): semanticTarget=200, freqTop=100, freqRandom=50, topKSize=10,
mmrLambda=0.7, minSemanticThreshold=150.

### ToneSequence

- raw: numeric string (validated digits; rejection if forbidden digits present)
- digits[]: raw split into monotonic units (multi-digit tokens preserved if domain requires; spec
  examples treat some like 22,33,25, etc.)
- uniqueDigitSet: set(digits[])
- segmentationPatterns: references to 3 SegmentationPattern entries

### SegmentationPattern

- groups[]: array of strings (each 1–2 digit unit) generated via deterministic rules (baseline,
  shifted, maximal-pair)
- ruleLabel: enum [baseline, shifted, maxPair]
- patternString: join(groups,' ')

### SceneIntent

- title: short phrase (≤ 30 chars)
- microIntent: 1 sentence (≤ 120 chars)
- emotions[]: curated taxonomy (≥3)
- continuityNotes: compressed summary from prior lines

### LexicalCandidate

- provenanceCategory: semantic | freq-top | freq-random
- sceneRelevanceScore: float (semantic only)
- frequencyRank: integer for freq categories
- semanticVectorRef: pointer id in embedding store
- excludedFlags[]: reasons if removed later (record even if excluded)

### SentenceCandidate

- toneComplianceScore: 1.0 required for valid; <1.0 indicates mismatch pre-rejection
- diversityPenalty: applied during ranking (diagnostic)
- rawRelevanceScore: base cross-encoder or heuristic relevance before MMR

### LineResult.candidatePoolStats

Example shape:

```
{
  total: 248,
  semanticCount: 198,
  freqTopCount: 40,
  freqRandomCount: 10,
  perDigit: {
    "22": { total: 20, semantic:15, freqTop:4, freqRandom:1 },
    ...
  }
}
```

### Warnings Enumeration

- WARN_LOW_SEMANTIC
- WARN_DIGIT_COVERAGE
- ERROR_DIGIT_INSUFFICIENT

## Relationships (Textual)

GenerationSession ├─ ToneSequence (ordered) │ └─ SegmentationPattern (exactly 3) ├─ SceneIntent (1
per ToneSequence index) ├─ LineResult (1 per ToneSequence index) │ ├─ LexicalCandidate (many) │ └─
SentenceCandidate (≤15 attempts) ├─ ParagraphVariant (≤3) └─ Metrics (per stage and/or line)

## Invariants

- Exactly 3 SegmentationPatterns per ToneSequence.
- All SegmentationPattern groups collectively reconstruct ToneSequence.raw.
- No group length >2.
- LexicalCandidate.toneDigit ∈ LineResult.digitSet.
- SentenceCandidate.usedSurfaces length == pattern.groups length.
- Top 3 sentences each have toneComplianceScore == 1.0.
- ParagraphVariant.sentences cover every line index exactly once.

## Validation Rules

| Check               | Condition                | Failure Handling                     |
| ------------------- | ------------------------ | ------------------------------------ |
| Tone length         | raw.length <= 20         | Reject sequence                      |
| Digit whitelist     | Each digit token allowed | Reject or warn; spec requires reject |
| Semantic threshold  | semanticCount >= 150     | If <150 add WARN_LOW_SEMANTIC        |
| Digit coverage      | perDigit[d].total >=3    | If <3 mark ERROR_DIGIT_INSUFFICIENT  |
| Sentence compliance | toneComplianceScore == 1 | Exclude from ranking                 |

## Derived Metrics

- semanticCoverageRatio = semanticCount / total.
- digitCoverageRatio = (#digits with ≥3 candidates) / uniqueDigitSet.length.
- paragraphCoherence = f(average continuityScore, emotionalArcScore, penalty(similarity)).

## Ephemeral Structures

- EmbeddingCache (Map<string, vector>)
- NarrativeContextSummary (rolling JSON) updated after each accepted line.
- RankingWorkspace (embeddings + similarity matrix for 15 sentences)

## Persistence Strategy (MVP)

In-memory objects; optional JSON export for auditing (FR-021). Future: persist GenerationSession &
LineResult for reproducibility.

## Open (Non-Blocking)

- Emotion taxonomy finalization.
- Content safety categories list.

---

Phase 1 Data Model updated per spec v2.
