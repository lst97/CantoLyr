import { z } from "zod";

export const SearchPronunciationQuerySchema = z.object({
	p: z.string().min(1, "p is required"),
	mode: z.enum(["all", "vocab", "char"]).optional(),
	prefix: z.coerce.boolean().optional(),
	limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export const SearchRhymeQuerySchema = z.object({
	r: z.string().min(1, "rhyme is required"),
	mode: z.enum(["all", "vocab", "char"]).optional(),
	limit: z.coerce.number().int().min(1).max(1000).optional(),
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
