import { z } from "zod";

export const SearchPronunciationQuerySchema = z.object({
  p: z.string().min(1, "p is required"),
  mode: z.enum(["all", "vocab", "char"]).optional(),
  prefix: z.coerce.boolean().optional(),
  pageSize: z.coerce.number().int().min(1).max(20480).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const SearchRhymeQuerySchema = z.object({
  r: z.string().min(1, "rhyme is required"),
  mode: z.enum(["all", "vocab", "char"]).optional(),
  pageSize: z.coerce.number().int().min(1).max(20480).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const AiLexiconSearchQuerySchema = z.object({
  q: z.string().min(1, "q is required"),
  pronunciation: z.string()
    .min(1, "pronunciation is required")
    .max(4, "pronunciation must be at most 4 digits")
    .regex(/^[394052]+$/, "pronunciation must only contain digits 3, 9, 4, 0, 5, 2"),
  limit: z.coerce.number().int().min(1).max(100).optional(),
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

export const AiLexiconSearchItemSchema = z.object({
  id: z.string(),
  surface: z.string(),
  type: z.string(),
  lang: z.string(),
  jyutping: z.array(z.string()),
  pronunciation: z.string(),
  tone: z.string(),
  consonants: z.array(z.string()),
  rhymes: z.array(z.string()),
  syllables: z.number().int().nonnegative(),
  freq: z.number().optional(),
  pos: z.string().optional(),
  register: z.string().optional(),
  gloss: z.string().optional(),
  source: z.string().optional(),
  similarity: z.number().min(0).max(1),
});

export const AiLexiconSearchResponseSchema = z.object({
  query: z.string(),
  pronunciation: z.string(),
  count: z.number().int().nonnegative(),
  items: z.array(AiLexiconSearchItemSchema),
  fromCache: z.boolean(),
  processingTimeMs: z.number().int().nonnegative(),
});

const LyricPronunciationBigramSchema = z.object({
  value: z.string(),
  position: z.number().int().nonnegative(),
});

export const LyricSongSchema = z.object({
  id: z.string(),
  docId: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
});

export const LyricLineSchema = z.object({
  id: z.string(),
  lyricId: z.string(),
  song: LyricSongSchema,
  text: z.string(),
  lineIndex: z.number().int().nonnegative(),
  charCount: z.number().int().nonnegative(),
  syllableCount: z.number().int().nonnegative(),
  tokenCount: z.number().int().nonnegative(),
  tonePatternText: z.string(),
  pronunciationBigrams: z
    .array(LyricPronunciationBigramSchema)
    .optional(),
  sentiment: z.string().nullable().optional(),
  themes: z.array(z.string()).optional().nullable(),
  keywords: z.array(z.string()).optional().nullable(),
});

export const LyricSearchResponseSchema = z.object({
  query: z.string(),
  count: z.number().int().nonnegative(),
  items: z.array(LyricLineSchema),
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
export type AiLexiconSearchResponse = z.infer<
  typeof AiLexiconSearchResponseSchema
>;

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
