// ConstrainedGenerationLLM (Infrastructure Adapter)
// Generates Cantonese lyric lines that must follow a tone digit sequence and output JSON lines for each variant.
// Provides retry & basic validation. Fallback deterministic mode if LLM disabled.

export interface ConstrainedGenerationRequest {
  toneSequence: string; // e.g. "123456"
  sceneTitle: string;
  emotions: string[];
  variants: number; // number of candidate lines requested
  seed?: number;
}

export interface ConstrainedGenerationVariant {
  text: string;
  toneSequence: string;
  compliance: number; // 0..1 heuristic tone compliance score
}

export interface ConstrainedGenerationResponse {
  variants: ConstrainedGenerationVariant[];
  raw?: string;
  warnings?: string[];
  error?: string;
}

export interface ConstrainedGenerationLLMConfig {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  temperature?: number;
  maxOutputTokens?: number;
  enable?: boolean;
  maxRetries?: number;
}

export class ConstrainedGenerationLLM {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly temperature: number;
  private readonly maxOutputTokens: number;
  private readonly enabled: boolean;
  private readonly maxRetries: number;

  constructor(cfg: ConstrainedGenerationLLMConfig = {}) {
    this.apiKey = cfg.apiKey ?? Deno.env.get("GEMINI_API_KEY");
    this.model = cfg.model ?? "gemini-pro";
    this.endpoint = cfg.endpoint ?? "https://generativelanguage.googleapis.com/v1beta/models";
    this.temperature = cfg.temperature ?? 0.7;
    this.maxOutputTokens = cfg.maxOutputTokens ?? 512;
    this.enabled = cfg.enable ?? true;
    this.maxRetries = cfg.maxRetries ?? 2;
  }

  async generate(req: ConstrainedGenerationRequest): Promise<ConstrainedGenerationResponse> {
    if (!this.enabled || !this.apiKey) {
      return this.fallback(req);
    }
    const basePrompt = this.buildPrompt(req);
    let lastError: string | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const raw = await this.callModel(basePrompt);
        const parsed = this.parseOutput(raw, req.toneSequence);
        if (parsed.variants.length >= req.variants) {
          return { ...parsed, raw };
        }
        lastError = "INSUFFICIENT_VARIANTS";
      } catch (e) {
        lastError = (e as Error).message;
      }
    }
    return { ...(await this.fallback(req)), error: lastError };
  }

  private buildPrompt(req: ConstrainedGenerationRequest): string {
    return `You generate Cantonese lyric line candidates following a tone digit pattern.\n` +
      `Return EXACTLY ${req.variants} lines as JSON Lines; each line: {"text":"<cantonese>","toneSequence":"${req.toneSequence}"}.\n` +
      `Constraints:\n- Strict tone digit length match\n- Keep punctuation minimal\n- Evoke emotions: ${
        req.emotions.join(", ")
      }\nScene: ${req.sceneTitle}\n`;
  }

  private async callModel(prompt: string): Promise<string> {
    const url = `${this.endpoint}/${this.model}:generateContent?key=${this.apiKey}`;
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: this.temperature, maxOutputTokens: this.maxOutputTokens },
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GEN_LLM_HTTP_${res.status}`);
    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  private parseOutput(raw: string, toneSequence: string): ConstrainedGenerationResponse {
    const variants: ConstrainedGenerationVariant[] = [];
    for (const line of raw.split(/\n+/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        if (obj.text && obj.toneSequence === toneSequence) {
          variants.push({
            text: obj.text,
            toneSequence,
            compliance: this.estimateCompliance(obj.text, toneSequence),
          });
        }
      } catch (_) { /* ignore non-JSON lines */ }
    }
    return { variants };
  }

  private estimateCompliance(text: string, toneSequence: string): number {
    // rudimentary heuristic: match length after stripping punctuation.
    const stripped = text.replace(/[\p{P}\p{S}]/gu, "");
    const ratio = Math.min(1, stripped.length / toneSequence.length);
    return Number(ratio.toFixed(3));
  }

  private fallback(req: ConstrainedGenerationRequest): ConstrainedGenerationResponse {
    // Deterministic pseudo lines by hashing index.
    const variants: ConstrainedGenerationVariant[] = [];
    for (let i = 0; i < req.variants; i++) {
      const base = `${req.sceneTitle}_${i}`;
      const text = this.truncateToLength(base, req.toneSequence.length);
      variants.push({
        text,
        toneSequence: req.toneSequence,
        compliance: this.estimateCompliance(text, req.toneSequence),
      });
    }
    return { variants, warnings: ["FALLBACK_MODE"] };
  }

  private truncateToLength(base: string, len: number): string {
    if (base.length === len) return base;
    if (base.length > len) return base.slice(0, len);
    return base.padEnd(len, "。"); // pad with Chinese period for visibility
  }
}

export default ConstrainedGenerationLLM;
