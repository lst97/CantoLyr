// SiliconFlowEmbeddingProvider (Infrastructure Adapter)
// Cloud embedding via SiliconFlow API (OpenAI-compatible schema)
// Model: Qwen/Qwen3-Embedding-0.6B (default)

export interface SiliconFlowConfig {
  apiKey: string;
  model?: string; // default: Qwen/Qwen3-Embedding-0.6B
  baseUrl?: string; // default: https://api.siliconflow.cn
  timeoutMs?: number; // default: 15000
}

export class SiliconFlowEmbeddingProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(cfg: SiliconFlowConfig) {
    if (!cfg?.apiKey) throw new Error("SILICONFLOW_API_KEY is required");
    this.apiKey = cfg.apiKey;
    this.model = cfg.model || "Qwen/Qwen3-Embedding-0.6B";
    this.baseUrl = (cfg.baseUrl || "https://api.siliconflow.cn").replace(/\/$/, "");
    this.timeoutMs = cfg.timeoutMs ?? 15000;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const input = texts.map((t) => (typeof t === "string" ? t : String(t)));
    if (input.length === 0) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          input,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`SiliconFlow embeddings failed: ${res.status} ${res.statusText} ${errText}`);
      }
      const json: any = await res.json();
      // OpenAI-compatible: { data: [ { embedding: number[] }, ... ] }
      const data: any[] = Array.isArray(json?.data) ? json.data : [];
      if (!data.length) return [];
      return data.map((d: any) => {
        const emb: number[] = Array.isArray(d?.embedding) ? d.embedding : [];
        return emb.map((x) => Number(x));
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

export default SiliconFlowEmbeddingProvider;
