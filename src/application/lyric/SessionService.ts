// SessionService (Application Layer)
// Orchestrates full single-line generation pipeline and session state.

import SegmentationService from "./SegmentationService.ts";
import RetrievalService, { RetrievalConfig, SceneIntent } from "./RetrievalService.ts";
import GenerationService, { ContinuityContext, GenerationConfig } from "./GenerationService.ts";
import RankingService, { ParagraphGroup, RankingConfig } from "./RankingService.ts";
import { LyricErrorCode } from "../../shared/lyric-codes.ts";

export interface LinePipelineConfig {
  retrieval: RetrievalConfig;
  generation: GenerationConfig;
  ranking: RankingConfig;
}

export interface LinePipelineResult {
  lineIndex: number;
  toneSequence: string;
  digitSet: string[];
  patterns: Array<{ id: string; patternString: string; groups: string[] }>;
  candidatePoolStats: {
    total: number;
    semanticCount: number;
    freqTopCount: number;
    freqRandomCount: number;
  };
  topSentences: Array<{ text: string; patternId: string; finalRank: number; mmrScore: number }>;
  // For convenience in downstream UI, also expose the 3 paragraph candidates directly
  topParagraphCandidates: string[];
  warnings: string[];
  error?: string;
}

export interface SessionState {
  sessionId: string;
  seed: number;
  lines: LinePipelineResult[];
}

export class SessionService {
  constructor(
    private readonly segmentation: SegmentationService,
    private readonly retrieval: RetrievalService,
    private readonly generation: GenerationService,
    private readonly ranking: RankingService,
  ) {}

  async runLine(
    lineIndex: number,
    toneSequence: string,
    sceneIntent: SceneIntent,
    config: LinePipelineConfig,
    previous: string[],
    seed?: number,
    overrideTheme?: string,
    overrideSubThemes?: string[],
  ): Promise<LinePipelineResult> {
    // derive a per-line seed when not provided to add variability across lines
    const derived = (Math.abs(Math.imul(2654435761, lineIndex + 1)) % 0x7fffffff) || 1;
    const effectiveSeed = seed ?? derived;
    const seg = this.segmentation.segment(toneSequence, effectiveSeed);
    const ret = await this.retrieval.buildPool({
      lineIndex,
      toneSequence,
      digitSet: seg.digitSet,
      sceneIntent,
      config: config.retrieval,
      overrideTheme,
      overrideSubThemes,
    });
    if (ret.error === LyricErrorCode.ERROR_DIGIT_INSUFFICIENT) {
      return {
        lineIndex,
        toneSequence,
        digitSet: seg.digitSet,
        patterns: seg.patterns.map((p) => ({
          id: p.id,
          patternString: p.patternString,
          groups: p.groups,
        })),
        candidatePoolStats: {
          total: ret.total,
          semanticCount: ret.semanticCount,
          freqTopCount: ret.freqTopCount,
          freqRandomCount: ret.freqRandomCount,
        },
        topSentences: [],
        topParagraphCandidates: [],
        warnings: [...seg.warnings, ...ret.warnings],
        error: ret.error,
      };
    }
    // Prefer async LLM-enabled path when available
    const canUseAsync = (this as any).generation?.["generateAsync"] instanceof Function;
    try {
      console.log(
        `[Session] runLine line=${lineIndex} using=${canUseAsync ? "async" : "sync"} generation`,
      );
    } catch { /* noop log */ }
    const gen = canUseAsync
      ? await (this.generation as any).generateAsync({
        lineIndex,
        patterns: seg.patterns,
        candidatePool: ret.candidates,
        sceneIntent,
        continuityContext: { previousLines: previous } as ContinuityContext,
        config: config.generation,
      })
      : this.generation.generate({
        lineIndex,
        patterns: seg.patterns,
        candidatePool: ret.candidates,
        sceneIntent,
        continuityContext: { previousLines: previous } as ContinuityContext,
        config: config.generation,
      });
    // Group candidates into 3 groups (first three patterns), each up to 5 sentences
    const firstThree = seg.patterns.slice(0, 3);
    const groupsMap = new Map<string, { patternId: string; list: typeof gen.sentences }>();
    for (const p of firstThree) groupsMap.set(p.id, { patternId: p.id, list: [] as any });
    // Only accept candidates whose text length equals the sum of digit lengths in the pattern (strict 10/7 etc.)
    const expectedLens = new Map<string, number>(
      firstThree.map((p) => [p.id, p.groups.reduce((acc, g) => acc + g.length, 0)]),
    );
    for (const s of gen.sentences) {
      if (!groupsMap.has(s.patternId)) continue;
      const exp = expectedLens.get(s.patternId) ?? 0;
      if (s.text.length !== exp) continue;
      const g = groupsMap.get(s.patternId)!;
      if ((g.list as any[]).length < 5) (g.list as any[]).push(s);
    }
    const paraGroups: ParagraphGroup[] = Array.from(groupsMap.values()).map((g) => ({
      patternId: g.patternId,
      candidates: g.list,
    }));
    const paraRank = await this.ranking.selectTop3Paragraphs({
      lineIndex,
      groups: paraGroups,
      config: config.ranking,
      sceneIntent,
      previousLines: previous,
    });
    // Debug: one-line summary (avoid verbose duplication)
    try {
      console.log(
        `[Session] line=${lineIndex} paragraphs=${paraRank.metrics.totalParagraphs} top3=${paraRank.top3.length}`,
      );
    } catch { /* noop log */ }
    const paragraphCandidates = paraRank.top3.map((p) => p.paragraph);
    return {
      lineIndex,
      toneSequence,
      digitSet: seg.digitSet,
      patterns: seg.patterns.map((p) => ({
        id: p.id,
        patternString: p.patternString,
        groups: p.groups,
      })),
      candidatePoolStats: {
        total: ret.total,
        semanticCount: ret.semanticCount,
        freqTopCount: ret.freqTopCount,
        freqRandomCount: ret.freqRandomCount,
      },
      topSentences: [],
      topParagraphCandidates: paragraphCandidates,
      warnings: [...seg.warnings, ...ret.warnings],
      error: paraRank.top3.length === 0 ? LyricErrorCode.ERROR_GENERATION_FAILED : undefined,
    };
  }

  async regenerateLine(
    existing: LinePipelineResult,
    sceneIntent: SceneIntent,
    config: LinePipelineConfig,
    previous: string[],
    newSeed?: number,
  ): Promise<LinePipelineResult> {
    // re-run with provided seed to change segmentation deterministically
    return await this.runLine(
      existing.lineIndex,
      existing.toneSequence,
      sceneIntent,
      config,
      previous,
      newSeed,
    );
  }
}

export default SessionService;
