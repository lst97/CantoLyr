import type { Hono } from "hono";
import { ZodError } from "zod";
import {
  GenerateSessionRequestSchema,
  LyricGenerationResponseSchema,
  LyricGenerateRequestSchema,
} from "../schemas.ts";
import type { Container } from "../../../container/Container.ts";
import SegmentationService from "../../../../application/lyric/SegmentationService.ts";
import RetrievalService, {
  LineThemePlan,
  SceneIntent,
} from "../../../../application/lyric/RetrievalService.ts";
import GenerationService from "../../../../application/lyric/GenerationService.ts";
import RankingService from "../../../../application/lyric/RankingService.ts";
import SessionService, {
  LinePipelineConfig,
  SessionState,
} from "../../../../application/lyric/SessionService.ts";
import { buildDefaultLinePipelineConfig } from "../../../../application/lyric/default-config.ts";
import { toExport } from "../../../serialization/session-io.ts";
import { LyricErrorCode } from "../../../../shared/lyric-codes.ts";

interface ConfigOverride {
  retrieval?: Partial<LinePipelineConfig["retrieval"]>;
  generation?: Partial<LinePipelineConfig["generation"]>;
  ranking?: Partial<LinePipelineConfig["ranking"]>;
}

function mergeConfig(
  override?: ConfigOverride,
): LinePipelineConfig {
  const base = buildDefaultLinePipelineConfig();
  if (!override) return base;
  return {
    retrieval: { ...base.retrieval, ...override.retrieval },
    generation: { ...base.generation, ...override.generation },
    ranking: { ...base.ranking, ...override.ranking },
  };
}

function buildSceneIntent(
  prompt: string,
  scene?: Partial<SceneIntent>,
): SceneIntent {
  const rawEmotions = Array.isArray(scene?.emotions) ? scene.emotions ?? [] : [];
  return {
    title: scene?.title?.trim() || prompt,
    emotions: rawEmotions
      .map((emotion) => emotion?.trim())
      .filter((emotion): emotion is string => Boolean(emotion)),
    microIntent: scene?.microIntent?.trim() || prompt,
    continuityNotes: scene?.continuityNotes?.trim() || "",
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

  app.post("/lyrics/generate", async (c) => {
    const startedAt = Date.now();
    try {
      const body = await c.req.json();
      const parsed = LyricGenerateRequestSchema.parse(body);
      const toneInputs = Array.isArray(parsed.tones)
        ? parsed.tones
        : parsed.tones.split(",");
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
      const json = JSON.stringify(response);
      c.header("Content-Type", "application/json; charset=utf-8");
      return c.body(json);
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

  app.post("/lyrics/session", async (c) => {
    const startedAt = Date.now();
    try {
      const parsed = GenerateSessionRequestSchema.parse(await c.req.json());
      const seed = parsed.seed ?? Math.floor(Math.random() * 1_000_000);
      const config = mergeConfig(parsed.config);
      const toneSequences = parsed.toneSequences.map((seq: string) => seq.trim());
      const sceneIntent = buildSceneIntent(parsed.prompt, parsed.scene);

      let themePlan: LineThemePlan[] = [];
      try {
        themePlan = await retrieval.generateStoryThemes(
          toneSequences.length,
          sceneIntent,
          toneSequences,
        );
      } catch (themeError) {
        logger.warning("session_theme_plan_fallback", {
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
          logger.error("session_line_failed", {
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
            error: reason === LyricErrorCode.ERROR_INVALID_INPUT
              ? LyricErrorCode.ERROR_INVALID_INPUT
              : LyricErrorCode.ERROR_GENERATION_FAILED,
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
          logger.warning("session_compose_failed", {
            error: composeError instanceof Error ? composeError.message : String(composeError),
          });
        }
      }

      const feature = parsed.feature || "lyrics-generation";
      const payload = toExport(state, feature);
      const processingTimeMs = Date.now() - startedAt;
      return c.json({
        ...payload,
        meta: { ...payload.meta, processingTimeMs },
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return c.json({
          error: { code: "INVALID_REQUEST", message: error.issues },
        }, 400);
      }
      logger.error("session_generation_failed", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return c.json({
        error: {
          code: "SESSION_GENERATION_FAILED",
          message: error instanceof Error ? error.message : "Failed to generate lyric session",
        },
      }, 500);
    }
  });
}

export default registerLyricRoutes;
