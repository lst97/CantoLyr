// SceneIntentLLM (Infrastructure Adapter)
// Lightweight intent inference using a generic Gemini-like JSON output pattern.
// If an API key or model is not configured, falls back to heuristic extraction.

export interface SceneIntentInput {
  prompt: string; // user high-level theme
  previousLines?: string[]; // to support continuity hints
}

export interface SceneIntentOutput {
  title: string;
  emotions: string[];
  microIntent: string;
  continuityNotes: string;
  rawModelText?: string; // debugging
}

export interface SceneIntentLLMConfig {
  apiKey?: string;
  model?: string; // e.g. gemini-pro
  endpoint?: string; // override base endpoint
  temperature?: number;
  maxOutputTokens?: number;
  enable?: boolean; // allow turning off
}

export class SceneIntentLLM {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly temperature: number;
  private readonly maxOutputTokens: number;
  private readonly enabled: boolean;

  constructor(cfg: SceneIntentLLMConfig = {}) {
    this.apiKey = cfg.apiKey ?? Deno.env.get("GEMINI_API_KEY");
    this.model = cfg.model ?? "gemini-pro";
    this.endpoint = cfg.endpoint ??
      "https://generativelanguage.googleapis.com/v1beta/models";
    this.temperature = cfg.temperature ?? 0.4;
    this.maxOutputTokens = cfg.maxOutputTokens ?? 256;
    this.enabled = cfg.enable ?? true;
  }

  async infer(input: SceneIntentInput): Promise<SceneIntentOutput> {
    if (!this.enabled || !this.apiKey) {
      return this.heuristic(input);
    }
    const systemPrompt =
      `You extract structured scene intent for Cantonese lyric generation. Output ONLY strict JSON with keys: title, emotions (array of <=4 lowercase tokens), microIntent, continuityNotes.`;
    const userPrompt = `Theme: ${input.prompt}\nPrevious lines: ${
      (input.previousLines ?? []).join(" | ") || "NONE"
    }`;
    const url = `${this.endpoint}/${this.model}:generateContent?key=${this.apiKey}`;
    const body = {
      contents: [
        { role: "user", parts: [{ text: systemPrompt + "\n" + userPrompt }] },
      ],
      generationConfig: {
        temperature: this.temperature,
        maxOutputTokens: this.maxOutputTokens,
      },
    };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`INTENT_LLM_HTTP_${res.status}`);
      const json = await res.json();
      const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ??
        "";
      const parsed = this.safeParse(text);
      return { ...parsed, rawModelText: text };
    } catch (err) {
      // fallback to heuristic
      return this.heuristic(input, (err as Error).message);
    }
  }

  private safeParse(text: string): SceneIntentOutput {
    try {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end !== -1) {
        const slice = text.slice(start, end + 1);
        const obj = JSON.parse(slice);
        return {
          title: String(obj.title || "Untitled"),
          emotions: Array.isArray(obj.emotions)
            ? obj.emotions.slice(0, 4).map((e: unknown) => String(e).toLowerCase())
            : [],
          microIntent: String(obj.microIntent || ""),
          continuityNotes: String(obj.continuityNotes || ""),
        };
      }
    } catch (_) { /* swallow */ }
    return {
      title: "Untitled",
      emotions: [],
      microIntent: "",
      continuityNotes: "",
    };
  }

  private heuristic(input: SceneIntentInput, note?: string): SceneIntentOutput {
    const emotions = this.extractEmotions(input.prompt);
    return {
      title: input.prompt.split(/\s+/).slice(0, 4).join(" "),
      emotions,
      microIntent: emotions.length ? `evoke_${emotions[0]}` : "evoke_feeling",
      continuityNotes: input.previousLines?.length
        ? "Maintain thematic coherence."
        : "Initiate scene.",
      ...(note ? { rawModelText: `fallback:${note}` } : {}),
    };
  }

  private extractEmotions(text: string): string[] {
    const candidates = [
      "joy",
      "sorrow",
      "nostalgia",
      "hope",
      "anger",
      "longing",
      "calm",
    ];
    const lower = text.toLowerCase();
    const found: string[] = [];
    for (const c of candidates) {
      if (lower.includes(c) && found.length < 4) found.push(c);
    }
    if (!found.length) found.push("neutral");
    return found;
  }
}

export default SceneIntentLLM;
