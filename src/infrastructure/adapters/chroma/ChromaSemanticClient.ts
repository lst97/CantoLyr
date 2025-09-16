// ChromaSemanticClient (Infrastructure Adapter)
// Provides semantic vector store queries against a Chroma HTTP API.
// NOTE: Implementation is intentionally minimal & Deno-compatible (fetch based).
// Future enhancements: batching, retries with backoff, streaming partial results.

export interface ChromaSemanticMatch {
  id: string;
  text: string;
  distance: number; // smaller = more similar (depending on Chroma metric)
  metadata?: Record<string, unknown>;
}

export interface ChromaQueryOptions {
  topK?: number; // default 10
  includeMetadata?: boolean; // default true
}

export interface EmbeddingFunction {
  embed(texts: string[]): Promise<number[][]>;
}

export interface ChromaSemanticClientConfig {
  baseUrl: string; // e.g. http://localhost:8000
  collection: string; // target collection name
  embeddingFn: EmbeddingFunction; // injected embedding provider
  apiKey?: string; // optional auth header
  timeoutMs?: number; // default 8000
}

export class ChromaSemanticClient {
  private readonly baseUrl: string;
  private readonly collection: string;
  private readonly embeddingFn: EmbeddingFunction;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(cfg: ChromaSemanticClientConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    this.collection = cfg.collection;
    this.embeddingFn = cfg.embeddingFn;
    this.apiKey = cfg.apiKey;
    this.timeoutMs = cfg.timeoutMs ?? 8000;
  }

  private headers(): HeadersInit {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) h["authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  private withTimeout<T>(p: Promise<T>): Promise<T> {
    if (!this.timeoutMs) return p;
    return new Promise<T>((resolve, reject) => {
      const id = setTimeout(() => reject(new Error("CHROMA_TIMEOUT")), this.timeoutMs);
      p.then((v) => {
        clearTimeout(id);
        resolve(v);
      }, (e) => {
        clearTimeout(id);
        reject(e);
      });
    });
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.withTimeout(fetch(`${this.baseUrl}/api/v1/heartbeat`));
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  /**
   * Single semantic query for a prompt text.
   */
  async query(prompt: string, opts: ChromaQueryOptions = {}): Promise<ChromaSemanticMatch[]> {
    const vectors = await this.embeddingFn.embed([prompt]);
    const topK = opts.topK ?? 10;
    const include = ["documents"];
    if (opts.includeMetadata !== false) include.push("metadatas");

    const body = {
      collection: this.collection,
      query_embeddings: vectors,
      n_results: topK,
      include,
    };

    const res = await this.withTimeout(fetch(`${this.baseUrl}/api/v1/query`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    }));
    if (!res.ok) {
      throw new Error(`CHROMA_QUERY_FAILED ${res.status}`);
    }
    const json = await res.json();
    // Expected shape inspired by Chroma: { ids, distances, documents, metadatas }
    const out: ChromaSemanticMatch[] = [];
    const ids: string[][] = json.ids ?? [];
    const distances: number[][] = json.distances ?? [];
    const documents: string[][] = json.documents ?? [];
    const metadatas: Record<string, unknown>[][] = json.metadatas ?? [];
    if (ids.length) {
      for (let i = 0; i < ids[0].length; i++) {
        out.push({
          id: ids[0][i],
          text: documents[0]?.[i] ?? "",
          distance: distances[0]?.[i] ?? 0,
          metadata: metadatas[0]?.[i],
        });
      }
    }
    return out;
  }

  /**
   * Multi semantic queries (multi-query). Returns a merged unique set with minimum distance kept.
   */
  async multiQuery(
    prompts: string[],
    opts: ChromaQueryOptions = {},
  ): Promise<ChromaSemanticMatch[]> {
    const vectors = await this.embeddingFn.embed(prompts);
    const topK = opts.topK ?? 10;
    const include = ["documents"];
    if (opts.includeMetadata !== false) include.push("metadatas");
    const body = {
      collection: this.collection,
      query_embeddings: vectors,
      n_results: topK,
      include,
    };
    const res = await this.withTimeout(fetch(`${this.baseUrl}/api/v1/query`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    }));
    if (!res.ok) throw new Error(`CHROMA_MULTI_QUERY_FAILED ${res.status}`);
    const json = await res.json();
    const ids: string[][] = json.ids ?? [];
    const distances: number[][] = json.distances ?? [];
    const documents: string[][] = json.documents ?? [];
    const metadatas: Record<string, unknown>[][] = json.metadatas ?? [];

    const map = new Map<string, ChromaSemanticMatch>();
    for (let q = 0; q < ids.length; q++) {
      for (let i = 0; i < ids[q].length; i++) {
        const id = ids[q][i];
        const distance = distances[q]?.[i] ?? 0;
        const existing = map.get(id);
        if (!existing || distance < existing.distance) {
          map.set(id, {
            id,
            text: documents[q]?.[i] ?? "",
            distance,
            metadata: metadatas[q]?.[i],
          });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.distance - b.distance);
  }
}

export default ChromaSemanticClient;
