import type { Hono } from "hono/";
import type { Container } from "../../../container/Container.ts";
import { ZodError } from "zod";
import { SearchPronunciationQuerySchema, SearchRhymeQuerySchema } from "../schemas.ts";
import type { EntryType } from "../../../../shared/types/common.ts";

export function registerSearchRoutes(app: Hono, container: Container) {
  // GET /search/pronunciation
  app.get("/search/pronunciation", async (c) => {
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

  // GET /search/rhyme
  app.get("/search/rhyme", async (c) => {
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
}
