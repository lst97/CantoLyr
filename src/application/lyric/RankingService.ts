// RankingService (Application Layer)
// Selects top K (defaults to 3) sentences using MMR for diversity.

import { selectWithMMR } from "../../domain/lyric/ranking/mmr.ts";
import { GoogleGenAI } from "npm:@google/genai";

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
  sceneIntent?: {
    title: string;
    emotions: string[];
    microIntent: string;
    continuityNotes: string;
  };
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
  sceneIntent?: {
    title: string;
    emotions: string[];
    microIntent: string;
    continuityNotes: string;
  };
  previousLines?: string[];
  topParagraphCount?: number; // how many paragraphs to return (default 3)
}

export interface ParagraphRankingResult {
  lineIndex: number;
  top3: Array<
    {
      paragraph: string;
      lines: Array<{ text: string; patternId: string }>;
      score: number;
    }
  >;
  metrics: { totalParagraphs: number };
}

export class RankingService {
  private genAI: GoogleGenAI | null = null;
  private geminiApiKey?: string;
  private geminiRerankModel: string;

  constructor(geminiApiKey?: string) {
    this.geminiApiKey = geminiApiKey ?? Deno.env.get("GEMINI_API_KEY") ?? undefined;
    this.geminiRerankModel = Deno.env.get("GEMINI_RERANK_MODEL") ??
      (Deno.env.get("GEMINI_SCENE_MODEL") ??
        "gemini-2.0-flash-lite-preview-02-05");
    if (this.geminiApiKey) {
      try {
        this.genAI = new GoogleGenAI({ apiKey: this.geminiApiKey });
      } catch {
        this.genAI = null;
      }
    }
  }

  // --- Internal helpers for robust LLM IO ---
  // Some SDK variants expose different shapes; consolidate to a single text blob.
  // deno-lint-ignore no-explicit-any
  private async extractLLMText(res: any): Promise<string> {
    try {
      // Newer SDKs often expose response.text()
      // deno-lint-ignore no-explicit-any
      const maybeTextFn: any = res?.response?.text ?? res?.text;
      if (typeof maybeTextFn === "function") {
        return await maybeTextFn.call(res.response ?? res);
      }
    } catch {
      // ignore and fall back
    }
    try {
      const parts: any[] = res?.response?.candidates?.[0]?.content?.parts ??
        res?.candidates?.[0]?.content?.parts ??
        [];
      const raw = parts
        .map((p: any) => p?.text ?? p?.inline_data?.data ?? "")
        .filter(Boolean)
        .join("\n");
      if (raw) return raw;
    } catch {
      // ignore and fall back
    }
    return "";
  }

  private extractFirstJsonObject(text: string): string | null {
    if (!text) return null;
    // Try to find the first {...} block (handles extra prose or code fences)
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return match[0];
    return null;
  }

  // Parse scores array from a JSON (or text) response safely
  private parseScoresFromText(text: string): number[] | null {
    try {
      const jsonStr = this.extractFirstJsonObject(text) ?? text;
      const obj = JSON.parse(jsonStr);
      if (Array.isArray(obj?.scores)) {
        return obj.scores.map((x: unknown) => Number(x) || 0);
      }
    } catch {
      // Fallback: try to extract a bracketed array of numbers
      const bracket = text.match(/\[(?:[^\[\]]|\[[^\]]*\])*\]/);
      if (bracket) {
        try {
          const arr = JSON.parse(bracket[0]);
          if (Array.isArray(arr)) {
            return arr.map((x: unknown) => Number(x) || 0);
          }
        } catch {
          // ignore
        }
      }
      // As a last resort, collect numbers present in the text
      const nums = (text.match(/[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g) || [])
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n));
      if (nums.length) return nums;
    }
    return null;
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
          contents: [{ role: "user", parts: [{ text: content }] }],
          config: {
            temperature: 0.0,
            responseMimeType: "application/json",
            maxOutputTokens: 256,
          },
        });
        const raw = await this.extractLLMText(res);
        llmScores = this.parseScoresFromText(raw);
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
  async selectTopParagraphs(
    req: ParagraphRankingRequest,
  ): Promise<ParagraphRankingResult> {
    const groups = req.groups.filter((g) => (g.candidates?.length ?? 0) > 0);
    const topN = req.topParagraphCount ?? 3;
    if (groups.length < 1) {
      console.warn(
        `[RankingService] Paragraph ranking needs at least 1 group; got ${groups.length}`,
      );
      return {
        lineIndex: req.lineIndex,
        top3: [],
        metrics: { totalParagraphs: 0 },
      };
    }
    // Cap per-group to reasonable size (default 5) to avoid explosion
    const capped = groups.map((g) => ({
      patternId: g.patternId,
      candidates: g.candidates.slice(0, 5),
    }));

    // Compose LLM prompt: provide all candidate sentences for each line
    const allLines = capped.map((g, i) => ({
      patternId: g.patternId,
      candidates: g.candidates.map((c) => c.text),
      lineIndex: i,
    }));
    const sys = [
      "你是粵語歌詞段落生成器。",
      "用戶給定每行的候選句子，請根據語意、語法、主題契合、連貫性，從每行各選一句，組成最佳的段落。",
      `請輸出前${topN}個最佳段落，每個段落為一組句子（每行一句），不得重複同一句。`,
      "輸出 JSON 格式: { paragraphs: string[][] }，每個元素為一個段落，內含每行選中的句子，順序與輸入行一致。",
      req.sceneIntent ? `主題: ${JSON.stringify(req.sceneIntent)}` : "",
    ].filter(Boolean).join("\n");
    const payload = { lines: allLines };
    const content = `${sys}\n${JSON.stringify(payload)}`;
    let paragraphs: string[][] = [];
    let error: string | undefined;
    try {
      if (!this.genAI || !this.geminiApiKey) {
        throw new Error("LLM not available");
      }
      const res: any = await this.genAI.models.generateContent({
        model: this.geminiRerankModel,
        contents: [{ role: "user", parts: [{ text: content }] }],
        config: {
          temperature: 0.2,
          responseMimeType: "application/json",
          maxOutputTokens: 1024,
        },
      });
      const raw = await this.extractLLMText(res);
      const json = (() => {
        const m = raw.match(/\{[\s\S]*\}/);
        return m ? m[0] : raw;
      })();
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed?.paragraphs)) {
        paragraphs = parsed.paragraphs.filter((arr: unknown) =>
          Array.isArray(arr) && arr.length === groups.length
        );
      } else {
        error = "LLM did not return paragraphs array";
      }
    } catch (e) {
      error = `LLM paragraph selection failed: ${e instanceof Error ? e.message : String(e)}`;
      console.warn(`[RankingService] ${error}`);
    }
    // Fallback: if LLM fails, return empty or best-effort
    if (!paragraphs.length) {
      // fallback: pick first candidate per line, repeat for topN
      paragraphs = Array.from(
        { length: topN },
        () => capped.map((g) => g.candidates[0]?.text ?? ""),
      );
    }
    const topNParas = paragraphs.slice(0, topN).map((linesArr) => {
      const lines = linesArr.map((text, i) => ({
        text,
        patternId: capped[i].patternId,
      }));
      return {
        paragraph: lines.map((l) => l.text).join("\n"),
        lines,
        score: 0, // LLM does not return score; could add if needed
      };
    });
    return {
      lineIndex: req.lineIndex,
      top3: topNParas,
      metrics: { totalParagraphs: paragraphs.length },
    };
  }
}

export default RankingService;
