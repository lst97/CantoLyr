export {};

import { z } from "zod";

export const SearchPronunciationQuerySchema = z.object({
  p: z.string().min(1, "p is required"),
  entryType: z.enum(["all", "vocab", "char"]).optional(),
  mode: z.enum(["all", "vocab", "char"]).optional(),
  prefix: z.coerce.boolean().optional(),
  pageSize: z.coerce.number().int().min(1).max(20480).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const SearchRhymeQuerySchema = z.object({
  r: z.string().min(1, "rhyme is required"),
  entryType: z.enum(["all", "vocab", "char"]).optional(),
  mode: z.enum(["inclusive", "sequence", "both"]).optional(),
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

export const LexiconSearchListSchema = z.object({
  count: z.number().int().nonnegative(),
  items: z.array(ReadingItemSchema),
});

export const LexiconRhymeSearchVariantsResponseSchema = z.object({
  query: z.string(),
  inclusive: LexiconSearchListSchema.optional(),
  sequence: LexiconSearchListSchema.optional(),
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

const PatternSlotSchema = z.object({
  id: z.string(),
  toneDigit: z.string(),
  posTag: z.string(),
  description: z.string(),
  retrievalPrompt: z.string(),
});

const LinePatternSchema = z.object({
  id: z.string(),
  patternString: z.string(),
  groups: z.array(z.string()),
  slots: z.array(PatternSlotSchema),
});

const CandidatePoolStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  semanticCount: z.number().int().nonnegative(),
  freqTopCount: z.number().int().nonnegative(),
  freqRandomCount: z.number().int().nonnegative(),
});

const LineCandidateSchema = z.object({
  text: z.string(),
  patternId: z.string(),
});

const LineSentenceSchema = z.object({
  text: z.string(),
  patternId: z.string(),
  finalRank: z.number(),
  mmrScore: z.number(),
});

const LineResultSchema = z.object({
  lineIndex: z.number().int().nonnegative(),
  toneSequence: z.string(),
  digitSet: z.array(z.string()),
  patterns: z.array(LinePatternSchema),
  candidatePoolStats: CandidatePoolStatsSchema,
  topSentences: z.array(LineSentenceSchema),
  topParagraphCandidates: z.array(z.string()),
  allLineCandidates: z.array(LineCandidateSchema),
  warnings: z.array(z.string()),
  error: z.string().optional(),
});

const SessionMetaSchema = z.object({
  feature: z.string(),
  version: z.number().int().nonnegative(),
  createdAt: z.string(),
  seed: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  processingTimeMs: z.number().int().nonnegative().optional(),
});

export const LyricGenerationResponseSchema = z.object({
  meta: SessionMetaSchema,
  lines: z.array(LineResultSchema),
  topOutputs: z.array(z.string()).optional(),
});

const LyricPronunciationBigramSchema = z.object({
  value: z.string(),
  position: z.number().int().nonnegative(),
  length: z.number().int().positive(),
  characters: z.string().optional(),
});

const MatchedSyllableSchema = z.object({
  position: z.number().int().nonnegative(),
  jyutping: z.string(),
  jyutpingNormalized: z.string().nullable().optional(),
  consonant: z.string().nullable().optional(),
  rhyme: z.string().nullable().optional(),
  toneRaw: z.number().int().nullable().optional(),
  toneDigit: z.number().int().nullable().optional(),
  char: z.string().nullable().optional(),
});

const LyricNormalizationSchema = z.object({
  isValid: z.boolean(),
  originalText: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const LyricRhymeMatchSchema = z.object({
  value: z.string(),
  position: z.number().int().nonnegative(),
  length: z.number().int().positive(),
  characters: z.string().optional(),
});

export const LyricSongSchema = z.object({
  id: z.string(),
  docId: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  artists: z.array(z.string()).optional(),
  lyricists: z.array(z.string()).optional(),
});

const LyricTokenSchema = z.object({
  position: z.number().int().nonnegative(),
  text: z.string(),
  pos: z.string().nullable().optional(),
  syllables: z.array(MatchedSyllableSchema).optional(),
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
  rhymeMatches: z
    .array(LyricRhymeMatchSchema)
    .optional(),
  matchedSyllables: z
    .array(MatchedSyllableSchema)
    .optional(),
  tokens: z.array(LyricTokenSchema).optional(),
  syntaxNotes: z.string().nullable().optional(),
  sentiment: z.string().nullable().optional(),
  themes: z.array(z.string()).optional().nullable(),
  keywords: z.array(z.string()).optional().nullable(),
  normalization: LyricNormalizationSchema,
});

export const LyricSearchListSchema = z.object({
  count: z.number().int().nonnegative(),
  items: z.array(LyricLineSchema),
});

export const LyricSearchResponseSchema = z.object({
  query: z.string(),
  count: z.number().int().nonnegative(),
  items: z.array(LyricLineSchema),
  fromCache: z.boolean(),
  processingTimeMs: z.number().int().nonnegative(),
});

export const LyricFilterOptionsSchema = z.object({
  themes: z.array(z.string()),
  keywords: z.array(z.string()),
  lyricists: z.array(z.string()),
  artists: z.array(z.string()),
  years: z.array(z.number().int()),
  sentiments: z.array(z.string()),
});

export const LyricFilterOptionsResponseSchema = z.object({
  options: LyricFilterOptionsSchema,
  fromCache: z.boolean(),
  fetchedAt: z.string(),
});

export const LyricRhymeSearchVariantsResponseSchema = z.object({
  query: z.string(),
  inclusive: LyricSearchListSchema.optional(),
  sequence: LyricSearchListSchema.optional(),
  fromCache: z.boolean(),
  processingTimeMs: z.number().int().nonnegative(),
});

export const LyricSearchQuerySchema = z.object({
  tone: z.string().min(1, "tone is required when rhythm is absent").optional(),
  tonePosition: z.coerce.number().int().positive().optional(),
  rhyme: z.string().min(1, "rhyme is required when tone is absent").optional(),
  rhythm: z.string().min(1).optional(),
  rythem: z.string().min(1).optional(),
  rhymePosition: z.coerce.number().int().positive().optional(),
  rhythmPosition: z.coerce.number().int().positive().optional(),
  rythemPosition: z.coerce.number().int().positive().optional(),
  rhymeSequence: z.coerce.boolean().optional(),
  mode: z.enum(["inclusive", "sequence", "both"]).optional(),
  themes: z.string().optional(),
  keywords: z.string().optional(),
  lyricist: z.string().optional(),
  artist: z.string().optional(),
  lyricId: z.string().optional(),
  sentiment: z.string().optional(),
  year: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().min(1).max(20480).optional(),
  offset: z.coerce.number().int().min(0).optional(),
}).superRefine((value, ctx) => {
  const hasTone = typeof value.tone === "string" && value.tone.trim().length > 0;
  const hasRhyme = typeof value.rhyme === "string" && value.rhyme.trim().length > 0;
  const hasRhythm = typeof value.rhythm === "string" && value.rhythm.trim().length > 0;
  const hasRythem = typeof value.rythem === "string" && value.rythem.trim().length > 0;
  if (!hasTone && !hasRhyme && !hasRhythm && !hasRythem) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "tone or rhythm is required",
      path: ["tone"],
    });
  }
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
export type LyricGenerationResponse = z.infer<
  typeof LyricGenerationResponseSchema
>;
export type LyricFilterOptionsResponse = z.infer<
  typeof LyricFilterOptionsResponseSchema
>;
export type LyricSearchQuery = z.infer<typeof LyricSearchQuerySchema>;

export const LyricGenerateRequestSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  tones: z.union([
    z.string().min(1, "tones is required"),
    z.array(z.string().min(1, "tone sequence must not be empty")).min(
      1,
      "tones must include at least one sequence",
    ),
  ]),
  seed: z.coerce.number().int().min(0).optional(),
  top: z.coerce.number().int().min(0).max(10).optional(),
  feature: z.string().min(1).optional(),
});

export type LyricGenerateRequest = z.infer<typeof LyricGenerateRequestSchema>;
