import { z } from "zod";

const LyricGenerationConfigSchema = z.object({
  // Semantic search configuration
  semanticTarget: z.number().min(0).max(1).default(0.8),
  minSemanticThreshold: z.number().min(0).max(1).default(0.3),

  // Frequency sampling configuration
  freqTop: z.number().int().positive().default(100),
  freqRandom: z.number().int().positive().default(50),

  // Retrieval and ranking configuration
  topKSize: z.number().int().positive().default(20),
  mmrLambda: z.number().min(0).max(1).default(0.5),

  // Generation parameters
  maxRetries: z.number().int().min(0).default(3),
  timeoutMs: z.number().int().positive().default(30000),
});

export type LyricGenerationConfig = z.infer<typeof LyricGenerationConfigSchema>;

/**
 * Gets lyric generation configuration from environment variables.
 */
export function getLyricGenerationConfig(): LyricGenerationConfig {
  const config = {
    semanticTarget: parseFloat(Deno.env.get("LYRIC_SEMANTIC_TARGET") || "0.8"),
    minSemanticThreshold: parseFloat(
      Deno.env.get("LYRIC_MIN_SEMANTIC_THRESHOLD") || "0.3",
    ),
    freqTop: parseInt(Deno.env.get("LYRIC_FREQ_TOP") || "100", 10),
    freqRandom: parseInt(Deno.env.get("LYRIC_FREQ_RANDOM") || "50", 10),
    topKSize: parseInt(Deno.env.get("LYRIC_TOP_K_SIZE") || "20", 10),
    mmrLambda: parseFloat(Deno.env.get("LYRIC_MMR_LAMBDA") || "0.5"),
    maxRetries: parseInt(Deno.env.get("LYRIC_MAX_RETRIES") || "3", 10),
    timeoutMs: parseInt(Deno.env.get("LYRIC_TIMEOUT_MS") || "30000", 10),
  };

  const result = LyricGenerationConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(
      `Invalid lyric generation configuration: ${result.error.message}`,
    );
  }

  return result.data;
}
