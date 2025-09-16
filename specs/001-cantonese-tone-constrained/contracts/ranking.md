# Contract: Ranking & Diversity Service

## Purpose

Select Top 3 globally best sentences for a line from up to 15 generated candidates using relevance +
MMR diversity.

## Input

```json
{
  "lineIndex": 0,
  "candidates": [
    {
      "id": "c1",
      "text": "...",
      "patternId": "baseline",
      "toneComplianceScore": 1.0,
      "sceneAlignmentScore": 0.86,
      "continuityScore": 0.75
    },
    {
      "id": "c2",
      "text": "...",
      "patternId": "maxPair",
      "toneComplianceScore": 1.0,
      "sceneAlignmentScore": 0.82,
      "continuityScore": 0.70
    }
  ],
  "config": { "topKSize": 10, "mmrLambda": 0.7, "similarityThreshold": 0.9 }
}
```

## Output

```json
{
  "lineIndex": 0,
  "top3": [
    { "id": "c7", "finalRank": 1, "mmrScore": 0.912, "relevance": 0.88, "diversityPenalty": 0.05 },
    { "id": "c3", "finalRank": 2, "mmrScore": 0.897, "relevance": 0.87, "diversityPenalty": 0.07 },
    { "id": "c1", "finalRank": 3, "mmrScore": 0.881, "relevance": 0.86, "diversityPenalty": 0.09 }
  ],
  "metrics": { "filteredForNonCompliance": 0, "initialCount": 15, "similarityMatrixSize": "15x15" }
}
```

## Errors

- 422 INSUFFICIENT_VALID: fewer than 3 tone-compliant candidates

## Acceptance

- All returned items have toneComplianceScore == 1.0.
- No pairwise similarity > similarityThreshold among top3.
- finalRank strictly increasing by position.
