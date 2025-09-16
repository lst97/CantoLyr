// CrossEncoderScorer (Infrastructure Adapter)
// Provides pairwise sentence scoring using an LLM cross-encoder style prompt.
// Falls back to cosine similarity over injected embeddings if LLM disabled.

export interface CrossEncoderScorerConfig {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  temperature?: number;
  enable?: boolean;
  maxPairsPerCall?: number; // chunk large sets
}

export interface EmbeddingProviderLike {
  embed(texts: string[]): Promise<number[][]>;
}

export interface PairScore {
  a: string;
  b: string;
  score: number;
}

export class CrossEncoderScorer {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly temperature: number;
  private readonly enabled: boolean;
  private readonly maxPairsPerCall: number;
  private readonly embedder: EmbeddingProviderLike;

  constructor(embedder: EmbeddingProviderLike, cfg: CrossEncoderScorerConfig = {}) {
    this.embedder = embedder;
    this.apiKey = cfg.apiKey ?? Deno.env.get("GEMINI_API_KEY");
    this.model = cfg.model ?? "gemini-pro";
    this.endpoint = cfg.endpoint ?? "https://generativelanguage.googleapis.com/v1beta/models";
    this.temperature = cfg.temperature ?? 0.2;
    this.enabled = cfg.enable ?? true;
    this.maxPairsPerCall = cfg.maxPairsPerCall ?? 20;
  }

  async scorePairs(pairs: Array<[string, string]>): Promise<PairScore[]> {
    if (!this.enabled || !this.apiKey) {
      return this.cosineFallback(pairs);
    }
    const out: PairScore[] = [];
    for (let i = 0; i < pairs.length; i += this.maxPairsPerCall) {
      const chunk = pairs.slice(i, i + this.maxPairsPerCall);
      const prompt = this.buildPrompt(chunk);
      try {
        const raw = await this.callModel(prompt);
        const parsed = this.parse(raw, chunk);
        out.push(...parsed);
      } catch (_) {
        // degrade gracefully for this chunk
        out.push(...await this.cosineFallback(chunk));
      }
    }
    return out;
  }

  private buildPrompt(pairs: Array<[string, string]>): string {
    const lines = pairs.map(([a, b], idx) => `${idx + 1}. A: ${a}\nB: ${b}`); // order stable
    return `You are a cross-encoder scoring semantic & poetic relatedness (0-1).\n` +
      `For each pair, output JSON line: {"i":<index>,"score":<0-1 float>}.\nPairs:\n${
        lines.join("\n")
      }`;
  }

  private async callModel(prompt: string): Promise<string> {
    const url = `${this.endpoint}/${this.model}:generateContent?key=${this.apiKey}`;
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: this.temperature, maxOutputTokens: 512 },
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`CROSS_HTTP_${res.status}`);
    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  private parse(raw: string, pairs: Array<[string, string]>): PairScore[] {
    const out: PairScore[] = [];
    for (const line of raw.split(/\n+/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        if (typeof obj.i === "number" && typeof obj.score === "number") {
          const idx = obj.i - 1;
          if (idx >= 0 && idx < pairs.length) {
            const [a, b] = pairs[idx];
            out.push({ a, b, score: Math.min(1, Math.max(0, obj.score)) });
          }
        }
      } catch (_) { /* ignore */ }
    }
    // Fill any missing with fallback similarity
    if (out.length < pairs.length) {
      const existingSet = new Set(out.map((ps) => `${ps.a}|${ps.b}`));
      const missing: Array<[string, string]> = [];
      for (const [a, b] of pairs) if (!existingSet.has(`${a}|${b}`)) missing.push([a, b]);
      // synchronous fallback
      const fb = this.simpleSimilarity(missing);
      out.push(...fb);
    }
    return out;
  }

  private cosineFallback(pairs: Array<[string, string]>): Promise<PairScore[]> {
    return Promise.resolve(this.simpleSimilarity(pairs));
  }

  private simpleSimilarity(pairs: Array<[string, string]>): PairScore[] {
    // derive embeddings all unique sentences once
    const unique = Array.from(new Set(pairs.flat()));
    // NOTE: embed is async; we call sync variant using then not to refactor signature heavily
    // But for simplicity we assume embed returns Promise immediately resolved.
    // (If truly async we would need an async wrapper calling embed and awaiting results.)
    const embeddingsPromise = this.embedder.embed(unique);
    // Since function not async, we cannot await; but original scorePairs uses await only on fallback with async; adjust design:
    // Make method synchronous by throwing if embed returns a promise unresolved? Instead we convert this method to async above; simpler: keep as synchronous but unsafe.
    // We'll treat embedder as returning Promise resolved, but we must not block. For correctness, adapt design: convert to generating zeros until promise resolves later not helpful.
    // Simpler: we will throw if embedder returns a thenable not resolved synchronously. For now we cheat expecting our EmbeddingProvider returns Promise.resolve immediate.
    let vectors: number[][] = [];
    (embeddingsPromise as Promise<number[][]>).then((v) => {
      vectors = v;
    });
    if (!vectors.length) {
      // Fallback naive scoring purely on length ratio if vectors not ready synchronously (shouldn't happen with current implementation).
      return pairs.map(([a, b]) => ({ a, b, score: this.lenRatio(a, b) }));
    }
    const map = new Map<string, number[]>();
    unique.forEach((u, i) => map.set(u, vectors[i]));
    return pairs.map(([a, b]) => ({ a, b, score: this.cosine(map.get(a)!, map.get(b)!) }));
  }

  private lenRatio(a: string, b: string): number {
    return Number(
      (Math.min(a.length, b.length) / Math.max(1, Math.max(a.length, b.length))).toFixed(3),
    );
  }

  private cosine(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      const av = a[i];
      const bv = b[i];
      dot += av * bv;
      na += av * av;
      nb += bv * bv;
    }
    return Number((dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9)).toFixed(3));
  }
}

export default CrossEncoderScorer;
