import type { Hono } from "hono";
import type { Container } from "../../../container/Container.ts";
import { z, ZodError } from "zod";
import {
  AiLexiconSearchQuerySchema,
  AiLexiconSearchResponseSchema,
  LyricSearchResponseSchema,
  SearchPronunciationQuerySchema,
  SearchResponseSchema,
  SearchRhymeQuerySchema,
} from "../schemas.ts";
import type { ReadingDTO, ReadingRepo } from "../../../../application/ports/ReadingRepo.ts";
import type { LyricLineDTO, LyricsRepo } from "../../../../application/ports/LyricsRepo.ts";
import type { EntryType } from "../../../../shared/types/common.ts";
import RetrievalService from "../../../../application/lyric/RetrievalService.ts";

export function registerSearchRoutes(app: Hono, container: Container) {
  const aiRetrieval = new RetrievalService();

  app.get("/lexicon/search/ai", async (c) => {
    try {
      const startTime = Date.now();
      const q = AiLexiconSearchQuerySchema.parse(c.req.query());
      const results = await aiRetrieval.searchLexiconByPronunciation({
        query: q.q,
        pronunciation: q.pronunciation,
        limit: q.limit,
      });
      const payload = AiLexiconSearchResponseSchema.parse({
        query: q.q,
        pronunciation: q.pronunciation,
        count: results.length,
        items: results.map((item) => ({
          id: item.id,
          surface: item.surface,
          type: item.type,
          lang: item.lang,
          jyutping: item.jyutping,
          pronunciation: item.pronunciation,
          tone: item.tone,
          consonants: item.consonants,
          rhymes: item.rhymes,
          syllables: item.syllables,
          freq: item.freq,
          pos: item.pos,
          register: item.register,
          gloss: item.gloss,
          source: item.source,
          similarity: item.similarity,
        })),
        fromCache: false,
        processingTimeMs: Date.now() - startTime,
      });
      return c.json(payload);
    } catch (error) {
      const message = error instanceof ZodError
        ? error.issues
        : error instanceof Error
        ? error.message
        : "Unknown error";
      return c.json({ error: { code: "INVALID_REQUEST", message } }, 400);
    }
  });

  // GET /lexicon/search/pronunciation
  app.get("/lexicon/search/pronunciation", async (c) => {
    try {
      const startTime = Date.now();
      const q = SearchPronunciationQuerySchema.parse(c.req.query());
      const repo = container.resolve("readingRepo") as ReadingRepo;
      const entryType: EntryType | undefined = q.mode && q.mode !== "all"
        ? (q.mode as EntryType)
        : undefined;
      const isPrefix = typeof q.prefix === "boolean" ? q.prefix : undefined;
      const [results, totalCount] = await Promise.all([
        repo.searchByPronunciation({
          pronunciation: q.p,
          offset: q.offset ?? 0,
          isPrefix,
          entryType,
          limit: typeof q.pageSize === "number" ? q.pageSize : undefined,
        }),
        repo.countByPronunciation({
          pronunciation: q.p,
          isPrefix,
          entryType,
        }),
      ]);

      const payload = SearchResponseSchema.parse({
        query: q.p,
        count: totalCount,
        items: results.map((item: ReadingDTO) => ({
          ...item,
          id: item.id.toString(),
          entryId: item.entryId?.toString(),
        })),
        fromCache: false,
        processingTimeMs: Date.now() - startTime,
      });
      return c.json(payload);
    } catch (error) {
      const message = error instanceof ZodError
        ? error.issues
        : error instanceof Error
        ? error.message
        : "Unknown error";
      return c.json({ error: { code: "INVALID_REQUEST", message } }, 400);
    }
  });

  // GET /lexicon/search/rhyme
  app.get("/lexicon/search/rhyme", async (c) => {
    try {
      const startTime = Date.now();
      const q = SearchRhymeQuerySchema.parse(c.req.query());
      const repo = container.resolve("readingRepo") as ReadingRepo;
      const entryType: EntryType | undefined = q.mode && q.mode !== "all"
        ? (q.mode as EntryType)
        : undefined;
      const [results, totalCount] = await Promise.all([
        repo.searchByRhyme({
          rhyme: q.r,
          offset: q.offset ?? 0,
          entryType,
          limit: typeof q.pageSize === "number" ? q.pageSize : undefined,
        }),
        repo.countByRhyme({
          rhyme: q.r,
          entryType,
        }),
      ]);

      const payload = SearchResponseSchema.parse({
        query: q.r,
        count: totalCount,
        items: results.map((item: ReadingDTO) => ({
          ...item,
          id: item.id.toString(),
          entryId: item.entryId?.toString(),
        })),
        fromCache: false,
        processingTimeMs: Date.now() - startTime,
      });
      return c.json(payload);
    } catch (error) {
      const message = error instanceof ZodError
        ? error.issues
        : error instanceof Error
        ? error.message
        : "Unknown error";
      return c.json({ error: { code: "INVALID_REQUEST", message } }, 400);
    }
  });

  // GET /lyrics/search/pronunciation (mapped tone bigram)
  // Params: p=03&position=2&themes=a,b&keywords=c,d&lyricist=...&artist=...&id=...&sentiment=...&year=2020&limit=50&offset=0
  const LyricPronSearchSchema = z.object({
    p: z.string().min(1, "p is required"),
    position: z.coerce.number().int().positive().optional(),
    themes: z.string().optional(),
    keywords: z.string().optional(),
    lyricist: z.string().optional(),
    artist: z.string().optional(),
    id: z.string().optional(),
    sentiment: z.string().optional(),
    year: z.coerce.number().int().optional(),
    pageSize: z.coerce.number().int().min(1).max(20480).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  });

  app.get("/lyrics/search/pronunciation", async (c) => {
    try {
      const startTime = Date.now();
      const q = LyricPronSearchSchema.parse(c.req.query());
      const repo = container.resolve("lyricsRepo") as LyricsRepo;
      const themes = q.themes ? q.themes.split(",").filter(Boolean) : undefined;
      const keywords = q.keywords ? q.keywords.split(",").filter(Boolean) : undefined;
      const [results, totalCount] = await Promise.all([
        repo.searchLyricLines({
          pronunciation: q.p,
          pronunciationPosition: q.position,
          themes,
          keywords,
          lyricist: q.lyricist,
          artist: q.artist,
          id: q.id,
          sentiment: q.sentiment,
          year: q.year,
          limit: q.pageSize,
          offset: q.offset,
        }),
        repo.countLyricLines({
          pronunciation: q.p,
          pronunciationPosition: q.position,
          themes,
          keywords,
          lyricist: q.lyricist,
          artist: q.artist,
          id: q.id,
          sentiment: q.sentiment,
          year: q.year,
        }),
      ]);

      const payload = LyricSearchResponseSchema.parse({
        query: q.p,
        count: totalCount,
        items: results.map((item: LyricLineDTO) => ({
          ...item,
          id: item.id.toString(),
          song: {
            ...item.song,
            id: item.song.id.toString(),
          },
        })),
        fromCache: false,
        processingTimeMs: Date.now() - startTime,
      });
      return c.json(payload);
    } catch (error) {
      const message = error instanceof ZodError
        ? error.issues
        : error instanceof Error
        ? error.message
        : "Unknown error";
      return c.json({ error: { code: "INVALID_REQUEST", message } }, 400);
    }
  });

  // GET /lyrics/search/rhyme
  const LyricRhymeSearchSchema = z.object({
    r: z.string().min(1, "r is required"),
    rhymePosition: z.coerce.number().int().positive().optional(),
    themes: z.string().optional(),
    keywords: z.string().optional(),
    lyricist: z.string().optional(),
    artist: z.string().optional(),
    id: z.string().optional(),
    sentiment: z.string().optional(),
    year: z.coerce.number().int().optional(),
    pageSize: z.coerce.number().int().min(1).max(20480).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  });

  app.get("/lyrics/search/rhyme", async (c) => {
    try {
      const startTime = Date.now();
      const q = LyricRhymeSearchSchema.parse(c.req.query());
      const repo = container.resolve("lyricsRepo") as LyricsRepo;
      const themes = q.themes ? q.themes.split(",").filter(Boolean) : undefined;
      const keywords = q.keywords ? q.keywords.split(",").filter(Boolean) : undefined;
      const rhymeParts = q.r
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      const rhymeParam = rhymeParts.length > 1
        ? Array.from(new Set(rhymeParts))
        : rhymeParts[0] ?? undefined;

      const [results, totalCount] = await Promise.all([
        repo.searchLyricLines({
          rhyme: rhymeParam,
          rhymePosition: q.rhymePosition,
          themes,
          keywords,
          lyricist: q.lyricist,
          artist: q.artist,
          id: q.id,
          sentiment: q.sentiment,
          year: q.year,
          limit: q.pageSize,
          offset: q.offset,
        }),
        repo.countLyricLines({
          rhyme: rhymeParam,
          rhymePosition: q.rhymePosition,
          themes,
          keywords,
          lyricist: q.lyricist,
          artist: q.artist,
          id: q.id,
          sentiment: q.sentiment,
          year: q.year,
        }),
      ]);

      const queryTerm = Array.isArray(rhymeParam) ? rhymeParam.join(",") : rhymeParam ?? q.r;
      const payload = LyricSearchResponseSchema.parse({
        query: queryTerm,
        count: totalCount,
        items: results.map((item: LyricLineDTO) => ({
          ...item,
          id: item.id.toString(),
          song: {
            ...item.song,
            id: item.song.id.toString(),
          },
        })),
        fromCache: false,
        processingTimeMs: Date.now() - startTime,
      });
      return c.json(payload);
    } catch (error) {
      const message = error instanceof ZodError
        ? error.issues
        : error instanceof Error
        ? error.message
        : "Unknown error";
      return c.json({ error: { code: "INVALID_REQUEST", message } }, 400);
    }
  });
}
