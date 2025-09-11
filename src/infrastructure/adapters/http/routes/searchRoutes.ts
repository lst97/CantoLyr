import type { Hono } from "hono";
import type { Container } from "../../../container/Container.ts";
import { ZodError, z } from "zod";
import { SearchPronunciationQuerySchema, SearchRhymeQuerySchema } from "../schemas.ts";
import type { EntryType } from "../../../../shared/types/common.ts";

export function registerSearchRoutes(app: Hono, container: Container) {
  // GET /lexicon/search/pronunciation
  app.get("/lexicon/search/pronunciation", async (c) => {
    try {
      const q = SearchPronunciationQuerySchema.parse(c.req.query());
      const repo = container.resolve("readingRepo");
      const entryType: EntryType | undefined = q.mode && q.mode !== "all"
        ? (q.mode as EntryType)
        : undefined;
      const results = await repo.searchByPronunciation({
        pronunciation: q.p,
        offset: 0,
        isPrefix: typeof q.prefix === "boolean" ? q.prefix : undefined,
        entryType,
        limit: typeof q.limit === "number" ? q.limit : undefined,
      });

      const payload = {
        query: q.p,
        count: results.length,
        items: results.map((item) => ({
          ...item,
          id: item.id.toString(),
          entryId: item.entryId?.toString(),
        })),
        fromCache: false,
        processingTimeMs: 0,
      };
      // Explicitly set UTF-8 to avoid any client-side charset misinterpretation
      const json = JSON.stringify(payload);
      c.header("Content-Type", "application/json; charset=utf-8");
      return c.body(json);
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
      const q = SearchRhymeQuerySchema.parse(c.req.query());
      const repo = container.resolve("readingRepo");
      const entryType: EntryType | undefined = q.mode && q.mode !== "all"
        ? (q.mode as EntryType)
        : undefined;
      const results = await repo.searchByRhyme({
        rhyme: q.r,
        offset: 0,
        entryType,
        limit: typeof q.limit === "number" ? q.limit : undefined,
      });

      const payload = {
        query: q.r,
        count: results.length,
        items: results.map((item) => ({
          ...item,
          id: item.id.toString(),
          entryId: item.entryId?.toString(),
        })),
        fromCache: false,
        processingTimeMs: 0,
      };
      const json = JSON.stringify(payload);
      c.header("Content-Type", "application/json; charset=utf-8");
      return c.body(json);
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
    limit: z.coerce.number().int().min(1).max(20480).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  });

  app.get("/lyrics/search/pronunciation", async (c) => {
    try {
      const q = LyricPronSearchSchema.parse(c.req.query());
      const repo = container.resolve("lyricsRepo");
      const results = await repo.searchLyricLines({
        pronunciation: q.p,
        pronunciationPosition: q.position,
        themes: q.themes ? q.themes.split(",").filter(Boolean) : undefined,
        keywords: q.keywords ? q.keywords.split(",").filter(Boolean) : undefined,
        lyricist: q.lyricist,
        artist: q.artist,
        id: q.id,
        sentiment: q.sentiment,
        year: q.year,
        limit: q.limit,
        offset: q.offset,
      });

      const payload = {
        query: q.p,
        count: results.length,
        items: results.map((item) => ({
          ...item,
          id: item.id.toString(),
          song: {
            ...item.song,
            id: item.song.id.toString(),
          },
        })),
        fromCache: false,
        processingTimeMs: 0,
      };
      const json = JSON.stringify(payload);
      c.header("Content-Type", "application/json; charset=utf-8");
      return c.body(json);
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
    limit: z.coerce.number().int().min(1).max(20480).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  });

  app.get("/lyrics/search/rhyme", async (c) => {
    try {
      const q = LyricRhymeSearchSchema.parse(c.req.query());
      const repo = container.resolve("lyricsRepo");
      const results = await repo.searchLyricLines({
        rhyme: q.r,
        rhymePosition: q.rhymePosition,
        themes: q.themes ? q.themes.split(",").filter(Boolean) : undefined,
        keywords: q.keywords ? q.keywords.split(",").filter(Boolean) : undefined,
        lyricist: q.lyricist,
        artist: q.artist,
        id: q.id,
        sentiment: q.sentiment,
        year: q.year,
        limit: q.limit,
        offset: q.offset,
      });

      const payload = {
        query: q.r,
        count: results.length,
        items: results.map((item) => ({
          ...item,
          id: item.id.toString(),
          song: {
            ...item.song,
            id: item.song.id.toString(),
          },
        })),
        fromCache: false,
        processingTimeMs: 0,
      };
      const json = JSON.stringify(payload);
      c.header("Content-Type", "application/json; charset=utf-8");
      return c.body(json);
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
