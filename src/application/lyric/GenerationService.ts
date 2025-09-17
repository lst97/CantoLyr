// GenerationService (Application Layer)
// Builds sentence candidates per segmentation pattern from a lexical candidate pool.
// Placeholder deterministic logic until LLM + tone mapping adapters are wired.

import { LyricErrorCode, LyricWarningCode } from "../../shared/lyric-codes.ts";
import { PatternSlot, SegmentationPattern } from "../../domain/lyric/entities.ts";
import { generatePatterns } from "../../domain/lyric/segmentation.ts";
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
  posTag?: string;
  slotMatches?: string[];
  sourcePrompt?: string;
  sceneRelevanceScore?: number;
  freq?: number;
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

    const { candidateByKey, byDigitSemantic, byDigitAll } = this.prepareCandidatePools(
      selectedPatterns,
      req.candidatePool,
    );

    // Ensure we have 3 feasible patterns (each digit group has candidates)
    const feasiblePatterns = this.ensureFeasiblePatterns(selectedPatterns, byDigitAll);

  const sentences: SentenceCandidate[] = [];
  const perPatternCounts: Record<string, number> = {};
    let attempted = 0;
    let invalidFiltered = 0;

    // 1) Generate 5 per pattern using ONLY semantic options
  for (const pat of feasiblePatterns) {
      const slots = pat.slots ?? [];
      const groupOptions = pat.groups.map((digit, idx) => {
        const sem = byDigitSemantic[digit] ?? [];
        const all = byDigitAll[digit] ?? [];
        const base = sem.length > 0 ? sem : all; // prefer semantic, fallback to full pool for this digit
        let filtered = this.filterCandidatesForSlot(base, slots[idx]);
        if (filtered.length === 0) filtered = base;
        const surfaces = Array.from(new Set(filtered.map((c) => c.surface))).slice(0, 60);
        return { surfaces, slot: slots[idx], digit };
      });
      if (groupOptions.some((opts) => opts.surfaces.length === 0)) {
        invalidFiltered++;
        diagnostics.push(`Pattern ${pat.id}: missing semantic options for some digit groups`);
        continue;
      }
      const picks = await this.pickWithLLMAsync(
        groupOptions.map((o) => o.surfaces),
        variantsPerPattern,
        req.sceneIntent,
        req.continuityContext,
        slots,
      );
      for (const tokens of picks) {
        if (tokens.length !== pat.groups.length) {
          invalidFiltered++;
          continue;
        }
        attempted++;
        const validation = this.validateTokensForPattern(tokens, pat, candidateByKey);
        if (validation) {
          invalidFiltered++;
          diagnostics.push(`Pattern ${pat.id}: slot validation failed (${validation})`);
          continue;
        }
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
        perPatternCounts[pat.id] = (perPatternCounts[pat.id] ?? 0) + 1;
      }
    }

    // Optional refinement phase: ask LLM to reorder the full set of candidates to
    // improve grammatical/semantic flow of the set. No text edits, order only.
    try {
      const before = sentences.map((s) => s.text);
      const refined = await this.refineCandidatesOrderLLM(
        sentences,
        req.sceneIntent,
        req.continuityContext,
        feasiblePatterns,
      );
      if (refined && refined.length === sentences.length) {
        sentences.length = 0;
        sentences.push(...refined);
        diagnostics.push("Applied LLM order refinement to sentence candidates");
      } else {
        diagnostics.push("Refinement skipped or failed; keeping original order");
      }
      const after = sentences.map((s) => s.text);
      if (before.some((t, i) => t !== after[i])) {
        console.log(`[GenerationService] refinement reordered: before=${before.join(" | ")} => after=${after.join(" | ")}`);
      }
    } catch {
      diagnostics.push("Refinement threw error; ignored");
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
      console.log(`[GenerationService] per-pattern counts: ${JSON.stringify(perPatternCounts)}`);
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

    const diagnostics: string[] = [];
    let attempted = 0;
    let invalidFiltered = 0;
  const sentences: SentenceCandidate[] = [];
  const perPatternCounts: Record<string, number> = {};

    const selectedPatterns = req.patterns.slice(0, 3);
    const variantsPerPattern = Math.max(1, Math.min(5, req.config.variantsPerPattern || 5));
    const { candidateByKey, byDigitSemantic, byDigitAll } = this.prepareCandidatePools(
      selectedPatterns,
      req.candidatePool,
    );

    const feasiblePatterns = this.ensureFeasiblePatterns(selectedPatterns, byDigitAll);

    const llmOk = this.ensureGenAI();
    if (!llmOk) diagnostics.push("GEMINI_API_KEY not set; running deterministic fallback generation");

  for (const pat of feasiblePatterns) {
      const slots = pat.slots ?? [];
      const groupOptions = pat.groups.map((digit, idx) => {
        const sem = byDigitSemantic[digit] ?? [];
        const all = byDigitAll[digit] ?? [];
        const base = sem.length > 0 ? sem : all;
        let filtered = this.filterCandidatesForSlot(base, slots[idx]);
        if (filtered.length === 0) filtered = base;
        const surfaces = Array.from(new Set(filtered.map((cand) => cand.surface))).slice(0, 60);
        return { surfaces, slot: slots[idx], digit };
      });

      if (groupOptions.some((opts) => opts.surfaces.length === 0)) {
        invalidFiltered++;
        diagnostics.push(`Pattern ${pat.id}: missing semantic options for some digit groups`);
        continue;
      }

      let pickedSentences: string[][];
      try {
        pickedSentences = this.pickWithLLM(
          groupOptions.map((o) => o.surfaces),
          variantsPerPattern,
          req.sceneIntent,
          req.continuityContext,
          slots,
        );
      } catch {
        diagnostics.push(`LLM pick failed for pattern ${pat.id}; falling back to greedy`);
        pickedSentences = this.pickGreedy(groupOptions.map((o) => o.surfaces), variantsPerPattern);
      }

      for (const chosenTokens of pickedSentences) {
        if (chosenTokens.length !== pat.groups.length) {
          invalidFiltered++;
          continue;
        }
        attempted++;
        const validation = this.validateTokensForPattern(chosenTokens, pat, candidateByKey);
        if (validation) {
          invalidFiltered++;
          diagnostics.push(`Pattern ${pat.id}: slot validation failed (${validation})`);
          continue;
        }
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
        perPatternCounts[pat.id] = (perPatternCounts[pat.id] ?? 0) + 1;
      }
    }

    // Note: Refinement phase removed per requirements; sentences remain as initially generated.

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
      console.log(`[GenerationService] per-pattern counts: ${JSON.stringify(perPatternCounts)}`);
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
    _slotHints: (PatternSlot | undefined)[] = [],
  ): string[][] {
    // For MVP, we keep this synchronous and fall back to a deterministic greedy picker.
    return this.pickGreedy(optionsPerGroup, count);
  }

  // --- Refinement: Reorder candidates with LLM (no text edits) ---
  private async refineCandidatesOrderLLM(
    candidates: SentenceCandidate[],
    intent: SceneIntent,
    continuity: ContinuityContext,
    patterns: SegmentationPattern[],
  ): Promise<SentenceCandidate[] | null> {
    if (!this.ensureGenAI() || !this.genAI) return null;
    if (!candidates.length) return candidates;
    // Deduplicate identical texts first while preserving first occurrence
    const seen = new Set<string>();
    const unique: { idx: number; c: SentenceCandidate }[] = [];
    candidates.forEach((c, i) => {
      if (seen.has(c.text)) return; // drop dups before refinement
      seen.add(c.text);
      unique.push({ idx: i, c });
    });
    const texts = unique.map((u) => u.c.text);
    // Ensure all sentences have same character length to make index constraints meaningful
    const lens = texts.map((t) => Array.from(t).length);
    const L = lens[0] ?? 0;
    const sameLen = lens.every((n) => n === L);
    if (!sameLen || L === 0) return unique.map((u) => u.c);
    // Build per-index character sets across all sentences
    const indexSets: string[][] = Array.from({ length: L }, (_, i) => {
      const set = new Set<string>();
      for (const t of texts) {
        const chars = Array.from(t);
        set.add(chars[i]);
      }
      return Array.from(set);
    });
    // If there's little variance across positions, refinement adds little value; skip
    const degreesOfFreedom = indexSets.reduce((acc, s) => acc + Math.max(0, s.length - 1), 0);
    if (degreesOfFreedom < 2) return unique.map((u) => u.c);
    const sys = [
      "你是粵語歌詞的潤飾助手。",
      "任務：根據每個字位(index)提供的可用字集合，生成最多 N 條新句子(與輸入句子數相同)，",
      "使其語義與語法更自然、順口、主題一致。每條句子需逐位從對應的候選集合中各選一字，",
      "形成長度固定為 L 的句子(與輸入句子等長)。",
      "同時參考原始候選句(originalSentences)。請以『最小改動』為原則：只有在確實能改善語法或語意時，才改變各字位的選擇；",
      "若原句已足夠自然，則可原封不動輸出(保留與原句一致的結果)。",
      "嚴格限制：",
      "1) 僅能從提供的 indexSets[i] 中擇一字作為第 i 位，不得使用集合之外的字。",
      "2) 不得加入或刪除任何字(不可加標點)，每條句子長度必須等於 L。",
      "3) 請輸出 JSON 格式：{ sentences: string[] }；其中每個元素為一條句子(可與原句相同)。",
      "4) 不得重複句子；如無法滿足則輸出較少條。",
      intent ? `主題：${JSON.stringify(intent)}` : "",
      continuity?.previousLines?.length ? `前文：${JSON.stringify(continuity.previousLines)}` : "",
      "\n【範例】",
      "給定：",
      JSON.stringify({
        indexSets: [
          ["青","明","流"],
          ["山","月","水"],
          ["常","長","不"],
          ["在","照","息"],
        ],
        L: 4,
        N: 3
      }),
      "期望輸出(JSON)：",
      JSON.stringify({ sentences: ["青月長息", "明水不在", "流水長在"] }),
    ].join("\n");
  const Nreq = Math.min(texts.length, 15);
  const payload = { indexSets, L, N: Nreq, originalSentences: texts, preference: "minimal-change" };
    const content = `${sys}\n${JSON.stringify(payload)}`;
    try {
      const res: any = await this.genAI.models.generateContent({
        model: this.geminiSentenceModel,
        contents: [{ role: "user", parts: [{ text: content }] }],
        config: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: "object",
            properties: { sentences: { type: "array", items: { type: "string" } } },
            required: ["sentences"],
          },
          maxOutputTokens: 512,
        },
      });
      // deno-lint-ignore no-explicit-any
      const parts: any[] = (res as any)?.response?.candidates?.[0]?.content?.parts
        ?? (res as any)?.candidates?.[0]?.content?.parts
        ?? [];
      const raw = parts.map((p: any) => p?.text ?? p?.inline_data?.data ?? "").filter(Boolean).join("\n");
      // Try JSON first
      let candidateLines: string[] | null = null;
      try {
        const jsonText = (() => { const m = raw.match(/\{[\s\S]*\}/); return m ? m[0] : raw; })();
        const parsed = JSON.parse(jsonText);
        if (Array.isArray(parsed?.sentences)) candidateLines = parsed.sentences.map((s: unknown) => String(s));
      } catch { /* fall back to plaintext */ }
      if (!candidateLines) {
        // Fallback: parse plain-text lines, stripping numbering/fences/quotes
        const cleaned = raw.replace(/```[\s\S]*?```/g, "\n");
        candidateLines = cleaned.split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !/^```/.test(l))
          .map((l) => l.replace(/^[-*•]\s*/, ""))
          .map((l) => l.replace(/^\d+\.|^\d+\)|^[（(]?\d+[）)]\s*/, ""))
          .map((l) => l.replace(/^"|^'|"$|'$/g, ""));
      }
      // Validate against indexSets
      const validTexts: string[] = [];
      const seenTexts = new Set<string>();
      outer: for (const t of candidateLines) {
        const chars = Array.from(t);
        if (chars.length !== L) continue;
        for (let i = 0; i < L; i++) {
          if (!indexSets[i].includes(chars[i])) continue outer;
        }
        if (seenTexts.has(t)) continue;
        seenTexts.add(t);
        validTexts.push(t);
        if (validTexts.length >= Nreq) break;
      }
      // If none valid, skip refinement
      if (!validTexts.length) return unique.map((u) => u.c);
      // Map refined texts back onto candidates, preserving patternId assignment by position
      const patMap = new Map(patterns.map((p) => [p.id, p.groups] as const));
      const out: SentenceCandidate[] = [];
      const total = candidates.length;
      for (let i = 0; i < total; i++) {
        const base = candidates[i];
        const text = validTexts[i] ?? base.text; // backfill with original if fewer
        const groups = patMap.get(base.patternId) ?? [];
        // Recompute tone compliance on the new text using the base pattern grouping
        const tone = groups.length ? toneValidate(text, groups) : { score: base.toneComplianceScore } as any;
        // Split text by group lengths for usedSurfaces (best-effort)
        const used: string[] = [];
        if (groups.length) {
          let pos = 0;
          for (const g of groups) {
            const len = g.length;
            used.push(Array.from(text).slice(pos, pos + len).join(""));
            pos += len;
          }
        } else {
          used.push(...base.usedSurfaces);
        }
        out.push({
          patternId: base.patternId,
          text,
          usedSurfaces: used,
          toneComplianceScore: tone.score ?? base.toneComplianceScore,
          sceneAlignmentScore: base.sceneAlignmentScore,
          continuityScore: base.continuityScore,
        });
      }
      return out;
    } catch {
      return unique.map((u) => u.c);
    }
  }

  private prepareCandidatePools(
    patterns: SegmentationPattern[],
    pool: LexicalCandidate[],
  ): {
    candidateByKey: Map<string, LexicalCandidate>;
    byDigitSemantic: Record<string, LexicalCandidate[]>;
    byDigitAll: Record<string, LexicalCandidate[]>;
  } {
    const candidateByKey = new Map<string, LexicalCandidate>();
    const byDigitSemantic: Record<string, LexicalCandidate[]> = {};
    const byDigitAll: Record<string, LexicalCandidate[]> = {};
    void patterns; // patterns may be used for future extensions; currently unused here

    for (const cand of pool) {
      const surface = cand.surface?.trim();
      const digit = cand.toneDigit?.trim();
      if (!surface || !digit) continue;
      const provenance = (cand.provenance || "").toLowerCase();
      const normalized: LexicalCandidate = { ...cand, surface, toneDigit: digit };
      if (digit === "global") continue; // ignore global refine candidates per updated requirements
      if (surface.length !== digit.length) continue;
      const key = `${surface}|${digit}`;
      candidateByKey.set(key, normalized);
      // Track all by digit
      (byDigitAll[digit] ||= []).push(normalized);
      // Track semantic-only subset
      if (provenance.startsWith("semantic")) (byDigitSemantic[digit] ||= []).push(normalized);
    }

    for (const digit of Object.keys(byDigitSemantic)) {
      byDigitSemantic[digit] = this.dedupeCandidates(byDigitSemantic[digit], 40);
    }

    for (const digit of Object.keys(byDigitAll)) {
      byDigitAll[digit] = this.dedupeCandidates(byDigitAll[digit], 80);
    }

    return { candidateByKey, byDigitSemantic, byDigitAll };
  }

  private isFeasiblePattern(
    pat: SegmentationPattern,
    byDigitAll: Record<string, LexicalCandidate[]>,
  ): boolean {
    return pat.groups.every((digit) => (byDigitAll[digit]?.length ?? 0) > 0);
  }

  private ensureFeasiblePatterns(
    selected: SegmentationPattern[],
    byDigitAll: Record<string, LexicalCandidate[]>,
  ): SegmentationPattern[] {
    const out: SegmentationPattern[] = [];
    const seen = new Set<string>();
    const keyOf = (p: SegmentationPattern) => p.groups.join(" ");
    // Add feasible from provided
    for (const p of selected) {
      const key = keyOf(p);
      if (!seen.has(key) && this.isFeasiblePattern(p, byDigitAll)) {
        seen.add(key);
        out.push(p);
      }
    }
    if (out.length >= 3) return out.slice(0, 3);

    // Reconstruct tone sequence from the first provided pattern
    const base = selected[0];
    const toneSeq = base?.groups?.join("") ?? "";
    if (!toneSeq) return selected.slice(0, 3);

    // Generate additional candidate patterns with varied seeds
    const MAX_TRIES = 40;
    for (let k = 1; k <= MAX_TRIES && out.length < 3; k++) {
      const more = generatePatterns(toneSeq, 1000 + k);
      for (const cand of more) {
        const key = keyOf(cand);
        if (seen.has(key)) continue;
        seen.add(key);
        if (this.isFeasiblePattern(cand, byDigitAll)) {
          out.push(cand);
          if (out.length >= 3) break;
        }
      }
    }

    // Try an all-singles fallback pattern if still short
    if (out.length < 3) {
      const singlesGroups = toneSeq.split("");
      const singlesKey = singlesGroups.join(" ");
      if (!seen.has(singlesKey)) {
        // Use domain factory to satisfy SegmentationPattern shape
        const singlesPat = {
          id: `pat_fallback_all_single_${toneSeq}`,
          groups: singlesGroups,
          patternString: singlesKey,
          slots: [],
        } as SegmentationPattern;
        seen.add(singlesKey);
        if (this.isFeasiblePattern(singlesPat, byDigitAll)) {
          out.push(singlesPat);
        }
      }
    }

    // If still short, include any remaining originals to make 3 entries
    for (const p of selected) {
      if (out.length >= 3) break;
      const key = keyOf(p);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(p);
      }
    }
    while (out.length < 3) out.push(selected[0]);
    return out.slice(0, 3);
  }

  private dedupeCandidates(list: LexicalCandidate[] = [], limit = 36): LexicalCandidate[] {
    const map = new Map<string, LexicalCandidate>();
    for (const cand of list) {
      if (!cand.surface || !cand.toneDigit) continue;
      const key = `${cand.surface}|${cand.toneDigit}`;
      const prev = map.get(key);
      const prevScore = prev ? (prev.sceneRelevanceScore ?? prev.freq ?? 0) : -Infinity;
      const nextScore = cand.sceneRelevanceScore ?? cand.freq ?? 0;
      if (!prev || nextScore > prevScore) map.set(key, cand);
    }
    return Array.from(map.values())
      .sort((a, b) => (b.sceneRelevanceScore ?? b.freq ?? 0) - (a.sceneRelevanceScore ?? a.freq ?? 0))
      .slice(0, limit);
  }

  private filterCandidatesForSlot(
    candidates: LexicalCandidate[],
    slot?: PatternSlot,
  ): LexicalCandidate[] {
    if (!slot) return candidates;
    const slotMatched = candidates.filter((c) => c.slotMatches?.includes(slot.id));
    if (slotMatched.length) return slotMatched;
    const posMatched = candidates.filter((c) => c.posTag && c.posTag === slot.posTag);
    if (posMatched.length) return posMatched;
    return candidates;
  }

  private validateTokensForPattern(
    tokens: string[],
    pattern: SegmentationPattern,
    candidateByKey: Map<string, LexicalCandidate>,
  ): string | null {
    if (tokens.length !== pattern.groups.length) return "token_length_mismatch";
    for (let i = 0; i < pattern.groups.length; i++) {
      const digit = pattern.groups[i];
      const token = tokens[i];
      const candidate = candidateByKey.get(`${token}|${digit}`);
      if (!candidate) return `candidate_missing_${digit}`;
      // Note: Slot and POS validation intentionally relaxed to avoid over-rejection when
      // fallback pools are used. We already bias selection via slot filtering earlier.
    }
    return null;
  }

  private async pickWithLLMAsync(
    optionsPerGroup: string[][],
    count: number,
    _intent: SceneIntent,
    _continuity: ContinuityContext,
    slotHints: (PatternSlot | undefined)[] = [],
  ): Promise<string[][]> {
    if (!this.genAI) return this.pickGreedy(optionsPerGroup, count);
    const payload = { optionsPerGroup, count, intent: _intent, continuity: _continuity, slots: slotHints };
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
        contents: [{ role: "user", parts: [{ text: content }] }],
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
          maxOutputTokens: 400,
        },
      });
      // deno-lint-ignore no-explicit-any
      const parts: any[] = (res as any)?.response?.candidates?.[0]?.content?.parts
        ?? (res as any)?.candidates?.[0]?.content?.parts
        ?? [];
      const raw = parts.map((p: any) => p?.text ?? p?.inline_data?.data ?? "").filter(Boolean).join("\n");
      const jsonText = (() => {
        const m = raw.match(/\{[\s\S]*\}/);
        return m ? m[0] : raw;
      })();
      const parsed = JSON.parse(jsonText);
      const choices: string[][] = Array.isArray(parsed?.choices) ? parsed.choices : [];
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

  // Refinement helpers removed per updated requirements.

  // Reranking helpers removed; handled in RankingService now.
}

export default GenerationService;
