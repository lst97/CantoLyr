import type {
  LlmReranker,
  RerankInput,
  RerankResult,
  LlmConfig,
  RankingItem,
} from "../../../application/ports/LlmReranker.js";
import { GoogleGenAI } from '@google/genai';
import Ajv, { ValidateFunction } from "ajv";



/**
 * Expected JSON structure from Gemini for rankings
 */
const rankingResponseSchema = {
  type: "object",
  properties: {
    rankings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          readingId: { type: "string" },
          score: { type: "number" }, // Allow any number, we'll clamp it later
          reason: { type: "string" },
        },
        required: ["readingId", "score"],
      },
    },
  },
  required: ["rankings"],
};

/**
 * Google Gemini API implementation of LlmReranker using the official Google Gen AI SDK
 * Provides intelligent reranking of Cantonese readings based on context and constraints
 */
export class GeminiLlmReranker implements LlmReranker {
  private readonly ajv: Ajv;
  private readonly validateRankingResponse: ValidateFunction;
  private readonly genAI: GoogleGenAI;

  constructor(private readonly config: LlmConfig) {
    this.ajv = new Ajv();
    this.validateRankingResponse = this.ajv.compile(rankingResponseSchema);
    this.genAI = new GoogleGenAI({ apiKey: config.apiKey! });
  }

  async rerank(input: RerankInput): Promise<RerankResult> {
    const startTime = Date.now();

    try {
      await this.validateConfig();

      const prompt = this.buildPrompt(input);
      const response = await this.generateContent(prompt) as any;

      if (!response.text) {
        throw new Error("No text content in Gemini response");
      }

      const rankings = this.parseRankings(
        response.text,
        input.candidates.map((c) => c.id)
      );
      const processingTimeMs = Date.now() - startTime;

      return {
        rankings,
        success: true,
        model: this.config.model || "gemini-2.0-flash-001",
        processingTimeMs,
      };
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      return {
        rankings: [],
        success: false,
        error: errorMessage,
        model: this.config.model || "gemini-2.0-flash-001",
        processingTimeMs,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.validateConfig();
      return true;
    } catch {
      return false;
    }
  }

  getInfo() {
    return {
      provider: "Google Gemini",
      model: this.config.model || "gemini-2.0-flash-001",
      version: "2.0",
    };
  }

  async validateConfig(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error("Gemini API key is required");
    }

    if (this.config.timeoutMs && this.config.timeoutMs <= 0) {
      throw new Error("Timeout must be positive");
    }

    if (this.config.maxRetries && this.config.maxRetries < 0) {
      throw new Error("Max retries cannot be negative");
    }
  }

  private buildPrompt(input: RerankInput): string {
    const candidatesText = input.candidates
      .map(
        (c, idx) =>
          `${idx + 1}. ID: ${c.id}, Surface: "${c.surface}", Jyutping: "${
            c.jyutping
          }", Gloss: "${c.gloss}", POS: ${c.pos}, Register: ${c.register}`
      )
      .join("\n");

    const constraintsText = input.constraints
      ? `\nConstraints: ${JSON.stringify(input.constraints)}`
      : "";

    const contextText = input.context
      ? `\nContext: ${JSON.stringify(input.context)}`
      : "";

    return `You are helping compose Cantonese lyrics. Please rank the following Cantonese characters/words for the tone pattern "${input.tonePattern}".

Consider:
1. Semantic appropriateness for lyrical composition
2. Register and formality level
3. Frequency and common usage
4. Poetic and artistic value
5. Contextual relevance${constraintsText}${contextText}

Candidates:
${candidatesText}

Please respond with a JSON object containing a "rankings" array. Each item should have:
- readingId: the ID as a string
- score: a number between 0.0 and 1.0 (1.0 being best)
- reason: optional brief explanation

Example format:
{
  "rankings": [
    {"readingId": "123", "score": 0.9, "reason": "Perfect for romantic lyrics"},
    {"readingId": "456", "score": 0.7, "reason": "Good semantic fit"}
  ]
}`;
  }

  private async generateContent(prompt: string) {
    const model = this.config.model || "gemini-2.0-flash-001";
    
    // Create a timeout promise if timeout is configured
    const timeoutMs = this.config.timeoutMs || 30000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Gemini API request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    // Create the generation promise
    const generationPromise = this.genAI.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.3,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      },
    });

    // Race between generation and timeout
    return Promise.race([generationPromise, timeoutPromise]);
  }

  private parseRankings(
    textContent: string,
    validIds: bigint[]
  ): RankingItem[] {
    try {
      // Try to extract JSON from the response
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in Gemini response");
      }

      const parsed: any = JSON.parse(jsonMatch[0]);

      if (!this.validateRankingResponse(parsed)) {
        throw new Error(
          `Invalid ranking response format: ${this.ajv.errorsText(
            this.validateRankingResponse.errors
          )}`
        );
      }

      const validIdStrings = new Set(validIds.map((id) => id.toString()));

      return (parsed as any).rankings
        .filter((item: any) => validIdStrings.has(item.readingId))
        .map((item: any) => ({
          readingId: BigInt(item.readingId),
          score: Math.max(0, Math.min(1, item.score)), // Clamp to [0, 1]
          reason: item.reason,
        }));
    } catch (error) {
      throw new Error(
        `Failed to parse Gemini rankings: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}
