#!/usr/bin/env python3
import os
import sys
import json
from typing import Iterable, List, Dict, Tuple, Callable

from dotenv import load_dotenv
from tqdm import tqdm

# SentenceTransformers primary path; Transformers as fallback for generic HF models
from sentence_transformers import SentenceTransformer
import torch
from transformers import AutoTokenizer, AutoModel


def get_env(key: str, default: str | None = None) -> str:
    v = os.getenv(key)
    if v is None:
        return default if default is not None else ""
    return v


def ensure_hf_token():
    # SentenceTransformers reads HUGGING_FACE_HUB_TOKEN / HF_HOME
    hf = os.getenv("HF_TOKEN") or os.getenv("HUGGING_FACE_HUB_TOKEN")
    if hf and not os.getenv("HUGGING_FACE_HUB_TOKEN"):
        os.environ["HUGGING_FACE_HUB_TOKEN"] = hf


def build_prompts_for_docs(texts: List[str], title: str | None = None) -> List[str]:
    # For general-purpose embedding models (e.g., Qwen3-Embedding-0.6B),
    # raw text is typically sufficient. Keep identity to avoid model-specific prompt bias.
    return list(texts)


def build_prompt_for_query(q: str) -> str:
    # Queries can be embedded as-is for symmetric retrieval.
    return q


def trunc_and_norm(vec: List[float], dim: int) -> List[float]:
    if dim < len(vec):
        vec = vec[:dim]
    # L2 normalize
    s = sum(v * v for v in vec) or 1.0
    norm = s ** 0.5
    return [v / norm for v in vec]


def batched(it: Iterable, n: int) -> Iterable[List]:
    batch = []
    for x in it:
        batch.append(x)
        if len(batch) >= n:
            yield batch
            batch = []
    if batch:
        yield batch


def _clean_document(doc: object, max_chars: int | None = None) -> Tuple[str | None, bool]:
    """Ensure document is a string, collapse newlines/whitespace, and optionally trim.
    Returns (cleaned_doc_or_None, was_truncated).
    """
    if doc is None:
        return None, False
    if not isinstance(doc, str):
        try:
            doc = str(doc)
        except Exception:
            return None, False
    # Replace raw newlines/tabs with spaces to avoid JSONL/newline issues on storage
    s = " ".join(doc.split())
    truncated = False
    if max_chars is not None and max_chars > 0 and len(s) > max_chars:
        s = s[: max_chars]
        truncated = True
    return s, truncated


def _sanitize_chroma_env() -> None:
    """Ensure env vars expected by Chroma parse correctly before importing it.
    Newer Chroma builds validate CHROMA_SERVER_CORS_ALLOW_ORIGINS as a list.
    If a non-list value (e.g., "*" or "http://localhost:3000") is present, coerce to JSON list.
    """
    cors_key = "CHROMA_SERVER_CORS_ALLOW_ORIGINS"
    raw = os.getenv(cors_key)
    if raw is None:
        # Provide a permissive default compatible with pydantic parsing
        os.environ[cors_key] = '["*"]'
        return
    try:
        val = json.loads(raw)
        if not isinstance(val, list):
            raise ValueError("not a list")
    except Exception:
        # Coerce any non-list value into a single-item list
        os.environ[cors_key] = json.dumps([raw])

def _choose_device() -> str:
    """Pick the best available device: CUDA > MPS (Apple) > CPU.
    Allow override via EMBED_DEVICE env (e.g., 'cpu', 'cuda', 'cuda:1', 'mps').
    """
    override = os.getenv("EMBED_DEVICE") or os.getenv("DEVICE")
    if override:
        return override
    try:
        if torch.cuda.is_available():
            return "cuda"
        # Apple Silicon / Metal
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"

def _device_pretty(device: str) -> str:
    if device.startswith("cuda") and torch.cuda.is_available():
        try:
            name = torch.cuda.get_device_name(0)
        except Exception:
            name = "CUDA GPU"
        return f"CUDA ({name})"
    if device == "mps":
        return "Apple Metal (MPS)"
    return "CPU"


def _build_transformers_embedder(model_id: str, device: str) -> Callable[[List[str], int], List[List[float]]]:
    """Return a simple mean-pooling HF Transformers embedder closure.
    Falls back to CPU if device is unavailable.
    """
    tok = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
    mdl = AutoModel.from_pretrained(model_id, trust_remote_code=True)
    try:
        mdl = mdl.to(device)
    except Exception:
        pass
    mdl.eval()

    @torch.no_grad()
    def encode(texts: List[str], batch_size: int = 32) -> List[List[float]]:
        out: List[List[float]] = []
        for batch in batched(texts, max(1, batch_size)):
            inputs = tok(batch, padding=True, truncation=True, return_tensors="pt")
            try:
                inputs = {k: v.to(device) for k, v in inputs.items()}
            except Exception:
                pass
            outputs = mdl(**inputs)
            hidden = outputs.last_hidden_state  # [B, L, H]
            mask = inputs.get("attention_mask")
            if mask is None:
                # If no mask provided, average over sequence length
                pooled = hidden.mean(dim=1)
            else:
                mask = mask.unsqueeze(-1).expand(hidden.size()).float()
                summed = (hidden * mask).sum(dim=1)
                counts = mask.sum(dim=1).clamp(min=1e-9)
                pooled = summed / counts
            cpu_vecs = pooled.detach().cpu().tolist()
            out.extend(cpu_vecs)
        return out

    return encode

def _validate_metadata(meta: Dict) -> Dict:
    """Validate metadata conforms to Chroma requirements.
    Keys must be strings; values must be str, int, float, bool, or None.
    Raise ValueError if invalid.
    """
    if meta is None:
        return {}
    if not isinstance(meta, dict):
        raise ValueError("metadata must be a dict")
    out: Dict[str, object] = {}
    for k, v in meta.items():
        if not isinstance(k, str):
            raise ValueError(f"metadata key must be str, got {type(k).__name__}")
        if v is None or isinstance(v, (str, int, float, bool)):
            out[k] = v
        else:
            raise ValueError(f"metadata value for '{k}' has invalid type {type(v).__name__}")
    return out

def _count_valid_records(path: str) -> int:
    try:
        total = 0
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                if obj.get("id") and obj.get("document"):
                    try:
                        _ = _validate_metadata(obj.get("metadata", {}))
                    except Exception:
                        continue
                    total += 1
        return total
    except Exception:
        return 0


def _build_embedder() -> Tuple[Callable[[List[str], int], List[List[float]]], int, str, str]:
    """Create an embedding encoder, returning (encode, embed_dim, device, model_id)."""
    embed_model_id = get_env("HF_EMBEDDING_MODEL", get_env("EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-0.6B"))
    embed_dim_raw = get_env("EMBED_DIM", get_env("EMBEDDING_DIM", ""))
    try:
        embed_dim = int(embed_dim_raw) if embed_dim_raw else None
    except Exception:
        embed_dim = None

    device = _choose_device()
    print(f"🖥️  Using device: {_device_pretty(device)}")
    print("⏳ Loading embedding model...")

    embed_encode: Callable[[List[str], int], List[List[float]]]
    try:
        try:
            st_model = SentenceTransformer(embed_model_id, device=device)
        except TypeError:
            st_model = SentenceTransformer(embed_model_id)
            try:
                st_model = st_model.to(device)
            except Exception:
                pass

        def st_encode(texts: List[str], batch_size: int = 32) -> List[List[float]]:
            vecs = st_model.encode(texts, batch_size=min(batch_size, len(texts) or 1), normalize_embeddings=False)
            if hasattr(vecs, "tolist"):
                return vecs.tolist()
            return [list(v) for v in vecs]

        _ = st_encode(["hello"], batch_size=1)
        embed_encode = st_encode
        print("✅ Loaded via sentence-transformers.")
    except Exception:
        print("ℹ️  Falling back to transformers-based mean-pooling embedder...")
        embed_encode = _build_transformers_embedder(embed_model_id, device)
        _ = embed_encode(["hello"], batch_size=1)
        print("✅ Loaded via transformers.")

    if embed_dim is None:
        try:
            sample_len = len(embed_encode(["hello"], batch_size=1)[0])
            embed_dim = sample_len
            print(f"ℹ️  EMBED_DIM not set; inferred {embed_dim} from model output")
        except Exception:
            embed_dim = 768
            print(f"ℹ️  EMBED_DIM not set; defaulting to {embed_dim}")

    return embed_encode, int(embed_dim), device, embed_model_id


def ingest_file(client, collection_name: str, input_path: str, embed_encode: Callable[[List[str], int], List[List[float]]], embed_dim: int, batch_size: int, max_doc_chars: int | None) -> None:
    from chromadb.config import Settings  # type: ignore

    if not os.path.exists(input_path):
        print(f"❌ Input not found: {input_path}")
        return

    print(f"📚 Collection: {collection_name}")
    print(f"📄 Input: {input_path}")

    print("🗂️  Preparing collection...")
    collection = client.get_or_create_collection(name=collection_name)
    print("✅ Collection ready.")

    def parse_jsonl(path: str):
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except Exception:
                    continue

    total_valid = _count_valid_records(input_path)
    if total_valid == 0:
        print("⚠️  No valid records found (need id and document).")
        return
    else:
        print(f"🧮 Total valid records: {total_valid}")

    processed = 0
    inserted = 0
    skipped_existing = 0
    skipped_invalid = 0
    failed = 0
    pbar = tqdm(total=total_valid or 0, unit="rec", desc="Upserting", ncols=80)
    for chunk in batched(parse_jsonl(input_path), batch_size):
        ids: List[str] = []
        docs: List[str] = []
        metas: List[Dict] = []
        for obj in chunk:
            oid = obj.get("id")
            raw_doc = obj.get("document")
            if not oid or not raw_doc:
                continue
            try:
                meta = _validate_metadata(obj.get("metadata", {}))
            except Exception as ve:
                skipped_invalid += 1
                print(f"   ↳ Skipped id={oid} due to invalid metadata: {ve}")
                continue
            cleaned_doc, was_trunc = _clean_document(raw_doc, max_doc_chars)
            if cleaned_doc is None or cleaned_doc == "":
                skipped_invalid += 1
                print(f"   ↳ Skipped id={oid} due to empty/invalid document type")
                continue
            if was_trunc:
                meta = {**meta, "_truncated": True}
            ids.append(oid)
            docs.append(cleaned_doc)
            metas.append(meta)
        if not ids:
            continue

        first_index_for_id: Dict[str, int] = {}
        dedup_ids: List[str] = []
        dedup_docs: List[str] = []
        dedup_metas: List[Dict] = []
        for i, _id in enumerate(ids):
            if _id in first_index_for_id:
                continue
            first_index_for_id[_id] = i
            dedup_ids.append(_id)
            dedup_docs.append(docs[i])
            dedup_metas.append(metas[i])

        existing_ids: set[str] = set()
        try:
            got = collection.get(ids=dedup_ids, include=["ids"])  # type: ignore[arg-type]
            if isinstance(got, dict):
                existing_ids = set(got.get("ids", []) or [])
            else:
                existing_ids = set(getattr(got, "ids", []) or [])
        except Exception:
            existing_ids = set()

        new_idxs = [i for i, _id in enumerate(dedup_ids) if _id not in existing_ids]
        skip_count = len(dedup_ids) - len(new_idxs)
        skipped_existing += skip_count

        processed += len(dedup_ids)
        pbar.update(len(dedup_ids))
        left = max((total_valid - processed), 0) if total_valid else 0

        if not new_idxs:
            print(f"⏭️  Skipped existing: +{skip_count} (processed {processed}, left {left})")
            continue

        new_ids = [dedup_ids[i] for i in new_idxs]
        new_docs = [dedup_docs[i] for i in new_idxs]
        new_metas = [dedup_metas[i] for i in new_idxs]

        prompts = build_prompts_for_docs(new_docs)
        vecs = embed_encode(prompts, batch_size=min(32, len(prompts)))
        out_vecs = [trunc_and_norm(list(v), int(embed_dim or 768)) for v in vecs]

        try:
            collection.upsert(ids=new_ids, documents=new_docs, metadatas=new_metas, embeddings=out_vecs)
            inserted += len(new_ids)
            print(f"⬆️  Upserted batch: +{len(new_ids)} (inserted {inserted}, processed {processed}, left {left})")
        except Exception as e:
            msg = str(e)
            print(f"⚠️  Batch upsert failed ({len(new_ids)} new): {msg}")
            successes = 0
            for i in range(len(new_ids)):
                try:
                    collection.upsert(ids=[new_ids[i]], documents=[new_docs[i]], metadatas=[new_metas[i]], embeddings=[out_vecs[i]])
                    successes += 1
                except Exception as ie:
                    failed += 1
                    print(f"   ↳ Skipped id={new_ids[i]} due to error: {ie}")
            inserted += successes
            print(f"   ↳ Fallback inserted: +{successes} (inserted {inserted}, processed {processed}, left {left})")

    pbar.close()
    print(f"✅ Ingestion complete. processed={processed}, inserted={inserted}, skipped_existing={skipped_existing}, skipped_invalid={skipped_invalid}, failed={failed}")


def main():
    # Load .env and sanitize for Chroma
    load_dotenv()
    _sanitize_chroma_env()
    ensure_hf_token()

    # Defer import until after env is sanitized
    import chromadb
    from chromadb.config import Settings

    chroma_url = get_env("CHROMA_URL", "http://localhost:8000")
    client = chromadb.HttpClient(
        host=(os.environ.get("CHROMA_HOST") or (chroma_url.split("://", 1)[1].split(":")[0])),
        port=int(os.environ.get("CHROMA_PORT") or (chroma_url.split(":")[-1] if ":" in chroma_url[8:] else ("443" if chroma_url.startswith("https:") else "8000"))),
        ssl=chroma_url.startswith("https:") or False,
        settings=Settings(anonymized_telemetry=False),
    )

    # Shared ingest parameters
    batch_size = int(get_env("EMBED_BATCH", get_env("CHROMA_UPSERT_BATCH", "64")))
    max_doc_chars_env = get_env("MAX_DOC_CHARS", "2000")
    try:
        max_doc_chars = int(max_doc_chars_env) if max_doc_chars_env else None
    except Exception:
        max_doc_chars = 2000

    # Build embedder once for all modes
    embed_encode, embed_dim, device, model_id = _build_embedder()
    print(f"🔗 Chroma: {chroma_url}")
    print(f"🧠 HF Embeddings: {model_id} (dim={embed_dim})")

    # CLI: modes
    args = sys.argv[1:]
    mode = ""
    if args:
        mode = args[0].lower()

    def do_lexicon(input_override: str | None = None, coll_override: str | None = None):
        input_path = input_override or get_env("LEXICON_INPUT", "data/vector/chroma-lexicon.jsonl")
        collection_name = coll_override or get_env("CHROMA_COLLECTION_LEXICON", get_env("CHROMA_COLLECTION", "cantolyr_lexicon_v1_1024"))
        ingest_file(client, collection_name, input_path, embed_encode, embed_dim, batch_size, max_doc_chars)

    def do_lyrics(input_override: str | None = None, coll_override: str | None = None):
        input_path = input_override or get_env("LYRICS_INPUT", "data/vector/chroma-lyrics.jsonl")
        collection_name = coll_override or get_env("CHROMA_COLLECTION_LYRICS", "cantolyr_lyrics_v1_1024")
        ingest_file(client, collection_name, input_path, embed_encode, embed_dim, batch_size, max_doc_chars)

    # Back-compat: if first arg looks like a file, treat as single-shot [input, collection]
    if mode and mode.endswith(".jsonl"):
        input_path = args[0]
        collection_name = args[1] if len(args) > 1 else get_env("CHROMA_COLLECTION", "cantolyr_lexicon_v1_1024")
        print("ℹ️  Single-shot ingestion")
        ingest_file(client, collection_name, input_path, embed_encode, embed_dim, batch_size, max_doc_chars)
        return

    if mode in ("lexicon", "lex", "vocab", "char"):
        input_override = args[1] if len(args) > 1 and args[1].endswith(".jsonl") else None
        coll_override = args[2] if len(args) > 2 else None
        do_lexicon(input_override, coll_override)
        return
    if mode in ("lyrics", "lyr"):
        input_override = args[1] if len(args) > 1 and args[1].endswith(".jsonl") else None
        coll_override = args[2] if len(args) > 2 else None
        do_lyrics(input_override, coll_override)
        return

    # Default: all
    print("ℹ️  Mode not specified or 'all'; ingesting both lexicon and lyrics.")
    do_lexicon()
    do_lyrics()


if __name__ == "__main__":
    main()
