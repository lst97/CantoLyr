// EmbeddingProvider (Infrastructure Adapter)
// Deterministic pseudo-embedding implementation (placeholder) so higher layers can proceed.
// Replace with actual model integration (e.g., Transformers.js) later.

export interface EmbeddingProviderConfig {
  dimension?: number; // output vector size (default 384)
  lowercase?: boolean; // normalize case
}

export class EmbeddingProvider {
  private readonly dim: number;
  private readonly lowercase: boolean;

  constructor(cfg: EmbeddingProviderConfig = {}) {
    this.dim = cfg.dimension ?? 384;
    this.lowercase = cfg.lowercase ?? true;
  }

  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((t) => this.embedOne(t)));
  }

  private embedOne(text: string): number[] {
    const out = new Array<number>(this.dim).fill(0);
    const norm = this.lowercase ? text.toLowerCase() : text;
    // Simple character hashing distribution
    for (let i = 0; i < norm.length; i++) {
      const code = norm.charCodeAt(i);
      const idx = code % this.dim;
      out[idx] += (code % 13) / 13; // bounded contribution
    }
    // L2 normalize
    let sumSq = 0;
    for (const v of out) sumSq += v * v;
    const normFactor = sumSq ? 1 / Math.sqrt(sumSq) : 1;
    for (let i = 0; i < out.length; i++) out[i] *= normFactor;
    return out;
  }
}

export default EmbeddingProvider;
