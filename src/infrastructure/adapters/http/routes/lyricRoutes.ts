import type { Hono } from "hono";
import { ZodError } from "zod";
import {
  LyricFilterOptionsResponseSchema,
  LyricGenerateRequestSchema,
  LyricGenerationResponseSchema,
  LyricSearchQuery,
  LyricSearchQuerySchema,
  LyricSearchResponseSchema,
} from "../schemas.ts";
import type { Container } from "../../../container/Container.ts";
import SegmentationService from "../../../../application/lyric/SegmentationService.ts";
import RetrievalService, {
  LineThemePlan,
  SceneIntent,
} from "../../../../application/lyric/RetrievalService.ts";
import GenerationService from "../../../../application/lyric/GenerationService.ts";
import RankingService from "../../../../application/lyric/RankingService.ts";
import SessionService, { SessionState } from "../../../../application/lyric/SessionService.ts";
import { buildDefaultLinePipelineConfig } from "../../../../application/lyric/default-config.ts";
import { toExport } from "../../../serialization/session-io.ts";
import type {
  LyricFilterOptionsDTO,
  LyricLineDTO,
  LyricSongDTO,
  LyricsRepo,
  LyricTokenDTO,
  MatchedSyllableDTO,
} from "../../../../application/ports/LyricsRepo.ts";

// Type guards and helpers to avoid `any` while checking optional fields
function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null;
}

function isLyricTokenDTOArray(val: unknown): val is LyricTokenDTO[] {
  return Array.isArray(val) &&
    val.every((t) => isObject(t) && typeof t.position === "number" && typeof t.text === "string");
}

function isMatchedSyllableDTOArray(val: unknown): val is MatchedSyllableDTO[] {
  return Array.isArray(val) &&
    val.every((syl) =>
      isObject(syl) && typeof syl.position === "number" && typeof syl.jyutping === "string"
    );
}

function mapMatchedSyllable(syllable: MatchedSyllableDTO) {
  return {
    position: syllable.position,
    jyutping: syllable.jyutping,
    jyutpingNormalized: syllable.jyutpingNormalized ?? null,
    consonant: syllable.consonant ?? null,
    rhyme: syllable.rhyme ?? null,
    toneRaw: syllable.toneRaw ?? null,
    toneDigit: syllable.toneDigit ?? null,
    char: syllable.char ?? null,
  };
}

function buildSceneIntent(
  prompt: string,
  scene?: Partial<SceneIntent>,
): SceneIntent {
  const rawEmotions = scene?.emotions ?? [];
  return {
    title: scene?.title ?? prompt,
    emotions: rawEmotions
      .map((emotion) => emotion?.trim())
      .filter((emotion): emotion is string => Boolean(emotion)),
    microIntent: scene?.microIntent ?? prompt,
    continuityNotes: scene?.continuityNotes ?? "",
  };
}

function deriveLineSeed(
  baseSeed: number,
  toneSequence: string,
  index: number,
): number {
  const key = `${baseSeed}:${toneSequence}:${index}`;
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash & 0x7fffffff) + 1;
}

export function registerLyricRoutes(app: Hono, container: Container) {
  const segmentation = new SegmentationService();
  const retrieval = new RetrievalService();
  const generation = new GenerationService();
  const ranking = new RankingService();
  const sessionService = new SessionService(
    segmentation,
    retrieval,
    generation,
    ranking,
  );
  const logger = container.resolve("logger");
  const cache = container.resolve("cache");
  const FILTER_CACHE_KEY = "lyrics:filter-options";
  const FILTER_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

  app.get("/lyrics/options", async (c) => {
    try {
      const cachedOptions = await cache.get<LyricFilterOptionsDTO>(FILTER_CACHE_KEY);
      const responseBase = {
        fetchedAt: new Date().toISOString(),
      };

      if (cachedOptions) {
        const response = LyricFilterOptionsResponseSchema.parse({
          ...responseBase,
          fromCache: true,
          options: cachedOptions,
        });
        return c.json(response);
      }

      const repo = container.resolve("lyricsRepo") as LyricsRepo;
      const options = await repo.getLyricFilterOptions();
      await cache.set(FILTER_CACHE_KEY, options, FILTER_CACHE_TTL_SECONDS);

      const response = LyricFilterOptionsResponseSchema.parse({
        ...responseBase,
        fromCache: false,
        options,
      });
      return c.json(response);
    } catch (error) {
      logger.error("lyrics_filter_options_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json({
        error: {
          code: "LYRIC_FILTER_OPTIONS_FAILED",
          message: error instanceof Error ? error.message : "Failed to load lyric filter options",
        },
      }, 500);
    }
  });

  app.get("/lyrics/search", async (c) => {
    const startedAt = Date.now();
    try {
      const query: LyricSearchQuery = LyricSearchQuerySchema.parse(c.req.query());
      const repo = container.resolve("lyricsRepo") as LyricsRepo;

      const toneValueRaw = typeof query.tone === "string" ? query.tone.trim() : "";
      const toneDigits = toneValueRaw.replace(/\D+/gu, "");
      const tone = toneDigits.length > 0
        ? toneDigits
        : toneValueRaw.length > 0
        ? toneValueRaw
        : undefined;
      const themes = query.themes
        ? query.themes
          .split(",")
          .map((theme: string) => theme.trim())
          .filter((theme: string) => theme.length > 0)
        : undefined;
      const keywords = query.keywords
        ? query.keywords
          .split(",")
          .map((keyword: string) => keyword.trim())
          .filter((keyword: string) => keyword.length > 0)
        : undefined;

      const rawRhymeCandidate = typeof query.rhyme === "string" && query.rhyme.length > 0
        ? query.rhyme
        : typeof query.rhythm === "string" && query.rhythm.length > 0
        ? query.rhythm
        : typeof query.rythem === "string" && query.rythem.length > 0
        ? query.rythem
        : undefined;

      const rhymeSequence = query.rhymeSequence;

      const normalizedMode = typeof query.mode === "string"
        ? query.mode.trim().toLowerCase()
        : undefined;
      const shouldRunSequenceFromMode = normalizedMode === "sequence";
      const shouldRunInclusiveFromMode = normalizedMode === "inclusive";
      const forceSequence = shouldRunSequenceFromMode;
      const forceInclusive = shouldRunInclusiveFromMode;

      const rhymeParts = typeof rawRhymeCandidate === "string"
        ? rawRhymeCandidate
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
        : [];
      const rhyme = rhymeParts.length > 1
        ? (forceSequence ? rhymeParts : Array.from(new Set(rhymeParts)))
        : rhymeParts[0] ?? undefined;
      const rhymePosition = query.rhymePosition ?? query.rhythmPosition ?? query.rythemPosition;

      const [items, totalCount] = await Promise.all([
        repo.searchLyricLines({
          pronunciation: tone,
          pronunciationPosition: query.tonePosition,
          rhyme,
          rhymePosition,
          rhymeSequence: forceSequence ? true : forceInclusive ? false : rhymeSequence,
          themes,
          keywords,
          lyricist: query.lyricist,
          artist: query.artist,
          id: query.lyricId,
          sentiment: query.sentiment,
          year: query.year,
          limit: query.pageSize,
          offset: query.offset,
        }),
        repo.countLyricLines({
          pronunciation: tone,
          pronunciationPosition: query.tonePosition,
          rhyme,
          rhymePosition,
          rhymeSequence: forceSequence ? true : forceInclusive ? false : rhymeSequence,
          themes,
          keywords,
          lyricist: query.lyricist,
          artist: query.artist,
          id: query.lyricId,
          sentiment: query.sentiment,
          year: query.year,
        }),
      ]);

      const queryTerm = tone ?? (Array.isArray(rhyme) ? rhyme.join(",") : rhyme ?? "");
      const response = LyricSearchResponseSchema.parse({
        query: queryTerm,
        count: totalCount,
        items: items.map((item: LyricLineDTO) => ({
          ...item,
          id: item.id.toString(),
          song: (() => {
            const s: LyricSongDTO = item.song;
            const base = {
              id: s.id.toString(),
              docId: s.docId,
              title: s.title,
              year: s.year,
            };
            const artists = Array.isArray(s.artists) && s.artists.length > 0
              ? { artists: s.artists }
              : {};
            const lyricists = Array.isArray(s.lyricists) && s.lyricists.length > 0
              ? { lyricists: s.lyricists }
              : {};
            return { ...base, ...artists, ...lyricists };
          })(),
          tokens: ((): LyricTokenDTO[] | undefined => {
            const maybeTokens = item.tokens;
            if (isLyricTokenDTOArray(maybeTokens)) {
              return maybeTokens.map((token) => ({
                position: token.position,
                text: token.text,
                pos: token.pos ?? null,
                syllables: Array.isArray(token.syllables) && token.syllables.length > 0
                  ? token.syllables.map(mapMatchedSyllable)
                  : undefined,
              }));
            }
            return undefined;
          })(),
          matchedSyllables: ((): MatchedSyllableDTO[] | undefined => {
            const maybeSyllables = item.matchedSyllables;
            if (isMatchedSyllableDTOArray(maybeSyllables)) {
              return maybeSyllables.map((syllable) => ({
                ...mapMatchedSyllable(syllable),
              }));
            }
            return undefined;
          })(),
          syntaxNotes: item.syntaxNotes ?? null,
          rhymeMatches: Array.isArray(item.rhymeMatches) && item.rhymeMatches.length > 0
            ? item.rhymeMatches.map((match) => ({
              value: match.value,
              position: match.position,
              length: match.length,
              characters: match.characters ?? undefined,
            }))
            : undefined,
          normalization: {
            isValid: Boolean(item.normalization?.isValid),
            originalText: item.normalization?.originalText ?? null,
            notes: item.normalization?.notes ?? null,
          },
        })),
        fromCache: false,
        processingTimeMs: Date.now() - startedAt,
      });
      return c.json(response);
    } catch (error) {
      if (error instanceof ZodError) {
        return c.json({
          error: { code: "INVALID_REQUEST", message: error.issues },
        }, 400);
      }
      logger.error("lyrics_search_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json({
        error: {
          code: "LYRICS_SEARCH_FAILED",
          message: error instanceof Error ? error.message : "Failed to search lyrics",
        },
      }, 500);
    }
  });

  app.post("/lyrics/generate", async (c) => {
    const startedAt = Date.now();
    try {
      const body = await c.req.json();
      const parsed = LyricGenerateRequestSchema.parse(body);
      const toneInputs = Array.isArray(parsed.tones) ? parsed.tones : parsed.tones.split(",");
      const toneSequences = toneInputs
        .map((seq: string) => seq.trim())
        .filter((seq: string) => seq.length > 0);
      if (toneSequences.length === 0) {
        return c.json({
          error: {
            code: "INVALID_REQUEST",
            message: "tones must include at least one sequence",
          },
        }, 400);
      }

      const seed = parsed.seed ?? Math.floor(Math.random() * 1_000_000);
      const config = buildDefaultLinePipelineConfig();
      const sceneIntent = buildSceneIntent(parsed.prompt);

      let themePlan: LineThemePlan[] = [];
      try {
        themePlan = await retrieval.generateStoryThemes(
          toneSequences.length,
          sceneIntent,
          toneSequences,
        );
      } catch (themeError) {
        logger.warning("generate_theme_plan_fallback", {
          error: themeError instanceof Error ? themeError.message : String(themeError),
        });
        themePlan = Array.from({ length: toneSequences.length }, (_, idx) => ({
          primary: `${sceneIntent.title}·${idx + 1}`,
          subThemes: [],
        }));
      }

      const state: SessionState = {
        sessionId: crypto.randomUUID(),
        seed,
        lines: [],
      };
      const previousLines: string[] = [];

      for (let i = 0; i < toneSequences.length; i++) {
        const toneSeq = toneSequences[i];
        const perLineSeed = deriveLineSeed(seed, toneSeq, i);
        const overrides = themePlan?.[i];
        try {
          const lineResult = await sessionService.runLine(
            i,
            toneSeq,
            sceneIntent,
            config,
            previousLines,
            perLineSeed,
            overrides?.primary,
            overrides?.subThemes,
          );
          state.lines.push(lineResult);
          if (lineResult.topSentences?.[0]?.text) {
            previousLines.push(lineResult.topSentences[0].text);
          }
        } catch (lineError) {
          const reason = lineError instanceof Error ? lineError.message : String(lineError);
          logger.error("generate_line_failed", {
            lineIndex: i,
            toneSequence: toneSeq,
            reason,
          });
          state.lines.push({
            lineIndex: i,
            toneSequence: toneSeq,
            digitSet: [],
            patterns: [],
            candidatePoolStats: {
              total: 0,
              semanticCount: 0,
              freqTopCount: 0,
              freqRandomCount: 0,
            },
            topSentences: [],
            topParagraphCandidates: [],
            allLineCandidates: [],
            warnings: [],
            error: reason,
          });
        }
      }

      const topN = parsed.top ?? 3;
      if (topN > 0) {
        try {
          const composed = await sessionService.composeParagraphs(
            state.lines,
            sceneIntent,
            config.ranking,
            topN,
          );
          state.topOutputs = composed.paragraphs;
        } catch (composeError) {
          logger.warning("generate_compose_failed", {
            error: composeError instanceof Error ? composeError.message : String(composeError),
          });
        }
      }

      const feature = parsed.feature || "lyrics-generation";
      const payload = toExport(state, feature);
      const processingTimeMs = Date.now() - startedAt;
      const response = LyricGenerationResponseSchema.parse({
        ...payload,
        meta: { ...payload.meta, processingTimeMs },
      });
      return c.json(response);
    } catch (error) {
      if (error instanceof ZodError) {
        return c.json({
          error: { code: "INVALID_REQUEST", message: error.issues },
        }, 400);
      }
      logger.error("lyrics_generation_failed", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return c.json({
        error: {
          code: "LYRIC_GENERATION_FAILED",
          message: error instanceof Error ? error.message : "Failed to generate lyrics",
        },
      }, 500);
    }
  });
}

export default registerLyricRoutes;
