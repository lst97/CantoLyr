import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type {
  LyricsAnnotator,
  LyricsAnnotatorConfig,
  LyricsAnnotatorInput,
  LyricsAnnotatorOutput,
} from "../../../application/ports/LyricsAnnotator.ts";

const annotationSchema = z.object({
  songGenre: z.array(z.string()),
  lines: z.array(
    z.object({
      id: z.string(),
      semantics: z.object({
        themes: z.array(z.string()),
        sentiment: z.enum([
          "VERY_NEGATIVE",
          "NEGATIVE",
          "NEUTRAL",
          "POSITIVE",
          "VERY_POSITIVE",
        ]),
        keywords: z.array(z.string()),
      }),
      tokens: z.array(z.object({ text: z.string(), pos: z.string() })),
      syntax_notes: z.string().min(1),
    }),
  ),
});

export class GeminiLyricsAnnotator implements LyricsAnnotator {
  private readonly genAI: GoogleGenAI;

  constructor(private readonly config: LyricsAnnotatorConfig) {
    // Use a shallow wrapper schema to avoid nesting depth limits.
    // The model returns: [{ songId: string, result: { songGenre, lines[...] } }]
    this.genAI = new GoogleGenAI({ apiKey: config.apiKey! });
  }

  validateConfig(): void {
    if (!this.config.apiKey) throw new Error("Gemini API key is required");
    if (this.config.timeoutMs && this.config.timeoutMs <= 0) {
      throw new Error("Timeout must be positive");
    }
    if (this.config.maxRetries && this.config.maxRetries < 0) {
      throw new Error("Max retries cannot be negative");
    }
  }

  async annotate(input: LyricsAnnotatorInput): Promise<LyricsAnnotatorOutput> {
    this.validateConfig();

    const prompt = this.buildPrompt(input);

    const maxRetries = Math.max(0, this.config.maxRetries ?? 2);
    let modelToUse = this.config.model || "gemini-2.5-flash";
    let lastErr: any;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.generateContent(prompt, modelToUse);
        const text = this.extractText(response);
        if (!text) throw new Error("No text content in Gemini response");

        const match = text.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("No JSON found in Gemini response");

        const parsed = JSON.parse(match[0]);
        const validation = annotationSchema.safeParse(parsed);
        if (!validation.success) {
          throw new Error(
            `Invalid annotation response: ${validation.error.message}`,
          );
        }
        return validation.data as LyricsAnnotatorOutput;
      } catch (err) {
        lastErr = err;
        // Optional fallback: on rate limit, switch to a lighter model for remaining retries
        if (
          this.config.enableFallback !== false &&
          this.isRateLimitError(err)
        ) {
          const fallback = this.getFallbackModel(modelToUse);
          if (fallback && fallback !== modelToUse) {
            modelToUse = fallback;
            // small jitter before retrying with fallback
            await new Promise((r) => setTimeout(r, 250));
            continue;
          }
        }
        if (attempt === maxRetries) break;
        const base = 500; // ms
        const backoff = base * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    throw new Error(
      `GeminiLyricsAnnotator failed after retries: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`,
    );
  }

  // Batch annotation removed per request

  private buildPrompt(input: LyricsAnnotatorInput): string {
    const header = [
      "你是一個懂廣東歌語義理解的專家。",
      "先通讀整首歌，理解故事、主題與情感走向。",
      "然後只輸出需要填寫的欄位：每行的 semantics、每個 token 的 POS、每行的 syntax_notes，以及整首歌的 genre。",
      "請以 JSON 格式輸出，且只包含以下結構與欄位，不要多餘文字:",
      "{",
      '  "songGenre": string[],',
      '  "lines": [',
      "    {",
      '      "id": string,',
      '      "semantics": { "themes": string[], "sentiment": "VERY_NEGATIVE|NEGATIVE|NEUTRAL|POSITIVE|VERY_POSITIVE", "keywords": string[] },',
      '      "tokens": [ { "text": string, "pos": string } ],',
      '      "syntax_notes": string',
      "    }",
      "  ]",
      "}",
      "要求：",
      "- themes 與 keywords 必須使用繁體中文。",
      "- sentiment 必須使用大寫(例如：VERY_NEGATIVE、NEGATIVE、NEUTRAL、POSITIVE、VERY_POSITIVE)。",
      "- tokens.pos 必須使用大寫詞性標註(例如：NOUN, VERB, ADJ, ADV, PRON, DET, ADP/PREP, CONJ, INTJ, NUM, PART, AUX, PROPN, PUNCT)。",
      "- syntax_notes 必須填寫，使用繁體中文，簡要描述此行語法/修辭或語氣重點(不可留空)。",
    ].join("\n");

    const meta = [
      input.title ? `標題: ${input.title}` : undefined,
      input.artists?.length ? `歌手: ${input.artists.join(", ")}` : undefined,
      input.lyricists?.length ? `填詞: ${input.lyricists.join(", ")}` : undefined,
      input.language ? `語言: ${input.language}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");

    const lines = input.lines
      .map((l) => {
        const tokenList = l.tokens?.map((t) => t.text).join("|") || "";
        return tokenList ? `${l.id}\t${l.text}\tTOKENS:${tokenList}` : `${l.id}\t${l.text}`;
      })
      .join("\n");

    return [
      header,
      "\n--- 元資料 ---",
      meta,
      "\n--- 歌詞(每行) ---",
      lines,
    ].join("\n");
  }

  private generateContent(prompt: string, model?: string) {
    const modelToUse = model || this.config.model || "gemini-2.5-flash";
    const timeoutMs = this.config.timeoutMs || 600000;

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(`Gemini API request timed out after ${timeoutMs}ms`),
          ),
        timeoutMs,
      );
    });

    const generationPromise = this.genAI.models.generateContent({
      model: modelToUse,
      contents: prompt,
      config: {
        temperature: 0.2,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 20480,
        responseModalities: ["TEXT"],
        responseMimeType: "application/json",
        responseJsonSchema: annotationSchema as any,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    return Promise.race([generationPromise, timeoutPromise]);
  }

  private isRateLimitError(err: any): boolean {
    try {
      const code = (
        err?.code ||
        err?.status ||
        err?.statusCode ||
        ""
      ).toString();
      const msg = (err?.message || "").toString().toLowerCase();
      if (code === "429") return true;
      if (msg.includes("rate") && msg.includes("limit")) return true;
      if (msg.includes("quota") || msg.includes("resource_exhausted")) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private getFallbackModel(current: string): string | undefined {
    // Prefer explicit Flash-Lite when possible
    if (/flash-lite/i.test(current)) return current;
    // Common 2.5 Flash -> 2.5 Flash-Lite
    if (/gemini-2\.5-flash(-\w+)?/i.test(current)) {
      return "gemini-2.5-flash-lite";
    }
    // Generic 2.5 -> 2.5 Flash-Lite
    if (/gemini-2\.5/i.test(current)) return "gemini-2.5-flash-lite";
    // Fallback default
    return "gemini-2.5-flash-lite";
  }

  private extractText(response: any): string | undefined {
    try {
      if (!response) return undefined;
      if (typeof response.text === "string" && response.text.trim()) {
        return response.text;
      }

      const maybeResp = response.response ?? response;
      if (maybeResp && typeof maybeResp.text === "function") {
        const t = maybeResp.text();
        if (typeof t === "string" && t.trim()) return t;
      }

      const candidates = maybeResp?.candidates ?? response?.candidates;
      if (Array.isArray(candidates) && candidates.length) {
        for (const c of candidates) {
          const contentItems = c?.content ? Array.isArray(c.content) ? c.content : [c.content] : [];
          for (const content of contentItems) {
            const parts = content?.parts ?? c?.parts ?? [];
            if (Array.isArray(parts) && parts.length) {
              for (const p of parts) {
                if (typeof p?.text === "string" && p.text.trim()) return p.text;
              }
            }
          }
          if (typeof c?.text === "string" && c.text.trim()) return c.text;
        }
      }

      if (
        typeof maybeResp?.output_text === "string" &&
        maybeResp.output_text.trim()
      ) {
        return maybeResp.output_text;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  // Batch helpers removed per request
}
