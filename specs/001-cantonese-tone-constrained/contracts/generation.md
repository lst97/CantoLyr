# Contract: Constrained Generation Service

## Purpose

Produce 15 tone-constrained sentence candidates (3 patterns × 5 variants) using only provided
lexical candidates.

## Input

```json
{
  "lineIndex": 0,
  "patterns": [
    { "id": "baseline", "groups": ["22", "5", "33", "9", "4", "25", "9"] },
    { "id": "shifted", "groups": ["22", "5", "3", "39", "42", "59"] },
    { "id": "maxPair", "groups": ["2", "25", "33", "9", "42", "59"] }
  ],
  "candidatePool": [
    { "surface": "朋友", "toneDigit": "22" },
    { "surface": "笑", "toneDigit": "5" }
  ],
  "sceneIntent": {
    "title": "meet a friend",
    "emotions": ["warmth", "anticipation", "joy"],
    "microIntent": "Capture the excitement of meeting someone new."
  },
  "continuityContext": { "previousLines": [] },
  "config": { "variantsPerPattern": 5, "maxRetriesPerSentence": 2 }
}
```

## Output

```json
{
  "lineIndex":0,
  "attempted":15,
  "generated":15,
  "sentences":[
    {"patternId":"baseline","text":"...","usedSurfaces":["朋友","笑",...],"toneComplianceScore":1.0,"sceneAlignmentScore":0.86,"continuityScore":0.75},
    {"patternId":"shifted","text":"...","usedSurfaces":[...],"toneComplianceScore":1.0,"sceneAlignmentScore":0.81,"continuityScore":0.72}
  ],
  "invalidFiltered":0,
  "metrics":{"avgSceneAlignment":0.83}
}
```

## Errors

- 409 INCOMPLETE_LINE (digit coverage insufficient – precondition failed)

## Acceptance

- Exactly variantsPerPattern * patternCount sentences attempted unless early stop triggered.
- All toneComplianceScore == 1.0.
- usedSurfaces length matches pattern.groups length.
