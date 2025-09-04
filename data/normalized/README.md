# Normalized Data Exports

This folder contains JSONL exports produced by the normalization scripts. Each line is a JSON object representing an entry (character or vocabulary word) with standardized fields and enriched metadata.

## Files

- `data/normalized/chars.jsonl`: Single‑character entries normalized from `charlist.json` plus enrichments.
- `data/normalized/vocab.jsonl`: Multi‑character vocabulary entries normalized from `wordslist.json` plus enrichments.

## Entry Schema

Top‑level fields (per line):

- `surface`: The character or vocab string.
- `type`: `"char"` for single characters, `"vocab"` for multi‑character words.
- `lang`: Language variety code.
  - `zh-HK`: Colloquial Cantonese (spoken‑style usage).
  - `zh-TW`: Written Chinese usage (Traditional written standard).
  - `en`, `misc`: Other/uncategorized.
- `readings`: Array of pronunciations/readings with:
  - `jyutping`: Canonicalized Jyutping.
  - `toneOriginal`: Original tone string extracted from the Jyutping.
  - `toneMapped`: Mapped tone string via tone normalization.
  - `syllables`: Number of syllables in the reading.
  - `freq`: Frequency per million (ppm). See Frequency Sources below.
  - `pos`: Part‑of‑speech label (uppercased when sourced from sentiment dictionary).
  - `register`: Register or sentiment category (always uppercased). May be sentiment labels such as `POSITIVE`, `PRAISE`, etc., or defaults like `NEUTRAL`.
  - `gloss`: Short gloss/definition if available.
  - `source`: Provenance/version tag of the source dataset.

## Frequency Sources

- Characters (`chars.jsonl`):
  - Base frequencies come from `charlist.json`.
  - Optional overrides from `char_freq.json` (prefers per‑million fields like `frequency`; falls back to `token` when present).
- Vocabulary (`vocab.jsonl`):
  - Base default is `1` to indicate presence.
  - If `book_word_freq.js` is provided (raw counts), counts are normalized to per‑million via: `count / total_counts * 1_000_000`.
  - Words missing from the book list receive a small baseline (less than the smallest listed positive value) to ensure listed words rank higher.
  - For `lang = zh-HK`, vocab frequencies remain at the default `1` (book frequency overrides are skipped).

All frequencies are expressed as per‑million (ppm).

## Sentiment and POS Enrichment

Normalization applies two ordered passes when dictionaries are present:

1) Coarse sentiment dictionary `sentiment_dictionary.json`
   - For any term present under a key (e.g., `positive`), sets `register` to the key uppercased (e.g., `POSITIVE`).
2) Detailed sentiment dictionary `大連理工情感詞彙本體/sentiments.json`
   - Replaces `register` with `情感分類` (uppercased), if available.
   - Replaces `pos` with `詞性種類` (uppercased), if available.

If a term is missing from a dictionary, its fields remain unchanged. Default register values are `NEUTRAL`.

## Notes

- Not all entries have complete metadata (gloss, register, POS). Coverage will improve over time as source dictionaries expand.
- The JSONL format enables easy streaming/ingestion; parse line‑by‑line to handle large files efficiently.
