Chroma Vector DB Setup
=======================

Overview
--------

- Runs Chroma server via Docker.
- Ingests JSONL documents with a Chinese‑friendly embedding model.
- Uses Google `gemini-embedding-001` by default.

Prereqs
-------

- Docker + Docker Compose
- `pnpm install` (to install `chromadb` client)

Env
---

- Copy `.env.example` to `.env` and set:
  - `CHROMA_URL=http://localhost:8000`
  - `GOOGLE_API_KEY=...`
  - `EMBEDDING_MODEL=gemini-embedding-001`

Start Chroma
------------

- `pnpm run vector:up`
- Health check endpoint: `http://localhost:8000/api/v1/heartbeat`

Prepare Data
------------

1) Generate normalized vector docs:

- `pnpm run normalize:chroma`
  - Outputs:
    - `data/vector/chroma-chars.jsonl`
    - `data/vector/chroma-vocab.jsonl`
    - `data/vector/chroma-all.jsonl`

Ingest
------

- `pnpm run vector:ingest`
  - Uses `data/vector/chroma-all.jsonl` by default.
  - Collection name: `cantolyr_lexicon_v1`.
  - Batches upserts and computes embeddings client‑side.

Customize
---------

- Alternate input: `tsx scripts/ingest-chroma.ts path/to.jsonl my_collection`.
- You can change the Google `EMBEDDING_MODEL` if needed.

Teardown
--------

- `pnpm run vector:down`

Notes
-----

- One Chroma document per reading; IDs follow `type|surface|jyutping|tone{n}`.
- Document text includes：`字：` or `詞：` with 粵音/韻/詞性/情感/意 as requested.
- Persisted under Docker volume `chroma_data`.
