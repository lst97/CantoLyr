import { z } from 'zod';

/**
 * Validation function for mapped tone patterns
 * Mapped tones: 1→3, 2→9, 3→4, 4→0, 5→5, 6→2
 */
export function isValidMappedTone(value: string): boolean {
  return /^[039452\s]+$/.test(value.trim());
}

/**
 * Search endpoint request schema
 */
export const SearchQuerySchema = z.object({
  v: z.string().min(1).refine(isValidMappedTone, {
    message: 'Invalid tone pattern. Must contain only mapped tone digits (0,3,9,4,5,2) and spaces'
  }),
  mode: z.enum(['all', 'vocab', 'char']).optional(),
  prefix: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(9999).optional()
});

/**
 * Compose line request schema
 */
export const ComposeRequestSchema = z.object({
  tonePattern: z.string().min(1).refine(isValidMappedTone, {
    message: 'Invalid tone pattern. Must contain only mapped tone digits (0,3,9,4,5,2) and spaces'
  }),
  maxPerGroup: z.number().int().min(1).max(100).optional(),
  theme: z.string().optional(),
  mood: z.string().optional(),
  genre: z.string().optional(),
  language: z.string().optional(),
  seed: z.number().optional()
});

/**
 * Feedback request schema
 */
export const FeedbackRequestSchema = z.object({
  readingId: z.string().transform((val) => {
    try {
      return BigInt(val);
    } catch {
      throw new Error('Invalid reading ID format');
    }
  }),
  accepted: z.boolean(),
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]+$/, {
    message: 'Session ID must contain only alphanumeric characters, underscores, and hyphens'
  }).optional(),
  context: z.object({
    tonePattern: z.string().optional(),
    theme: z.string().optional(),
    mood: z.string().optional(),
    genre: z.string().optional(),
    position: z.number().int().min(0).optional(),
    completeLine: z.string().optional(),
    usedLlm: z.boolean().optional()
  }).optional()
});

/**
 * Common error response schema for OpenAPI
 */
export const ErrorResponseSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        requestId: { type: 'string' },
        details: { type: 'object' }
      },
      required: ['code', 'message', 'requestId']
    }
  },
  required: ['error']
};

/**
 * Reading DTO schema for OpenAPI
 */
export const ReadingDTOSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    surface: { type: 'string' },
    jyutping: { type: 'string' },
    toneOriginal: { type: 'string' },
    toneMapped: { type: 'string' },
    syllables: { type: 'integer' },
    freq: { type: 'number' },
    pos: { type: 'string' },
    register: { type: 'string' },
    gloss: { type: 'string' },
    source: { type: 'string' },
    type: { type: 'string', enum: ['vocab', 'char'] },
    lang: { type: 'string' }
  },
  required: ['id', 'surface', 'jyutping', 'toneOriginal', 'toneMapped', 'syllables', 'freq', 'pos', 'register', 'gloss', 'source', 'type', 'lang']
};

/**
 * Search response schema for OpenAPI
 */
export const SearchResponseSchema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    count: { type: 'integer' },
    items: {
      type: 'array',
      items: ReadingDTOSchema
    },
    fromCache: { type: 'boolean' },
    processingTimeMs: { type: 'number' }
  },
  required: ['query', 'count', 'items', 'fromCache', 'processingTimeMs']
};

/**
 * Compose response schema for OpenAPI
 */
export const ComposeResponseSchema = {
  type: 'object',
  properties: {
    line: { type: 'string' },
    selections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          group: { type: 'integer' },
          option: { type: 'integer' },
          surface: { type: 'string' },
          readingId: { type: 'string' },
          freq: { type: 'number' }
        },
        required: ['group', 'option', 'surface', 'readingId']
      }
    },
    reason: { type: 'string' },
    usedLlm: { type: 'boolean' },
    processingTimeMs: { type: 'number' },
    totalCandidates: { type: 'integer' },
    filteredCandidates: { type: 'integer' }
  },
  required: ['line', 'selections', 'usedLlm', 'processingTimeMs', 'totalCandidates', 'filteredCandidates']
};

/**
 * Feedback response schema for OpenAPI
 */
export const FeedbackResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    processingTimeMs: { type: 'number' },
    sessionId: { type: 'string' },
    validation: {
      type: 'object',
      properties: {
        readingExists: { type: 'boolean' },
        readingSurface: { type: 'string' }
      },
      required: ['readingExists']
    }
  },
  required: ['success', 'processingTimeMs', 'sessionId', 'validation']
};