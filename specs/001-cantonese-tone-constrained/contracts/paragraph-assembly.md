# Contract: Paragraph Assembly Service

## Purpose

Combine per-line Top 3 sentences into exactly 3 paragraph variants maximizing global coherence and
emotional arc.

## Input

```json
{
  "lines": [
    {
      "lineIndex": 0,
      "top3": [
        {
          "id": "l0s1",
          "text": "...",
          "continuityScore": 0.75,
          "sceneAlignmentScore": 0.86
        },
        { "id": "l0s2", "text": "..." }
      ]
    },
    { "lineIndex": 1, "top3": [{ "id": "l1s1", "text": "..." }] }
  ],
  "config": { "maxParagraphs": 3, "beamWidth": 12 }
}
```

## Output

```json
{
  "paragraphs": [
    {
      "id": "p1",
      "sentences": ["...", "..."],
      "coherenceScore": 0.91,
      "emotionalArcScore": 0.88,
      "diversityScore": 0.80,
      "finalRank": 1
    },
    {
      "id": "p2",
      "sentences": ["...", "..."],
      "coherenceScore": 0.89,
      "emotionalArcScore": 0.87,
      "diversityScore": 0.82,
      "finalRank": 2
    },
    {
      "id": "p3",
      "sentences": ["...", "..."],
      "coherenceScore": 0.88,
      "emotionalArcScore": 0.85,
      "diversityScore": 0.83,
      "finalRank": 3
    }
  ],
  "metrics": { "combinationSpace": 81, "evaluated": 72, "beamPruned": 9 }
}
```

## Errors

- 422 INSUFFICIENT_LINES: zero line top3 sets provided

## Acceptance

- Exactly 3 paragraphs returned (unless fewer than 3 combinationally possible; then return all with
  warning).
- Paragraph sentences count equals number of line inputs.
- finalRank ordering matches descending final paragraph score.
