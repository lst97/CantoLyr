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


def main():
    # Load .env first, then sanitize env before importing chromadb
    load_dotenv()
    _sanitize_chroma_env()

    # Defer import until after env is sanitized to avoid pydantic errors
    import chromadb
    from chromadb.config import Settings
    ensure_hf_token()

    input_path = sys.argv[1] if len(sys.argv) > 1 else get_env("INPUT", "data/vector/chroma-all.jsonl")
    collection_name = sys.argv[2] if len(sys.argv) > 2 else get_env("CHROMA_COLLECTION", "cantolyr_lexicon_v1_768")
    chroma_url = get_env("CHROMA_URL", "http://localhost:8000")

    embed_model_id = get_env("HF_EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-0.6B")
    embed_dim_raw = get_env("EMBED_DIM", get_env("EMBEDDING_DIM", ""))
    embed_dim: int | None
    try:
        embed_dim = int(embed_dim_raw) if embed_dim_raw else None
    except Exception:
        embed_dim = None
    # Ingestion batch size (number of JSONL records processed per upsert pass)
    batch_size = int(get_env("EMBED_BATCH", "64"))

    # Optional hard cap on stored/embedded document length to keep server load reasonable
    max_doc_chars_env = get_env("MAX_DOC_CHARS", "2000")
    try:
        max_doc_chars = int(max_doc_chars_env) if max_doc_chars_env else None
    except Exception:
        max_doc_chars = 2000

    if not os.path.exists(input_path):
        print(f"❌ Input not found: {input_path}")
        sys.exit(1)

    print(f"🔗 Chroma: {chroma_url}")
    print(f"📚 Collection: {collection_name}")
    print(f"🧠 HF Embeddings: {embed_model_id} (dim={embed_dim})")

    # Device selection
    device = _choose_device()
    print(f"🖥️  Using device: {_device_pretty(device)}")

    print("⏳ Loading embedding model...")
    # Prefer SentenceTransformer; if unavailable for the repo, fall back to Transformers
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
            # Convert to nested lists
            if hasattr(vecs, "tolist"):
                return vecs.tolist()
            return [list(v) for v in vecs]

        # Quick smoke encode on small sample to ensure model supports encode
        _ = st_encode(["hello"], batch_size=1)
        embed_encode = st_encode
        print("✅ Loaded via sentence-transformers.")
    except Exception:
        print("ℹ️  Falling back to transformers-based mean-pooling embedder...")
        try:
            embed_encode = _build_transformers_embedder(embed_model_id, device)
            # Smoke test
            _ = embed_encode(["hello"], batch_size=1)
            print("✅ Loaded via transformers.")
        except Exception as e:
            print("❌ Failed to load embedding model. If gated, set HF_TOKEN and accept the license on Hugging Face.")
            raise

    # If embed_dim not provided, infer from model output size
    if embed_dim is None:
        try:
            sample_len = len(embed_encode(["hello"], batch_size=1)[0])
            embed_dim = sample_len
            print(f"ℹ️  EMBED_DIM not set; inferred {embed_dim} from model output")
        except Exception:
            embed_dim = 768
            print(f"ℹ️  EMBED_DIM not set; defaulting to {embed_dim}")

    client = chromadb.HttpClient(
        host=(os.environ.get("CHROMA_HOST") or (chroma_url.split("://",1)[1].split(":")[0])),
        port=int(os.environ.get("CHROMA_PORT") or (chroma_url.split(":")[-1] if ":" in chroma_url[8:] else ("443" if chroma_url.startswith("https:") else "8000"))),
        ssl=chroma_url.startswith("https:") or False,
        settings=Settings(anonymized_telemetry=False),
    )

    # Create collection
    print("🗂️  Preparing collection...")
    collection = client.get_or_create_collection(name=collection_name)
    print("✅ Collection ready.")

    # Stream JSONL and upsert in batches
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
            # Clean and optionally truncate the document to reduce server/indexing load
            cleaned_doc, was_trunc = _clean_document(raw_doc, max_doc_chars)
            if cleaned_doc is None or cleaned_doc == "":
                skipped_invalid += 1
                print(f"   ↳ Skipped id={oid} due to empty/invalid document type")
                continue
            if was_trunc:
                # Annotate metadata to signal truncation
                meta = {**meta, "_truncated": True}
            ids.append(oid)
            docs.append(cleaned_doc)
            metas.append(meta)
        if not ids:
            continue

        # Deduplicate within-batch to avoid double upserts of same id
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

        # Existing check to skip updates for existing ids. Request ids only to reduce payload.
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

        # Always advance progress for processed valid inputs
        processed += len(dedup_ids)
        pbar.update(len(dedup_ids))
        left = max((total_valid - processed), 0) if total_valid else 0

        if not new_idxs:
            print(f"⏭️  Skipped existing: +{skip_count} (processed {processed}, left {left})")
            continue

        new_ids = [dedup_ids[i] for i in new_idxs]
        new_docs = [dedup_docs[i] for i in new_idxs]
        new_metas = [dedup_metas[i] for i in new_idxs]

        # Prepare model-agnostic inputs
        prompts = build_prompts_for_docs(new_docs)
        # Encode using selected backend
        vecs = embed_encode(prompts, batch_size=min(32, len(prompts)))
        # Truncate + normalize to target dim (MRL)
        out_vecs = [trunc_and_norm(list(v), int(embed_dim or 768)) for v in vecs]

        # Upsert only new
        try:
            collection.upsert(ids=new_ids, documents=new_docs, metadatas=new_metas, embeddings=out_vecs)
            inserted += len(new_ids)
            print(f"⬆️  Upserted batch: +{len(new_ids)} (inserted {inserted}, processed {processed}, left {left})")
        except Exception as e:
            msg = str(e)
            print(f"⚠️  Batch upsert failed ({len(new_ids)} new): {msg}")
            # Per-record fallback
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
    print(
        f"✅ Ingestion complete. processed={processed}, inserted={inserted}, skipped_existing={skipped_existing}, skipped_invalid={skipped_invalid}, failed={failed}"
    )


if __name__ == "__main__":
    main()
