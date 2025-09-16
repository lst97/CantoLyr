// GenerationService (Application Layer)
// Builds sentence candidates per segmentation pattern from a lexical candidate pool.
// Placeholder deterministic logic until LLM + tone mapping adapters are wired.

import { LyricErrorCode, LyricWarningCode } from "../../shared/lyric-codes.ts";
import { SegmentationPattern } from "../../domain/lyric/entities.ts";
import { validate as toneValidate } from "../../domain/lyric/tone-compliance.ts";
import { GoogleGenAI } from "@google/genai";

export interface GenerationConfig {
  variantsPerPattern: number;
  maxRetriesPerSentence: number;
}

export interface ContinuityContext {
  previousLines: string[];
}

export interface SceneIntent {
  title: string;
  emotions: string[];
  microIntent: string;
  continuityNotes: string;
}

export interface LexicalCandidate {
  surface: string;
  toneDigit: string;
  provenance: string;
}

export interface GenerationRequest {
  lineIndex: number;
  patterns: SegmentationPattern[];
  candidatePool: LexicalCandidate[];
  sceneIntent: SceneIntent;
  continuityContext: ContinuityContext;
  config: GenerationConfig;
}

export interface SentenceCandidate {
  patternId: string;
  text: string;
  usedSurfaces: string[];
  toneComplianceScore: number;
  sceneAlignmentScore: number;
  continuityScore: number;
}

export interface GenerationMetrics {
  avgSceneAlignment: number;
}

export interface GenerationResult {
  lineIndex: number;
  attempted: number;
  generated: number;
  sentences: SentenceCandidate[];
  invalidFiltered: number;
  metrics: GenerationMetrics;
  error?: string;
  // Top 3 recommended outputs after reranking; treated as paragraph candidates for MVP (single-line per paragraph for now)
  topParagraphCandidates?: string[];
  // Debug info for observability
  diagnostics?: {
    usedModel?: string;
    llmAvailable: boolean;
    notes?: string[];
  };
}

export class GenerationService {
  private genAI: GoogleGenAI | null = null;
  private geminiApiKey?: string;
  private geminiSentenceModel: string;

  constructor() {
    this.geminiApiKey = Deno.env.get("GEMINI_API_KEY") ?? undefined;
    // Reuse the same lightweight model as RetrievalService unless overridden
    this.geminiSentenceModel = Deno.env.get("GEMINI_SENTENCE_MODEL") ??
      (Deno.env.get("GEMINI_SCENE_MODEL") ?? "gemini-2.5-flash");
  }

  private ensureGenAI() {
    if (!this.geminiApiKey) return false;
    if (!this.genAI) {
      this.genAI = new GoogleGenAI({ apiKey: this.geminiApiKey });
    }
    return true;
  }

  async generateAsync(req: GenerationRequest): Promise<GenerationResult> {
    // Async path with LLM selection, refinement, and reranking
    try {
      console.log(
        `[GenerationService] generateAsync:start line=${req.lineIndex} patterns=${req.patterns.length}`,
      );
    } catch { /* noop log */ }
    const llmOk = this.ensureGenAI();
    const diagnostics: string[] = [];
    if (!llmOk || !this.genAI) {
      diagnostics.push("No LLM configured; using synchronous fallback");
      const res = this.generate(req);
      try {
        console.log(
          `[GenerationService] generateAsync:fallback-to-sync line=${req.lineIndex} generated=${res.generated}`,
        );
      } catch { /* noop log */ }
      return res;
    }

    if (req.patterns.length === 0) {
      return {
        lineIndex: req.lineIndex,
        attempted: 0,
        generated: 0,
        sentences: [],
        invalidFiltered: 0,
        metrics: { avgSceneAlignment: 0 },
        error: LyricErrorCode.ERROR_INVALID_INPUT,
        diagnostics: {
          usedModel: this.geminiSentenceModel,
          llmAvailable: true,
          notes: diagnostics,
        },
      };
    }

    const selectedPatterns = req.patterns.slice(0, 3);
    const variantsPerPattern = Math.max(1, Math.min(5, req.config.variantsPerPattern || 5));

    // Build candidate maps by digit and capture global frequency items (no specific digit)
    const byDigitSemantic: Record<string, string[]> = {};
    const byDigitRefine: Record<string, string[]> = {};
    const globalRefine: string[] = [];
    for (const c of req.candidatePool) {
      const prov = (c.provenance || "").toLowerCase();
      if (c.toneDigit) {
        // Enforce that surface length matches the digit group length (e.g., '39' => 2 characters)
        const expectLen = c.toneDigit.length;
        if (c.surface.length !== expectLen) continue;
        if (prov.startsWith("semantic")) (byDigitSemantic[c.toneDigit] ||= []).push(c.surface);
        else if (prov.startsWith("freq")) (byDigitRefine[c.toneDigit] ||= []).push(c.surface);
      } else if (prov.startsWith("freq-global")) {
        globalRefine.push(c.surface);
      }
    }
    const cap = (arr?: string[], n = 36) => Array.from(new Set(arr || [])).slice(0, n);
    for (const k of Object.keys(byDigitSemantic)) byDigitSemantic[k] = cap(byDigitSemantic[k], 40);
    for (const k of Object.keys(byDigitRefine)) byDigitRefine[k] = cap(byDigitRefine[k], 24);
    const cappedGlobal = cap(globalRefine, 24);
    if (cappedGlobal.length) {
      // Merge a small slice of global into every digit used by selected patterns
      const digitsInUse = new Set<string>();
      for (const p of selectedPatterns) for (const g of p.groups) digitsInUse.add(g);
      for (const d of Array.from(digitsInUse)) {
        const arr = byDigitRefine[d] ||= [];
        // merge up to 8 global items not already included
        for (const s of cappedGlobal) {
          if (arr.length >= 32) break;
          if (!arr.includes(s)) arr.push(s);
        }
        byDigitRefine[d] = cap(arr, 32);
      }
    }

    const sentences: SentenceCandidate[] = [];
    let attempted = 0;
    let invalidFiltered = 0;

    // 1) Generate 5 per pattern using ONLY semantic options
    for (const pat of selectedPatterns) {
      const optionsPerGroup = pat.groups.map((g) => cap(byDigitSemantic[g], 40));
      if (optionsPerGroup.some((opts) => opts.length === 0)) {
        invalidFiltered++;
        diagnostics.push(`Pattern ${pat.id}: missing semantic options for some digit groups`);
        continue;
      }
      const picks = await this.pickWithLLMAsync(
        optionsPerGroup,
        variantsPerPattern,
        req.sceneIntent,
        req.continuityContext,
      );
      for (const tokens of picks) {
        if (tokens.length !== pat.groups.length) {
          invalidFiltered++;
          continue;
        }
        attempted++;
        const text = tokens.join("");
        const tone = toneValidate(text, pat.groups);
        const sceneAlignmentScore = Math.min(1, (req.sceneIntent.emotions.length * 0.08) + 0.6);
        const continuityScore = req.continuityContext.previousLines.length ? 0.72 : 0.76;
        sentences.push({
          patternId: pat.id,
          text,
          usedSurfaces: [...tokens],
          toneComplianceScore: tone.score,
          sceneAlignmentScore,
          continuityScore,
        });
      }
    }

    // 2) Refinement using frequency/global options per digit
    if (sentences.length) {
      try {
        const refined = await this.refineWithLLMAsync(
          sentences,
          selectedPatterns,
          byDigitRefine,
          req.sceneIntent,
        );
        for (let i = 0; i < sentences.length; i++) {
          const r = refined[i];
          if (!r) continue;
          const pat = selectedPatterns.find((p) => p.id === sentences[i].patternId);
          if (!pat) continue;
          // Length check: each token must match the expected group digit length
          let lengthsOk = true;
          for (let gi = 0; gi < pat.groups.length; gi++) {
            const expected = pat.groups[gi]?.length ?? 0;
            const tok = r[gi] ?? "";
            if (tok.length !== expected) {
              lengthsOk = false;
              break;
            }
          }
          if (!lengthsOk) continue;
          const tone2 = toneValidate(r.join(""), pat.groups);
          if ((tone2.score ?? 0) >= (sentences[i].toneComplianceScore ?? 0) - 0.05) {
            sentences[i].text = r.join("");
            sentences[i].usedSurfaces = [...r];
            sentences[i].toneComplianceScore = tone2.score;
          }
        }
      } catch (e) {
        diagnostics.push(`Refinement failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Reranking is handled in RankingService; we stop at sentence candidates here.

    const generated = sentences.length;
    const avgSceneAlignment = generated
      ? sentences.reduce((a, s) => a + s.sceneAlignmentScore, 0) / generated
      : 0;
    const result: GenerationResult = {
      lineIndex: req.lineIndex,
      attempted,
      generated,
      sentences,
      invalidFiltered,
      metrics: { avgSceneAlignment },
      ...(generated === 0 ? { error: LyricWarningCode.WARN_GENERATION_RETRY } : {}),
      diagnostics: { usedModel: this.geminiSentenceModel, llmAvailable: true, notes: diagnostics },
    };
    try {
      console.log(`[GenerationService] ${result.sentences.map((s) => s.text).join(", ")}`);
    } catch { /* noop log */ }
    return result;
  }

  generate(req: GenerationRequest): GenerationResult {
    try {
      console.log(
        `[GenerationService] generate:start line=${req.lineIndex} patterns=${req.patterns.length}`,
      );
    } catch { /* noop log */ }
    if (req.patterns.length === 0) {
      return {
        lineIndex: req.lineIndex,
        attempted: 0,
        generated: 0,
        sentences: [],
        invalidFiltered: 0,
        metrics: { avgSceneAlignment: 0 },
        error: LyricErrorCode.ERROR_INVALID_INPUT,
      };
    }

    const sentences: SentenceCandidate[] = [];
    const diagnostics: string[] = [];
    let attempted = 0;
    let invalidFiltered = 0;

    // Limit to 3 patterns for "segment x3"
    const selectedPatterns = req.patterns.slice(0, 3);
    const variantsPerPattern = Math.max(1, Math.min(5, req.config.variantsPerPattern || 5));

    // Build candidate maps by digit
    const byDigitSemantic: Record<string, string[]> = {};
    const byDigitRefine: Record<string, string[]> = {};
    for (const c of req.candidatePool) {
      if (!c.toneDigit) continue;
      const prov = (c.provenance || "").toLowerCase();
      // Enforce surface length equals digit group length
      if ((c.surface?.length ?? 0) !== c.toneDigit.length) continue;
      if (prov.startsWith("semantic")) {
        (byDigitSemantic[c.toneDigit] ||= []).push(c.surface);
      } else if (prov.startsWith("freq")) {
        (byDigitRefine[c.toneDigit] ||= []).push(c.surface);
      }
    }
    // Deduplicate per digit and cap list sizes to keep prompts compact
    const dedupCap = (arr?: string[], cap = 24) => Array.from(new Set(arr || [])).slice(0, cap);
    for (const k of Object.keys(byDigitSemantic)) {
      byDigitSemantic[k] = dedupCap(byDigitSemantic[k], 30);
    }
    for (const k of Object.keys(byDigitRefine)) byDigitRefine[k] = dedupCap(byDigitRefine[k], 20);

    const llmOk = this.ensureGenAI();
    if (!llmOk) {
      diagnostics.push("GEMINI_API_KEY not set; running deterministic fallback generation");
    }

    // 1) For each pattern (segment), produce 5 sentences using ONLY semantic candidates per digit
    for (const pat of selectedPatterns) {
      const needed = pat.groups.length;
      const optionsPerGroup: string[][] = pat.groups.map((g) => dedupCap(byDigitSemantic[g], 30));

      // If any group has zero options, mark invalid and continue
      if (optionsPerGroup.some((opts) => opts.length === 0)) {
        invalidFiltered++;
        diagnostics.push(`Pattern ${pat.id}: missing semantic options for some digit groups`);
        continue;
      }

      let pickedSentences: string[][] = [];
      if (llmOk && this.genAI) {
        try {
          pickedSentences = this.pickWithLLM(
            optionsPerGroup,
            variantsPerPattern,
            req.sceneIntent,
            req.continuityContext,
          );
        } catch {
          diagnostics.push(`LLM pick failed for pattern ${pat.id}; falling back to greedy`);
          pickedSentences = this.pickGreedy(optionsPerGroup, variantsPerPattern);
        }
      } else {
        pickedSentences = this.pickGreedy(optionsPerGroup, variantsPerPattern);
      }

      // Materialize candidates, score, and collect
      for (const chosenTokens of pickedSentences) {
        if (chosenTokens.length !== needed) {
          invalidFiltered++;
          continue;
        }
        attempted++;
        const text = chosenTokens.join("");
        const toneResult = toneValidate(text, pat.groups);
        const sceneAlignmentScore = Math.min(1, (req.sceneIntent.emotions.length * 0.08) + 0.6);
        const continuityScore = req.continuityContext.previousLines.length ? 0.72 : 0.76;
        sentences.push({
          patternId: pat.id,
          text,
          usedSurfaces: [...chosenTokens],
          toneComplianceScore: toneResult.score,
          sceneAlignmentScore,
          continuityScore,
        });
      }
    }

    // 2) Refinement pass using frequency/global candidates per digit (minimal edits)
    if (sentences.length && (llmOk && this.genAI)) {
      try {
        const refined = this.refineWithLLM(
          sentences,
          selectedPatterns,
          byDigitRefine,
          req.sceneIntent,
        );
        // Replace texts where refinement came back valid
        for (let i = 0; i < sentences.length; i++) {
          const r = refined[i];
          if (!r) continue;
          // Validate tone and token lengths against its pattern
          const pat = selectedPatterns.find((p) => p.id === sentences[i].patternId);
          if (!pat) continue;
          let lengthsOk = true;
          for (let gi = 0; gi < pat.groups.length; gi++) {
            const expected = pat.groups[gi]?.length ?? 0;
            const tok = r[gi] ?? "";
            if (tok.length !== expected) {
              lengthsOk = false;
              break;
            }
          }
          if (!lengthsOk) continue;
          const toneRes2 = toneValidate(r.join(""), pat.groups);
          // Accept refinement if tone score is not worse than original by large margin
          if ((toneRes2.score ?? 0) >= (sentences[i].toneComplianceScore ?? 0) - 0.05) {
            sentences[i].text = r.join("");
            sentences[i].usedSurfaces = [...r];
            sentences[i].toneComplianceScore = toneRes2.score;
          }
        }
      } catch {
        diagnostics.push("Refinement LLM step failed; keeping original semantic picks");
      }
    }

    // Reranking moved to RankingService

    const generated = sentences.length;
    const avgSceneAlignment = generated
      ? sentences.reduce((a, s) => a + s.sceneAlignmentScore, 0) / generated
      : 0;

    const result: GenerationResult = {
      lineIndex: req.lineIndex,
      attempted,
      generated,
      sentences,
      invalidFiltered,
      metrics: { avgSceneAlignment },
      ...(generated === 0 ? { error: LyricWarningCode.WARN_GENERATION_RETRY } : {}),
      diagnostics: {
        usedModel: llmOk ? this.geminiSentenceModel : undefined,
        llmAvailable: llmOk,
        notes: diagnostics,
      },
    };
    try {
      console.log(
        `[GenerationService] generate:done line=${req.lineIndex} attempted=${attempted} generated=${generated}`,
      );
    } catch { /* noop log */ }
    return result;
  }

  // --- Internal helpers: generation, refinement, reranking ---

  private pickGreedy(optionsPerGroup: string[][], count: number): string[][] {
    const out: string[][] = [];
    const usedSurfaces = new Set<string>();
    for (let k = 0; k < count; k++) {
      const chosen: string[] = [];
      for (const opts of optionsPerGroup) {
        // Prefer first unused, else first
        const pick = opts.find((s) => !usedSurfaces.has(s)) ?? opts[0];
        chosen.push(pick);
        usedSurfaces.add(pick);
      }
      out.push(chosen);
    }
    return out;
  }

  private pickWithLLM(
    optionsPerGroup: string[][],
    count: number,
    _intent: SceneIntent,
    _continuity: ContinuityContext,
  ): string[][] {
    // For MVP, we keep this synchronous and fall back to a deterministic greedy picker.
    return this.pickGreedy(optionsPerGroup, count);
  }

  private async pickWithLLMAsync(
    optionsPerGroup: string[][],
    count: number,
    _intent: SceneIntent,
    _continuity: ContinuityContext,
  ): Promise<string[][]> {
    if (!this.genAI) return this.pickGreedy(optionsPerGroup, count);
    const payload = { optionsPerGroup, count, intent: _intent, continuity: _continuity };
    const sys = [
      "你是粵語歌詞的句子生成器。",
      "任務：從每一組提供的候選詞（按聲調數字分組），每組選擇恰好一個詞，串連成一句完整且自然的粵語句子。",
      "限制：只能使用提供的候選詞；不得創造新詞；可以加入必要的標點（例如，、。）；避免口語過度、保持文雅自然。",
      "主題需呼應提供的場景意圖（title/microIntent/emotions），並盡量與前文連貫。",
      "輸出：JSON，格式為 { choices: string[][] }，其中每個元素為一條句子所選詞序列（與分組同長度）。",
    ].join("\n");
    const content = `${sys}\n${JSON.stringify(payload)}`;
    try {
      const res = await this.genAI.models.generateContent({
        model: this.geminiSentenceModel,
        contents: content,
        config: {
          temperature: 0.3,
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: "object",
            properties: {
              choices: { type: "array", items: { type: "array", items: { type: "string" } } },
            },
            required: ["choices"],
          },
          maxOutputTokens: 300,
        },
      });
      const parts: any[] = (res as any)?.candidates?.[0]?.content?.parts || [];
      const raw = parts.map((p: any) => p.text || p.inline_data?.data).filter(Boolean).join("\n");
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      const json = JSON.parse(raw.slice(s !== -1 ? s : 0, e !== -1 ? e + 1 : raw.length));
      const choices: string[][] = Array.isArray(json?.choices) ? json.choices : [];
      const valid = choices
        .filter((arr) => Array.isArray(arr) && arr.length === optionsPerGroup.length)
        .map((arr) =>
          arr.map((tok, i) => optionsPerGroup[i].includes(tok) ? tok : optionsPerGroup[i][0])
        );
      if (valid.length >= count) return valid.slice(0, count);
      // pad with greedy selections
      const greedy = this.pickGreedy(optionsPerGroup, count - valid.length);
      return [...valid, ...greedy];
    } catch {
      return this.pickGreedy(optionsPerGroup, count);
    }
  }

  private refineWithLLM(
    sentences: SentenceCandidate[],
    patterns: SegmentationPattern[],
    refineByDigit: Record<string, string[]>,
    _intent: SceneIntent,
  ): (string[] | null)[] {
    if (!this.genAI) return sentences.map((_s) => null);
    // Placeholder: keep original tokens (no-op) due to sync API
    const items = sentences.map((s) => {
      const pat = patterns.find((p) => p.id === s.patternId)!;
      const groups = pat.groups;
      const refineOptions = groups.map((g) =>
        Array.from(new Set(refineByDigit[g] || [])).slice(0, 12)
      );
      return { text: s.text, tokens: s.usedSurfaces, groups, refineOptions };
    });
    void items; // avoid unused warnings
    return sentences.map(() => null);
  }

  private async refineWithLLMAsync(
    sentences: SentenceCandidate[],
    patterns: SegmentationPattern[],
    refineByDigit: Record<string, string[]>,
    intent: SceneIntent,
  ): Promise<(string[] | null)[]> {
    if (!this.genAI) return sentences.map(() => null);
    const items = sentences.map((s) => {
      const pat = patterns.find((p) => p.id === s.patternId)!;
      const groups = pat.groups;
      const refineOptions = groups.map((g) =>
        Array.from(new Set(refineByDigit[g] || [])).slice(0, 16)
      );
      return { text: s.text, tokens: s.usedSurfaces, groups, refineOptions };
    });
    const sys = [
      "你是粵語歌詞潤飾助手。",
      "任務：在保持每一組聲調分組位置對應的前提下，對句子做最少量替換，只能從對應分組提供的備選詞中挑選替換。",
      "只在語義更貼近主題、或語法更自然時才替換；否則保持原詞。多數情況下不超過 1 處替換。",
      "輸出：JSON [{ tokens: string[] }]，每條與輸入對應，長度需與分組一致。",
    ].join("\n");
    const payload = { intent, items };
    const content = `${sys}\n${JSON.stringify(payload)}`;
    try {
      const res = await this.genAI.models.generateContent({
        model: this.geminiSentenceModel,
        contents: content,
        config: {
          temperature: 0.2,
          responseMimeType: "application/json",
          maxOutputTokens: 400,
        },
      });
      const parts: any[] = (res as any)?.candidates?.[0]?.content?.parts || [];
      const raw = parts.map((p: any) => p.text || p.inline_data?.data).filter(Boolean).join("\n");
      const s = raw.indexOf("[");
      const e = raw.lastIndexOf("]");
      const arr = JSON.parse(raw.slice(s !== -1 ? s : 0, e !== -1 ? e + 1 : raw.length));
      if (!Array.isArray(arr)) return sentences.map(() => null);
      return arr.map((x) => Array.isArray(x?.tokens) ? x.tokens.map((t: any) => String(t)) : null);
    } catch {
      return sentences.map(() => null);
    }
  }

  // Reranking helpers removed; handled in RankingService now.
}

export default GenerationService;
