// SessionService (Application Layer)
// Orchestrates full single-line generation pipeline and session state.

import SegmentationService from "./SegmentationService.ts";
import RetrievalService, { RetrievalConfig, SceneIntent } from "./RetrievalService.ts";
import GenerationService, { ContinuityContext, GenerationConfig } from "./GenerationService.ts";
import RankingService, { ParagraphGroup, RankingConfig } from "./RankingService.ts";
import { LyricErrorCode } from "../../shared/lyric-codes.ts";
import { PatternSlot } from "../../domain/lyric/entities.ts";

export interface LinePipelineConfig {
  retrieval: RetrievalConfig;
  generation: GenerationConfig;
  ranking: RankingConfig;
}

export interface LinePipelineResult {
  lineIndex: number;
  toneSequence: string;
  digitSet: string[];
  patterns: Array<{ id: string; patternString: string; groups: string[]; slots: PatternSlot[] }>;
  candidatePoolStats: {
    total: number;
    semanticCount: number;
    freqTopCount: number;
    freqRandomCount: number;
  };
  topSentences: Array<{ text: string; patternId: string; finalRank: number; mmrScore: number }>;
  // For convenience in downstream UI, also expose the 3 paragraph candidates directly
  topParagraphCandidates: string[];
  // Flattened all-line candidates (up to 15) for multi-line paragraph composition
  allLineCandidates: Array<{ text: string; patternId: string }>;
  warnings: string[];
  error?: string;
}

export interface SessionState {
  sessionId: string;
  seed: number;
  lines: LinePipelineResult[];
  // Optional: Top-N complete lyric outputs (multi-line paragraphs)
  topOutputs?: string[];
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
      patterns: seg.patterns,
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
          slots: ret.patternSlots?.[p.id] ?? p.slots ?? [],
        })),
        candidatePoolStats: {
          total: ret.total,
          semanticCount: ret.semanticCount,
          freqTopCount: ret.freqTopCount,
          freqRandomCount: ret.freqRandomCount,
        },
        topSentences: [],
        topParagraphCandidates: [],
        allLineCandidates: [],
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
    const patternsWithSlots = seg.patterns.map((p) => ({
      ...p,
      slots: ret.patternSlots?.[p.id] ?? p.slots ?? [],
    }));
    const gen = canUseAsync
      ? await (this.generation as any).generateAsync({
        lineIndex,
        patterns: patternsWithSlots,
        candidatePool: ret.candidates,
        sceneIntent,
        continuityContext: { previousLines: previous } as ContinuityContext,
        config: config.generation,
      })
      : this.generation.generate({
        lineIndex,
        patterns: patternsWithSlots,
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
    const groupEntries = Array.from(groupsMap.values());
    const paraGroups: ParagraphGroup[] = groupEntries.map((g) => ({
      patternId: g.patternId,
      candidates: g.list,
    }));
    const paraRank = await this.ranking.selectTopParagraphs({
      lineIndex,
      groups: paraGroups,
      config: config.ranking,
      sceneIntent,
      previousLines: previous,
      topParagraphCount: 3, // configurable if needed
    });
    // Debug: one-line summary (avoid verbose duplication)
    try {
      console.log(
        `[Session] line=${lineIndex} paragraphs=${paraRank.metrics.totalParagraphs}}`,
      );
    } catch { /* noop log */ }
    const paragraphCandidates = paraRank.top3.map((p) => p.paragraph);
    const allLineCandidates = groupEntries
      .flatMap((g) => g.list)
      .slice(0, 15)
      .map((s) => ({ text: s.text, patternId: s.patternId }));
    return {
      lineIndex,
      toneSequence,
      digitSet: seg.digitSet,
      patterns: patternsWithSlots.map((p) => ({
        id: p.id,
        patternString: p.patternString,
        groups: p.groups,
        slots: p.slots ?? [],
      })),
      candidatePoolStats: {
        total: ret.total,
        semanticCount: ret.semanticCount,
        freqTopCount: ret.freqTopCount,
        freqRandomCount: ret.freqRandomCount,
      },
      topSentences: [],
      topParagraphCandidates: paragraphCandidates,
      allLineCandidates,
      warnings: [...seg.warnings, ...ret.warnings],
      error: paraRank.top3.length === 0 ? LyricErrorCode.ERROR_GENERATION_FAILED : undefined,
    };
  }

  // Compose multi-line paragraphs: pass all per-line candidates to LLM to pick top N complete lyrics
  async composeParagraphs(
    lineResults: LinePipelineResult[],
    sceneIntent: SceneIntent,
    rankingConfig: RankingConfig,
    topN = 3,
  ): Promise<{ paragraphs: string[]; raw: { paragraph: string; lines: Array<{ text: string; patternId: string }> }[] }>
  {
    const groups: ParagraphGroup[] = lineResults.map((lr, idx) => ({
      patternId: `line_${idx}`,
      candidates: (lr.allLineCandidates || []).map((c) => ({
        patternId: c.patternId,
        text: c.text,
        usedSurfaces: [],
        toneComplianceScore: 1,
        sceneAlignmentScore: 0.8,
        continuityScore: 0.8,
      })),
    }));
    const rank = await this.ranking.selectTopParagraphs({
      lineIndex: 0,
      groups,
      config: rankingConfig,
      sceneIntent,
      previousLines: [],
      topParagraphCount: topN,
    });
    return {
      paragraphs: rank.top3.map((p) => p.paragraph),
      raw: rank.top3,
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
