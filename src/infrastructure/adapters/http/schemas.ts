import { z } from "zod";

export const SearchPronunciationQuerySchema = z.object({
  p: z.string().min(1, "p is required"),
  mode: z.enum(["all", "vocab", "char"]).optional(),
  prefix: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(20480).optional(),
});

export const SearchRhymeQuerySchema = z.object({
  r: z.string().min(1, "rhyme is required"),
  mode: z.enum(["all", "vocab", "char"]).optional(),
  limit: z.coerce.number().int().min(1).max(20480).optional(),
});

export const ReadingItemSchema = z.object({
  id: z.string(),
  entryId: z.string().optional(),
  surface: z.string(),
  type: z.enum(["vocab", "char"]),
  lang: z.string(),
  jyutping: z.array(z.string()),
  tone: z.string(),
  pronunciation: z.string(),
  consonants: z.array(z.string()),
  rhymes: z.array(z.string()),
  syllables: z.number(),
  freq: z.number(),
  pos: z.string(),
  register: z.string(),
  gloss: z.string(),
  source: z.string(),
});

export const SearchResponseSchema = z.object({
  query: z.string(),
  count: z.number().int().nonnegative(),
  items: z.array(ReadingItemSchema),
  fromCache: z.boolean(),
  processingTimeMs: z.number().int().nonnegative(),
});

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});

export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

const ToneSequenceSchema = z.string()
  .min(3, "tone sequence must be at least 3 digits")
  .max(20, "tone sequence must be at most 20 digits")
  .regex(/^[0-9]+$/, "tone sequence must contain digits only");

const RetrievalConfigOverrideSchema = z.object({
  semanticTarget: z.number().positive().optional(),
  freqTop: z.number().int().min(0).optional(),
  freqRandom: z.number().int().min(0).optional(),
  minSemanticThreshold: z.number().min(0).optional(),
  semanticMinSimilarity: z.number().min(0).max(1).optional(),
});

const GenerationConfigOverrideSchema = z.object({
  variantsPerPattern: z.number().int().min(1).max(10).optional(),
  maxRetriesPerSentence: z.number().int().min(0).max(10).optional(),
});

const RankingConfigOverrideSchema = z.object({
  topKSize: z.number().int().min(1).optional(),
  mmrLambda: z.number().min(0).max(1).optional(),
  similarityThreshold: z.number().min(0).max(1).optional(),
  llmWeight: z.number().min(0).max(1).optional(),
});

export const GenerateSessionRequestSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  toneSequences: z.array(ToneSequenceSchema).min(
    1,
    "toneSequences must not be empty",
  ),
  seed: z.coerce.number().int().min(0).optional(),
  top: z.coerce.number().int().min(0).max(10).optional(),
  feature: z.string().min(1).optional(),
  scene: z.object({
    title: z.string().min(1).optional(),
    emotions: z.array(z.string().min(1)).max(6).optional(),
    microIntent: z.string().optional(),
    continuityNotes: z.string().optional(),
  }).optional(),
  config: z.object({
    retrieval: RetrievalConfigOverrideSchema.optional(),
    generation: GenerationConfigOverrideSchema.optional(),
    ranking: RankingConfigOverrideSchema.optional(),
  }).optional(),
});

export type GenerateSessionRequest = z.infer<
  typeof GenerateSessionRequestSchema
>;
