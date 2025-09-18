# Contract: Candidate Retrieval Service

## Purpose

Generate semantic + frequency-enriched lexical candidate pool for one line (no fallback expansions).

## Input

```json
{
  "lineIndex": 0,
  "toneSequence": "2253394259",
  "digitSet": ["22", "5", "33", "9", "4", "25", "3", "39", "42", "59", "2"],
  "sceneIntent": {
    "title": "meet a friend",
    "emotions": ["warmth", "anticipation", "joy"],
    "microIntent": "Capture the excitement of meeting someone new.",
    "continuityNotes": "Opening line"
  },
  "config": {
    "semanticTarget": 200,
    "freqTop": 100,
    "freqRandom": 50,
    "minSemanticThreshold": 150
  }
}
```

## Output

```json
{
  "lineIndex": 0,
  "semanticCount": 192,
  "freqTopCount": 100,
  "freqRandomCount": 50,
  "total": 270,
  "perDigit": {
    "22": { "semantic": 18, "freqTop": 8, "freqRandom": 3, "total": 29 },
    "5": { "semantic": 15, "freqTop": 9, "freqRandom": 5, "total": 29 }
    // ... others
  },
  "candidates": [
    {
      "surface": "朋友",
      "toneDigit": "22",
      "provenance": "semantic",
      "sceneRelevanceScore": 0.83
    },
    {
      "surface": "笑",
      "toneDigit": "5",
      "provenance": "freq-top",
      "frequencyRank": 42
    },
    {
      "surface": "偶遇",
      "toneDigit": "33",
      "provenance": "semantic",
      "sceneRelevanceScore": 0.79
    }
  ],
  "warnings": ["WARN_LOW_SEMANTIC"]
}
```

## Errors

- 422 ERROR_DIGIT_INSUFFICIENT: any digit < 3 total candidates after enrichment (no candidates list
  returned)

## Acceptance

- semanticCount >= 0; if < minSemanticThreshold include WARN_LOW_SEMANTIC.
- No duplicate surface entries.
- Each candidate.toneDigit ∈ digitSet.
- No provenance outside semantic|freq-top|freq-random.
