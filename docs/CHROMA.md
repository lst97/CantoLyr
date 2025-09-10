# Chroma Vector DB Setup

## Overview

- Runs Chroma server via Docker.
- Ingests JSONL documents with a Chinese‑friendly embedding model.
- Uses local Hugging Face embeddings via Transformers.js by default
  (`onnx-community/embeddinggemma-300m-ONNX`).

## Prereqs

- Docker + Docker Compose
- `pnpm install` (to install `chromadb` client)

## Env

- Copy `.env.example` to `.env` and set:
  - `CHROMA_URL=http://localhost:8000`
  - `HF_TOKEN=...` (optional; only needed for gated models)
  - `HF_EMBEDDING_MODEL=onnx-community/embeddinggemma-300m-ONNX`
  - Optional performance tuning: `EMBED_BATCH=128`, `EMBED_CONCURRENCY=4`, `EMBED_DTYPE=fp32`

## Start Chroma

- `pnpm run vector:up`
- Health check endpoint: `http://localhost:8000/api/v1/heartbeat`

## Prepare Data

1. Generate normalized vector docs:

- `pnpm run normalize:chroma`
  - Outputs:
    - `data/vector/chroma-chars.jsonl`
    - `data/vector/chroma-vocab.jsonl`
    - `data/vector/chroma-all.jsonl`

## Ingest

- `pnpm run vector:ingest`
  - Uses `data/vector/chroma-all.jsonl` by default.
  - Collection name: `cantolyr_lexicon_v1_1024` (768‑dim embeddings).
  - Batches upserts and computes embeddings client‑side.

## Customize

- Alternate input: `tsx scripts/ingest-chroma.ts path/to.jsonl my_collection`.
- You can change the HF `HF_EMBEDDING_MODEL` if needed.

## Teardown

- `pnpm run vector:down`

## Notes

- One Chroma document per reading; IDs follow `type|surface|jyutping|tone{n}`.
- Document text includes: `字：` or `詞：` with 粵音 (jyutping) / 韻母 (rhymes) / 發音
  (pronunciation) / 調 (tone) / 詞性 / 情感 / 意.
- Example:
  `詞：9up（粵音：gau1 ap1, 韻母:au ap, 發音:33, 調：11）(詞性：VERB), (情感: NEUTRAL)。意：([9up])`
- Metadata fields include: `surface`, `type`, `lang`, `jyutping`, `pronunciation`, `tone`,
  `consonantsStr`, `rhymesStr`, `syllables`, `freq`, `pos`, `register`, `gloss`, `source`, plus
  per‑syllable keys like `consonant1`, `rhyme1`, `consonant2`, `rhyme2`, … (no arrays; Chroma
  requires primitives).
- For filtering, prefer `tone` (string). Back‑compat alias `toneMapped` is mapped to `tone` by the
  query helper.
- `tone` and `pronunciation` are treated as strings (not numbers) to preserve leading zeros; e.g.,
  use `--tone="02"` if your data uses two digits.
- To filter by rhymes/consonants you can:
  - Use document contains: `--whereDocContains="韻母:au"`, and/or
  - Filter metadata fields:
    - Exact per‑syllable match: `--where='{"consonant1": {"$eq": "j"}}'`
    - String form (space‑delimited): `--where_document='{"$contains": "韻母:au"}'` or prefilter
      locally by `rhymesStr`.
- Persisted under Docker volume `chroma_data`.
