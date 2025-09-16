// RankingService (Application Layer)
// Selects top K (defaults to 3) sentences using MMR for diversity.

import { selectWithMMR } from "../../domain/lyric/ranking/mmr.ts";
import { GoogleGenAI } from "@google/genai";

export interface RankingConfig {
  topKSize: number;
  mmrLambda: number;
  similarityThreshold: number;
  // Optional weight for LLM scores vs heuristic when LLM is available
  llmWeight?: number; // 0..1, default 0.7
}

export interface SentenceCandidate {
  patternId: string;
  text: string;
  usedSurfaces: string[];
  toneComplianceScore: number;
  sceneAlignmentScore: number;
  continuityScore: number;
}

export interface RankingRequest {
  lineIndex: number;
  candidates: SentenceCandidate[];
  config: RankingConfig;
  // Optional context to enable LLM-based reranking
  sceneIntent?: { title: string; emotions: string[]; microIntent: string; continuityNotes: string };
  previousLines?: string[];
}

export interface RankedSentence {
  id: string;
  finalRank: number;
  mmrScore: number;
  relevance: number;
  diversityPenalty: number;
  text: string;
  patternId: string;
}

export interface RankingMetrics {
  filteredForNonCompliance: number;
  initialCount: number;
}
export interface RankingResult {
  lineIndex: number;
  top3: RankedSentence[];
  metrics: RankingMetrics;
  error?: string;
}

// Paragraph ranking types
export interface ParagraphGroup {
  patternId: string;
  candidates: SentenceCandidate[];
}

export interface ParagraphRankingRequest {
  lineIndex: number;
  groups: ParagraphGroup[]; // ordered groups (e.g., first 3 patterns), each with up to ~5 candidates
  config: RankingConfig;
  sceneIntent?: { title: string; emotions: string[]; microIntent: string; continuityNotes: string };
  previousLines?: string[];
}

export interface ParagraphRankingResult {
  lineIndex: number;
  top3: Array<
    { paragraph: string; lines: Array<{ text: string; patternId: string }>; score: number }
  >;
  metrics: { totalParagraphs: number };
}

export class RankingService {
  private genAI: GoogleGenAI | null = null;
  private geminiApiKey?: string;
  private geminiRerankModel: string;

  constructor() {
    this.geminiApiKey = Deno.env.get("GEMINI_API_KEY") ?? undefined;
    this.geminiRerankModel = Deno.env.get("GEMINI_RERANK_MODEL") ??
      (Deno.env.get("GEMINI_SCENE_MODEL") ?? "gemini-2.0-flash-lite-preview-02-05");
    if (this.geminiApiKey) {
      try {
        this.genAI = new GoogleGenAI({ apiKey: this.geminiApiKey });
      } catch {
        this.genAI = null;
      }
    }
  }

  async selectTop3(req: RankingRequest): Promise<RankingResult> {
    const initialCount = req.candidates.length;
    // simple compliance filter: require toneComplianceScore >= 0.5
    const filtered = req.candidates.filter((c) => c.toneComplianceScore >= 0.5);
    const filteredForNonCompliance = initialCount - filtered.length;

    // Compute base heuristic relevance
    const heuristic = (
      c: SentenceCandidate,
    ) => (c.sceneAlignmentScore * 0.6 + c.continuityScore * 0.4);

    // Try LLM-based scoring when available and context provided
    let llmScores: number[] | null = null;
    const canUseLLM = !!this.genAI && !!this.geminiApiKey && !!req.sceneIntent;
    if (canUseLLM && filtered.length > 0) {
      try {
        const payload = {
          intent: req.sceneIntent,
          continuity: { previousLines: req.previousLines ?? [] },
          sentences: filtered.map((s) => s.text),
        };
        const sys = [
          "你是粵語歌詞評分器。",
          "請根據主題契合、自然流暢、與前文連貫三方面，為每句打 0..1 的綜合分。",
          "輸出 JSON { scores: number[] }，與輸入句子順序一致。",
        ].join("\n");
        const content = `${sys}\n${JSON.stringify(payload)}`;
        // deno-lint-ignore no-explicit-any
        const res: any = await this.genAI!.models.generateContent({
          model: this.geminiRerankModel,
          contents: content,
          config: { temperature: 0.0, responseMimeType: "application/json", maxOutputTokens: 200 },
        });
        const parts: any[] = res?.candidates?.[0]?.content?.parts || [];
        const raw = parts.map((p: any) => p.text || p.inline_data?.data).filter(Boolean).join("\n");
        const s = raw.indexOf("{");
        const e = raw.lastIndexOf("}");
        const json = JSON.parse(raw.slice(s !== -1 ? s : 0, e !== -1 ? e + 1 : raw.length));
        llmScores = Array.isArray(json?.scores)
          ? json.scores.map((x: unknown) => Number(x) || 0)
          : null;
      } catch (e) {
        console.warn(
          `[RankingService] LLM rerank failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        llmScores = null;
      }
    }

    const w = Math.min(1, Math.max(0, req.config.llmWeight ?? 0.7));
    // Map to MMR input, combining LLM score (if any) with heuristic
    const patternIdMap = new Map<string, string>();
    const mmrInput = filtered.map((c, idx) => {
      const id = `cand_${idx}_${c.patternId}`;
      patternIdMap.set(id, c.patternId);
      const hRel = heuristic(c);
      const lRel = (llmScores && llmScores[idx] != null)
        ? Math.max(0, Math.min(1, llmScores[idx]!))
        : null;
      const relevance = lRel == null ? hRel : (w * lRel + (1 - w) * hRel);
      return {
        id,
        text: c.text,
        relevanceScore: relevance,
        diversityPenalty: 1 - c.toneComplianceScore,
      };
    });

    const selected = selectWithMMR(
      mmrInput,
      req.config.mmrLambda,
      Math.min(req.config.topKSize, 3),
    );

    // Build ranked sentences
    const ranked: RankedSentence[] = selected.map((s, i) => ({
      id: s.id,
      finalRank: i + 1,
      mmrScore: (s.relevanceScore ?? 0) - (s.diversityPenalty ?? 0),
      relevance: s.relevanceScore ?? 0,
      diversityPenalty: s.diversityPenalty ?? 0,
      text: s.text,
      patternId: patternIdMap.get(s.id) ?? "unknown",
    }));

    return {
      lineIndex: req.lineIndex,
      top3: ranked,
      metrics: { filteredForNonCompliance, initialCount },
    };
  }

  // Build all combinations picking one candidate from each group and score paragraphs
  async selectTop3Paragraphs(req: ParagraphRankingRequest): Promise<ParagraphRankingResult> {
    const groups = req.groups.filter((g) => (g.candidates?.length ?? 0) > 0);
    if (groups.length < 3) {
      console.warn(`[RankingService] Paragraph ranking needs 3 groups; got ${groups.length}`);
      return { lineIndex: req.lineIndex, top3: [], metrics: { totalParagraphs: 0 } };
    }
    // Limit per-group to reasonable size (default 5) to avoid explosion
    const capped = groups.map((g) => ({
      patternId: g.patternId,
      candidates: g.candidates.slice(0, 5),
    }));

    // Generate combinations
    type Para = { lines: Array<{ text: string; patternId: string }>; hScore: number };
    const paras: Para[] = [];
    const heuristic = (
      c: SentenceCandidate,
    ) => (c.sceneAlignmentScore * 0.6 + c.continuityScore * 0.4);
    for (const a of capped[0].candidates) {
      for (const b of capped[1].candidates) {
        for (const c of capped[2].candidates) {
          const lines = [a, b, c].map((x, i) => ({ text: x.text, patternId: capped[i].patternId }));
          const hScore = (heuristic(a) + heuristic(b) + heuristic(c)) / 3;
          paras.push({ lines, hScore });
        }
      }
    }
    console.log(`[RankingService] Paragraph candidates: ${paras.length}`);

    // Optional LLM scoring for paragraphs (may be large; cap to first N for cost). We blend or fall back to heuristic
    const canUseLLM = !!this.genAI && !!this.geminiApiKey && !!req.sceneIntent;
    const w = Math.min(1, Math.max(0, req.config.llmWeight ?? 0.7));
    let finalScored: Array<{ idx: number; score: number }>; // index into paras
    if (canUseLLM && paras.length > 0) {
      try {
        const MAX_RATE = 60; // cap to avoid too-large prompts; score first N by LLM
        const sample = paras.slice(0, MAX_RATE);
        const payload = {
          intent: req.sceneIntent,
          paragraphs: sample.map((p) => p.lines.map((l) => l.text).join("\n")),
        };
        const sys = [
          "你是粵語歌詞評分器。",
          "請對每段三行的歌詞段落，根據主題契合、語意連貫、語感自然三方面打 0..1 的綜合分。",
          "輸出 JSON { scores: number[] }，順序與輸入一致。",
        ].join("\n");
        const content = `${sys}\n${JSON.stringify(payload)}`;
        // deno-lint-ignore no-explicit-any
        const res: any = await this.genAI!.models.generateContent({
          model: this.geminiRerankModel,
          contents: content,
          config: { temperature: 0.0, responseMimeType: "application/json", maxOutputTokens: 200 },
        });
        const parts: any[] = res?.candidates?.[0]?.content?.parts || [];
        const raw = parts.map((p: any) => p.text || p.inline_data?.data).filter(Boolean).join("\n");
        const s = raw.indexOf("{");
        const e = raw.lastIndexOf("}");
        const json = JSON.parse(raw.slice(s !== -1 ? s : 0, e !== -1 ? e + 1 : raw.length));
        const scores: number[] = Array.isArray(json?.scores)
          ? json.scores.map((x: unknown) => Number(x) || 0)
          : [];
        console.log(
          `[RankingService] LLM paragraph scores received: ${scores.length}/${sample.length}`,
        );
        finalScored = paras.map((p, idx) => {
          const l = idx < scores.length ? Math.max(0, Math.min(1, scores[idx]!)) : null;
          const score = l == null ? p.hScore : (w * l + (1 - w) * p.hScore);
          return { idx, score };
        });
      } catch (e) {
        console.warn(
          `[RankingService] LLM paragraph scoring failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        finalScored = paras.map((p, idx) => ({ idx, score: p.hScore }));
      }
    } else {
      finalScored = paras.map((p, idx) => ({ idx, score: p.hScore }));
    }

    finalScored.sort((a, b) => b.score - a.score);
    const top3 = finalScored.slice(0, 3).map(({ idx, score }) => {
      const lines = paras[idx].lines;
      return {
        paragraph: lines.map((l) => l.text).join("\n"),
        lines,
        score,
      };
    });
    console.log(
      `[RankingService] Paragraph top3:\n${
        top3.map((t, i) => `#${i + 1} (${t.score.toFixed(3)})\n${t.paragraph}`).join("\n---\n")
      }\n`,
    );
    return { lineIndex: req.lineIndex, top3, metrics: { totalParagraphs: paras.length } };
  }
}

export default RankingService;
