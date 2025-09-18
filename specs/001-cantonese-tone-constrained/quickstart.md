# Quickstart: Cantonese Tone-Constrained Lyric Generation (Spec v2)

## Goal

Run full pipeline: prompt + tone sequences → segmentation (3 patterns) → retrieval (semantic +
frequency) → 15 generated sentences → Top 3 per line → 3 paragraph variants.

## Inputs Example

Prompt: "兩個人剛在活動上結識，氣氛輕鬆歡樂，臨別前彼此依依不捨，希望快點再見。"

Tone Sequences:

1. 2253394259
2. 334334
3. 02300394239
4. 22533244940223

## Output (Conceptual Structure)

```json
{
  "sceneIntents": [
    {
      "lineIndex": 0,
      "title": "遇見",
      "emotions": ["喜悅", "好奇", "暖"],
      "microIntent": "初次相逢的微妙期待"
    }
  ],
  "lines": [
    {
      "index": 0,
      "digitSet": ["22", "5", "33", "9", "4", "25", "3", "39", "42", "59", "2"],
      "candidatePoolStats": {
        "semanticCount": 192,
        "freqTopCount": 100,
        "freqRandomCount": 50
      },
      "top3": [
        { "text": "...", "patternId": "baseline" },
        { "text": "..." },
        { "text": "..." }
      ],
      "warnings": ["WARN_LOW_SEMANTIC"]
    }
  ],
  "paragraphVariants": [
    { "id": "p1", "sentences": ["...", "...", "...", "..."], "finalRank": 1 }
  ],
  "config": { "semanticTarget": 200, "freqTop": 100, "freqRandom": 50 }
}
```

## CLI (Planned Prototype)

```bash
pnpm run lyrics:generate \
  --prompt "兩個人剛在活動上結識..." \
  --tones 2253394259 334334 02300394239 22533244940223 \
  --seed 42 \
  --output out/session.json

# Regenerate only line 2 (0-based index 1)
pnpm run lyrics:generate --resume out/session.json --regenerate-line 1 --seed 77 --output out/session_v2.json
```

## Configuration Parameters

| Key                  | Default | Notes                       |
| -------------------- | ------- | --------------------------- |
| semanticTarget       | 200     | Target semantic candidates  |
| freqTop              | 100     | High-frequency enrichment   |
| freqRandom           | 50      | Random mid-frequency sample |
| topKSize             | 10      | Pre-rerank shortlist size   |
| mmrLambda            | 0.7     | MMR relevance weight        |
| minSemanticThreshold | 150     | WARN if below               |

## Programmatic Flow (Pseudo-code)

```ts
const session = startSession({ prompt, toneSequences, config });
for (const ts of session.toneSequences) {
  const seg = segmentationService.segment(ts.raw); // 3 patterns
  const intent = sceneService.inferIntent({ prompt, index: ts.index });
  const pool = await retrievalService.buildPool({
    lineIndex: ts.index,
    toneSequence: ts.raw,
    digitSet: seg.digitSet,
    patterns: seg.patterns,
    sceneIntent: intent,
    config: retrievalConfig,
  });
  if (pool.error) continue; // mark line incomplete
  const patternsWithSlots = seg.patterns.map((p) => ({
    ...p,
    slots: pool.patternSlots[p.id] ?? p.slots ?? [],
  }));
  const gen = generationService.generate({
    lineIndex: ts.index,
    patterns: patternsWithSlots,
    candidatePool: pool.candidates,
    sceneIntent: intent,
    continuityContext: { previousLines: session.accepted },
    config: generationConfig,
  });
  const ranked = rankingService.selectTop3({
    lineIndex: ts.index,
    candidates: gen.sentences,
  });
  updateLine(session, ranked);
}
const paragraphs = paragraphService.assemble({ lines: session.lines });
```

## Validation Checklist

- 3 patterns per tone sequence.
- Each line: semanticCount >= 150 OR WARN_LOW_SEMANTIC present.
- No generation attempted if any digit <3 candidates (ERROR_DIGIT_INSUFFICIENT).
- All Top 3 sentences have toneComplianceScore == 1.0.
- Exactly 3 paragraphVariants unless insufficient combinations.

## Troubleshooting

| Symptom                       | Likely Cause            | Resolution                                      |
| ----------------------------- | ----------------------- | ----------------------------------------------- |
| WARN_LOW_SEMANTIC             | Prompt too sparse       | Add richer context/emotions                     |
| ERROR_DIGIT_INSUFFICIENT      | Rare tone digits        | Adjust sequence or grow lexicon                 |
| Low diversity Top 3           | High similarity pre-MMR | Increase topKSize or lower similarity threshold |
| Repetitive paragraph variants | Beam too narrow         | Increase beamWidth (paragraph assembly config)  |

## Regeneration Semantics

Regenerating a line preserves: prior accepted lines, scene intents (unless explicitly refreshed),
and seed can change randomness for frequency random slice + generation sampling.

## Safety Reminder

Content filter categories TBD; manual review recommended pre-publication.

---

Quickstart updated for spec v2.
