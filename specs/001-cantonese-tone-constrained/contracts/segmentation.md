# Contract: Segmentation Service

## Purpose

Produce exactly three deterministic segmentation patterns for each ToneSequence using only 1–2 digit
groups.

## Input

```json
{
  "toneSequence": "2253394259"
}
```

## Output

```json
{
  "raw": "2253394259",
  "patterns": [
    {
      "id": "baseline",
      "groups": ["22", "5", "33", "9", "4", "25", "9"],
      "patternString": "22 5 33 9 4 25 9"
    },
    {
      "id": "shifted",
      "groups": ["22", "5", "3", "39", "42", "59"],
      "patternString": "22 5 3 39 42 59"
    },
    {
      "id": "maxPair",
      "groups": ["2", "25", "33", "9", "42", "59"],
      "patternString": "2 25 33 9 42 59"
    }
  ],
  "digitSet": ["22", "5", "33", "9", "4", "25", "3", "39", "42", "59", "2"],
  "warnings": []
}
```

## Errors

- 400 INVALID_DIGIT: contains disallowed digit token
- 400 TOO_LONG: length > 20

## Acceptance

- Always returns 3 patterns if valid input.
- No group length > 2.
- Union of groups across patterns equals digitSet (order not guaranteed).
