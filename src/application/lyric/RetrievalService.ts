// RetrievalService (Application Layer)
// Scene intent inference (lightweight LLM) + hybrid retrieval against Chroma
// using ONNX embeddings, plus frequency enrichment per digit.
// Notes: This wires minimal IO in application layer to satisfy feature spec
// for the spike; adapters can replace these later behind ports.

import { LyricErrorCode, LyricWarningCode } from "../../shared/lyric-codes.ts";
import { ChromaClient } from "chromadb";
import { pipeline } from "@huggingface/transformers";
import { GoogleGenAI } from "npm:@google/genai";
import { isAbsolute, join, normalize } from "jsr:@std/path";
import { PrismaClient } from "../../../prisma/generated/client.ts";
import { PatternSlot, SegmentationPattern } from "../../domain/lyric/entities.ts";
import SiliconFlowEmbeddingProvider from "../../infrastructure/adapters/embedding/SiliconFlowEmbeddingProvider.ts";

const ALLOWED_POS_TAGS = new Set([
  "NOUN",
  "VERB",
  "ADJ",
  "ADV",
  "PRON",
  "PART",
  "CONJ",
  "DET",
  "NUM",
  "AUX",
  "ADP",
  "SCONJ",
  "PROPN",
  "INTJ",
  "X",
]);

const POS_ALIAS: Record<string, string> = {
  ADJECTIVE: "ADJ",
  ADVERB: "ADV",
  PRONOUN: "PRON",
  CONJUNCTION: "CONJ",
  DETERMINER: "DET",
  NOUN_PHRASE: "NOUN",
  VERB_PHRASE: "VERB",
  PARTICLE: "PART",
  PREPOSITION: "ADP",
  PROPER_NOUN: "PROPN",
  INTERJECTION: "INTJ",
};

const DEFAULT_POS_SEQUENCE = [
  "NOUN",
  "ADV",
  "VERB",
  "ADJ",
  "NOUN",
  "PART",
  "VERB",
  "ADP",
];

const FALLBACK_SLOT_THEMES = [
  "主角",
  "情緒",
  "動作",
  "場景",
  "對象",
  "細節",
  "期盼",
  "語氣",
];

const POS_HINTS: Record<
  string,
  { label: string; template: (focus: string, detail: string) => string }
> = {
  NOUN: {
    label: "名詞",
    template: (focus, detail) => `描述${focus}裡與${detail}相關的名詞`,
  },
  VERB: {
    label: "動作",
    template: (focus, detail) => `描寫${focus}中${detail}會做出的動作或變化`,
  },
  ADJ: {
    label: "形容詞",
    template: (focus, detail) => `形容${focus}時${detail}的感覺或特質`,
  },
  ADV: {
    label: "副詞",
    template: (focus, detail) => `強化${focus}情境下${detail}情緒的副詞`,
  },
  PRON: {
    label: "代詞",
    template: (focus, detail) => `替代${focus}裡${detail}角色的代詞或稱呼`,
  },
  PART: {
    label: "語氣助詞",
    template: (focus, detail) => `呼應${focus}下${detail}情緒的語氣助詞`,
  },
  CONJ: {
    label: "連接詞",
    template: (focus, detail) => `連結${focus}前後${detail}意念的連接詞`,
  },
  DET: {
    label: "限定詞",
    template: (focus, detail) => `限定${focus}裡${detail}對象的詞語`,
  },
  NUM: {
    label: "數量詞",
    template: (focus, detail) => `表達${focus}當下${detail}次數或時刻的數量詞`,
  },
  AUX: {
    label: "助動詞",
    template: (focus, detail) => `表明${focus}願望或${detail}決心的助動詞`,
  },
  ADP: {
    label: "介詞",
    template: (focus, detail) => `連結${focus}與${detail}關係的介詞`,
  },
  SCONJ: {
    label: "從屬連接詞",
    template: (focus, detail) => `帶出${focus}背後${detail}原因的從屬連接詞`,
  },
  PROPN: {
    label: "專有名詞",
    template: (focus, detail) => `象徵${focus}裡${detail}意象的專有名詞`,
  },
  INTJ: {
    label: "感嘆詞",
    template: (focus, detail) => `傳達${focus}時${detail}情緒的感嘆詞`,
  },
  X: {
    label: "語塊",
    template: (focus, detail) => `表達${focus}氛圍裡${detail}感受的語塊`,
  },
};

export interface SceneIntent {
  title: string;
  emotions: string[];
  microIntent: string;
  continuityNotes: string;
}

export interface LineThemePlan {
  primary: string;
  subThemes: string[];
}

export interface RetrievalConfig {
  semanticTarget: number; // desired semantic candidates (e.g., 200)
  freqTop: number; // number of high frequency picks per digit (e.g., 100)
  freqRandom: number; // number of random frequency picks per digit (e.g., 50)
  /**
   * If < 1, treated as ratio of semanticTarget (e.g., 0.75 => 150 for target=200).
   * If >= 1, treated as absolute minimum semantic candidate count.
   */
  minSemanticThreshold: number;
  /**
   * Minimum similarity (1 - distance) to accept a semantic match. 0..1. Default ~0.62.
   */
  semanticMinSimilarity?: number;
}

export interface RetrievalRequest {
  lineIndex: number;
  toneSequence: string;
  digitSet: string[]; // from segmentation
  patterns: SegmentationPattern[];
  sceneIntent: SceneIntent;
  config: RetrievalConfig;
  // Optional per-line overrides for theme-driven retrieval
  overrideTheme?: string;
  overrideSubThemes?: string[];
}

export interface LexicalCandidate {
  surface: string; // lexical surface form
  toneDigit: string; // which tone digit (group) it maps to
  provenance: string; // semantic | freq-top | freq-random
  sceneRelevanceScore?: number; // 0..1 for semantic results
  freq?: number; // frequency from metadata (if available)
  posTag?: string;
  slotMatches?: string[];
  sourcePrompt?: string;
}

export interface DigitStats {
  semantic: number;
  freqTop: number;
  freqRandom: number;
  total: number;
}

export interface RetrievalResult {
  lineIndex: number;
  semanticCount: number;
  freqTopCount: number;
  freqRandomCount: number;
  total: number;
  perDigit: Record<string, DigitStats>;
  candidates: LexicalCandidate[];
  patternSlots: Record<string, PatternSlot[]>;
  warnings: string[];
  error?: string;
  globalPicks?: {
    topWords50: Array<{ surface: string; freq: number }>;
    topChars50: Array<{ surface: string; freq: number }>;
    randWords25: Array<{ surface: string; freq: number }>;
    randChars25: Array<{ surface: string; freq: number }>;
  };
}

export interface AiLexiconMatch {
  id: string;
  surface: string;
  type: string;
  lang: string;
  jyutping: string[];
  pronunciation: string;
  tone: string;
  consonants: string[];
  rhymes: string[];
  syllables: number;
  freq?: number;
  pos?: string;
  register?: string;
  gloss?: string;
  source?: string;
  similarity: number;
}

export class RetrievalService {
  private chromaClient: ChromaClient | null = null;
  private chromaCollection: any | null = null;
  private collectionName: string;
  private chromaUrl: string;
  private embeddingModel: string;
  private transformersCache: string;
  private embeddingFunction: any | null = null;
  private useCloudEmbedding = false;
  private siliconflowProvider: SiliconFlowEmbeddingProvider | null = null;
  private geminiApiKey?: string;
  private geminiSceneModel: string;
  private prisma: PrismaClient | null = null;
  private genAI: GoogleGenAI | null = null;
  constructor(private readonly minPerDigit = 3, geminiApiKey?: string) {
    this.collectionName = Deno.env.get("CHROMA_COLLECTION") ??
      "cantolyr_lexicon_v1_1024";
    this.chromaUrl = Deno.env.get("CHROMA_URL") ?? "http://localhost:8000";

    const embeddingProvider = (Deno.env.get("EMBEDDING_PROVIDER") || "").toLowerCase();
    const hasSiliconKey = Boolean(Deno.env.get("SILICONFLOW_API_KEY"));
    this.useCloudEmbedding = embeddingProvider === "siliconflow" ||
      (!embeddingProvider && hasSiliconKey);

    // Model IDs default depending on backend
    if (this.useCloudEmbedding) {
      // When using cloud embeddings, do NOT fall back to EMBEDDING_MODEL (ONNX ids are not valid for cloud APIs)
      this.embeddingModel = Deno.env.get("SILICONFLOW_EMBED_MODEL") ||
        "Qwen/Qwen3-Embedding-0.6B";
    } else {
      this.embeddingModel = Deno.env.get("EMBEDDING_MODEL") ||
        "onnx-community/Qwen3-Embedding-0.6B-ONNX";
    }

    this.transformersCache = Deno.env.get("TRANSFORMERS_CACHE") ??
      "./.cache/transformers";

    // SiliconFlow config (only initialized if using cloud)
    if (this.useCloudEmbedding) {
      const apiKey = Deno.env.get("SILICONFLOW_API_KEY");
      const baseUrl = Deno.env.get("SILICONFLOW_BASE_URL") || "https://api.siliconflow.cn";
      if (!apiKey) {
        throw new Error("SILICONFLOW_API_KEY is required when EMBEDDING_PROVIDER=siliconflow");
      }
      this.siliconflowProvider = new SiliconFlowEmbeddingProvider({
        apiKey,
        model: this.embeddingModel,
        baseUrl,
      });
    }

    this.geminiApiKey = geminiApiKey ?? Deno.env.get("GEMINI_API_KEY") ?? undefined;
    this.geminiSceneModel = Deno.env.get("GEMINI_SCENE_MODEL") ??
      "gemini-2.5-flash-lite";
  }

  async searchLexiconByPronunciation(
    params: { query: string; pronunciation: string; limit?: number },
  ): Promise<AiLexiconMatch[]> {
    const query = params.query?.trim();
    const pronunciation = params.pronunciation?.trim();
    if (!query || !pronunciation) {
      return [];
    }
    const limit = Math.min(Math.max(params.limit ?? 25, 1), 200);
    await this.ensureChroma();
    await this.ensureEmbedding();
    await this.ensureChromaCollection();
    const collection = this.chromaCollection!;
    const embedding = await this.embed(query);
    const fetchCount = Math.max(limit * 3, 50);
    const result = await collection.query({
      queryEmbeddings: [embedding],
      nResults: fetchCount,
      include: ["metadatas", "distances"],
      where: { pronunciation: { "$eq": pronunciation } },
    });
    const metadatas = (result.metadatas?.[0] ?? []) as Array<
      Record<string, unknown>
    >;
    const distances = result.distances?.[0] ?? [];
    const ids = result.ids?.[0] ?? [];
    const matches: AiLexiconMatch[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < metadatas.length; i++) {
      if (matches.length >= limit) break;
      const md = metadatas[i] ?? {};
      const surface = typeof md.surface === "string" ? md.surface.trim() : "";
      if (!surface) continue;
      const mdPron = typeof md.pronunciation === "string"
        ? md.pronunciation.trim()
        : String(md.pronunciation ?? "");
      if (mdPron && mdPron !== pronunciation) continue;
      const rawId = Array.isArray(ids) ? ids[i] : undefined;
      const candidateId = typeof rawId === "string" && rawId
        ? String(rawId)
        : `${surface}|${pronunciation}`;
      if (seen.has(candidateId)) continue;
      let similarity = 0;
      if (distances[i] != null) {
        const dist = Number(distances[i]);
        if (Number.isFinite(dist)) {
          similarity = Math.max(0, Math.min(1, 1 - dist));
        }
      }
      const jyutping = typeof md.jyutping === "string"
        ? md.jyutping.split(/\s+/).filter(Boolean)
        : [];
      const consonants = typeof md.consonantsStr === "string"
        ? md.consonantsStr.split(/\s+/).filter(Boolean)
        : [];
      const rhymes = typeof md.rhymesStr === "string"
        ? md.rhymesStr.split(/\s+/).filter(Boolean)
        : [];
      const rawSyllables = typeof md.syllables === "number"
        ? md.syllables
        : Number.parseInt(String(md.syllables ?? ""), 10);
      const syllables = Number.isFinite(rawSyllables) && rawSyllables >= 0
        ? Math.trunc(rawSyllables)
        : 0;
      let freq: number | undefined;
      if (md.freq != null) {
        const parsedFreq = Number(md.freq);
        if (Number.isFinite(parsedFreq)) {
          freq = parsedFreq;
        }
      }
      const match: AiLexiconMatch = {
        id: candidateId,
        surface,
        type: typeof md.type === "string" && md.type ? String(md.type) : "vocab",
        lang: typeof md.lang === "string" ? String(md.lang) : "",
        jyutping,
        pronunciation: mdPron || pronunciation,
        tone: typeof md.tone === "string" ? String(md.tone) : "",
        consonants,
        rhymes,
        syllables,
        freq,
        pos: typeof md.pos === "string" && md.pos ? String(md.pos) : undefined,
        register: typeof md.register === "string" && md.register ? String(md.register) : undefined,
        gloss: typeof md.gloss === "string" && md.gloss ? String(md.gloss) : undefined,
        source: typeof md.source === "string" && md.source ? String(md.source) : undefined,
        similarity,
      };
      matches.push(match);
      seen.add(candidateId);
    }
    matches.sort((a, b) => b.similarity - a.similarity);
    return matches.slice(0, limit);
  }

  async buildPool(req: RetrievalRequest): Promise<RetrievalResult> {
    if (!req.toneSequence || req.digitSet.length === 0) {
      throw new Error(LyricErrorCode.ERROR_INVALID_INPUT);
    }

    await this.ensureChroma();
    await this.ensureEmbedding();

    // 1) Derive/refine micro-scene intent via Gemini (lightweight)
    const refinedIntent = await this.inferSceneIntent(
      req.sceneIntent,
      req.toneSequence,
    );

    // 2) Build refined semantic query variants: base vs 子題 (sub-themes)
    const { baseQueries, subThemeQueries } = this.buildBaseAndSubThemeQueries(
      refinedIntent,
      req,
    );

    // 3) Build POS-aware slot plan per pattern and digit
    const slotPlan = await this.buildPatternSlotPlan(
      req.patterns ?? [],
      refinedIntent,
    );
    const digitSlotMap = new Map<string, PatternSlot[]>();
    for (const slots of Object.values(slotPlan)) {
      for (const slot of slots) {
        if (!slot || !slot.toneDigit) continue;
        const existing = digitSlotMap.get(slot.toneDigit) || [];
        existing.push(slot);
        digitSlotMap.set(slot.toneDigit, existing);
      }
    }

    // 4) Semantic retrieval per digit until reaching semanticTarget
    const confTarget = req.config.semanticTarget ?? 1000;
    const semanticTarget = Math.max(
      50,
      Math.floor(confTarget < 5 ? 1000 * confTarget : confTarget),
    );
    const perDigitBudget = Math.max(
      10,
      Math.floor(semanticTarget / req.digitSet.length),
    );
    const semantic: LexicalCandidate[] = [];
    const candidateByKey = new Map<string, LexicalCandidate>();
    const seenKey = new Set<string>(); // surface|digit
    const seenSurface = new Set<string>(); // de-dupe across entire pool by surface
    const perDigit: Record<string, DigitStats> = {};
    const minSim = req.config.semanticMinSimilarity ?? 0.3;

    const upsertSlotMatch = (
      candidate: LexicalCandidate,
      matchId?: string,
      prompt?: string,
    ) => {
      if (!matchId) return;
      const matches = new Set(candidate.slotMatches ?? []);
      matches.add(matchId);
      candidate.slotMatches = Array.from(matches);
      if (prompt && !candidate.sourcePrompt) candidate.sourcePrompt = prompt;
    };

    const upsertSemanticCandidate = (
      digit: string,
      result: {
        surface: string;
        similarity: number;
        freq?: number;
        posTag?: string;
        slotId?: string;
        prompt?: string;
      },
      provenance: string,
    ): boolean => {
      const key = `${result.surface}|${digit}`;
      const existing = candidateByKey.get(key);
      if (existing) {
        existing.sceneRelevanceScore = Math.max(
          existing.sceneRelevanceScore ?? 0,
          result.similarity,
        );
        if (result.freq != null) existing.freq = result.freq;
        if (result.posTag && !existing.posTag) existing.posTag = result.posTag;
        upsertSlotMatch(existing, result.slotId, result.prompt);
        return false;
      }
      const candidate: LexicalCandidate = {
        surface: result.surface,
        toneDigit: digit,
        provenance,
        sceneRelevanceScore: result.similarity,
        freq: result.freq,
        posTag: result.posTag,
        slotMatches: result.slotId ? [result.slotId] : undefined,
        sourcePrompt: result.prompt,
      };
      semantic.push(candidate);
      candidateByKey.set(key, candidate);
      seenKey.add(key);
      seenSurface.add(candidate.surface);
      return true;
    };

    for (const digit of req.digitSet) {
      const slotDescriptors = digitSlotMap.get(digit) ?? [];
      const slotCount = Math.max(slotDescriptors.length, 1);
      const slotBudget = Math.max(3, Math.floor(perDigitBudget / slotCount));
      let count = 0;

      for (const slot of slotDescriptors) {
        const prompt = slot.retrievalPrompt?.trim();
        const slotQueries = prompt && prompt.length ? [prompt] : baseQueries;
        let slotResults = await this.semanticSearchForDigit(
          slotQueries,
          digit,
          slotBudget,
          minSim,
          { posTag: slot.posTag, slot },
        );
        let slotAdded = 0;
        for (const r of slotResults) {
          if (upsertSemanticCandidate(digit, r, "semantic-slot")) slotAdded++;
        }
        // Relax POS constraint if slot yielded nothing
        if (slotAdded === 0 && slot.posTag) {
          slotResults = await this.semanticSearchForDigit(
            slotQueries,
            digit,
            slotBudget,
            minSim,
            { slot },
          );
          for (const r of slotResults) {
            if (upsertSemanticCandidate(digit, r, "semantic-slot-relaxed")) {
              slotAdded++;
            }
          }
        }
        count += slotAdded;
      }

      const remainingBudget = Math.max(0, perDigitBudget - count);
      if (remainingBudget > 0) {
        const generalResults = await this.semanticSearchForDigit(
          baseQueries,
          digit,
          remainingBudget,
          minSim,
        );
        for (const r of generalResults) {
          if (upsertSemanticCandidate(digit, r, "semantic")) count++;
          if (count >= perDigitBudget) break;
        }
      }

      // Fallback: if still empty, split digit into smaller chunks
      if (count === 0) {
        const chunks = this.splitDigitForFallback(digit);
        if (chunks.length > 1) {
          const perChunk = Math.max(
            5,
            Math.ceil(perDigitBudget / chunks.length),
          );
          const mergedChunkSurfaces = new Set<string>();
          for (const c of chunks) {
            const chunkRes = await this.semanticSearchForDigit(
              baseQueries,
              c,
              perChunk,
              minSim,
            );
            for (const r of chunkRes) {
              if (mergedChunkSurfaces.has(r.surface)) continue;
              mergedChunkSurfaces.add(r.surface);
              if (upsertSemanticCandidate(digit, r, "semantic-fallback")) {
                count++;
              }
              if (count >= perDigitBudget) break;
            }
            if (count >= perDigitBudget) break;
          }
        }
      }

      perDigit[digit] = {
        semantic: count,
        freqTop: 0,
        freqRandom: 0,
        total: count,
      };
    }

    // Phase 2: 子題 queries. If already at semanticTarget, cap additions to 20% per digit; otherwise, just fill up to target.
    const alreadyFull = semantic.length >= semanticTarget;
    const perDigitSubCap = Math.max(1, Math.floor(perDigitBudget * 0.2));
    const digits = req.digitSet;
    if (subThemeQueries.length) {
      for (const digit of digits) {
        if (alreadyFull) {
          let added = 0;
          if (perDigitSubCap <= 0) continue;
          const subRes = await this.semanticSearchForDigit(
            subThemeQueries,
            digit,
            perDigitSubCap * 2,
            minSim,
          );
          for (const r of subRes) {
            if (upsertSemanticCandidate(digit, r, "semantic-subtheme")) added++;
            if (added >= perDigitSubCap) break;
          }
          const stats = perDigit[digit] ??
            { semantic: 0, freqTop: 0, freqRandom: 0, total: 0 };
          stats.semantic += added;
          stats.total += added;
          perDigit[digit] = stats;
        } else {
          if (semantic.length >= semanticTarget) break;
          const remaining = semanticTarget - semantic.length;
          const budgetThisDigit = Math.min(
            Math.max(3, Math.ceil(remaining / digits.length)),
            perDigitBudget,
          );
          if (budgetThisDigit <= 0) continue;
          const subRes = await this.semanticSearchForDigit(
            subThemeQueries,
            digit,
            budgetThisDigit * 2,
            minSim,
          );
          let added = 0;
          for (const r of subRes) {
            if (semantic.length >= semanticTarget) break;
            if (upsertSemanticCandidate(digit, r, "semantic-subtheme")) added++;
            if (added >= budgetThisDigit) break;
          }
          const stats = perDigit[digit] ??
            { semantic: 0, freqTop: 0, freqRandom: 0, total: 0 };
          stats.semantic += added;
          stats.total += added;
          perDigit[digit] = stats;
        }
      }
    }

    // 4) Frequency enrichment per digit: top-100 by freq, plus random-50 from rank 200-500 slice (from Postgres)
    await this.ensurePrisma();
    const freqTopAll: LexicalCandidate[] = [];
    const freqRandomAll: LexicalCandidate[] = [];
    for (const digit of req.digitSet) {
      const { top, randomSlice } = await this.getFrequencyEnrichmentForDigit(
        digit,
        req.config,
      );
      let addedTop = 0;
      let addedRand = 0;
      for (const item of top) {
        const key = `${item.surface}|${digit}`;
        if (seenKey.has(key) || seenSurface.has(item.surface)) continue;
        seenKey.add(key);
        freqTopAll.push({
          surface: item.surface,
          toneDigit: digit,
          provenance: "freq-top",
          freq: item.freq,
        });
        seenSurface.add(item.surface);
        addedTop++;
      }
      for (const item of randomSlice) {
        const key = `${item.surface}|${digit}`;
        if (seenKey.has(key) || seenSurface.has(item.surface)) continue;
        seenKey.add(key);
        freqRandomAll.push({
          surface: item.surface,
          toneDigit: digit,
          provenance: "freq-random",
          freq: item.freq,
        });
        seenSurface.add(item.surface);
        addedRand++;
      }
      const stats = perDigit[digit] ??
        { semantic: 0, freqTop: 0, freqRandom: 0, total: 0 };
      stats.freqTop += addedTop;
      stats.freqRandom += addedRand;
      stats.total = stats.semantic + stats.freqTop + stats.freqRandom;
      perDigit[digit] = stats;
    }

    // Global frequency lists (not tied to digit):
    // - Top 50 words (len > 1)
    // - Top 50 chars (len == 1)
    // - 25 random words from ranks 26..500
    // - 25 random chars from ranks 26..500
    let globalPicks: {
      topWords50: Array<{ surface: string; freq: number }>;
      topChars50: Array<{ surface: string; freq: number }>;
      randWords25: Array<{ surface: string; freq: number }>;
      randChars25: Array<{ surface: string; freq: number }>;
    } | undefined = undefined;
    try {
      const global = await this.getGlobalFrequencyPicks();
      globalPicks = global;
      const addGlobalItems = (
        items: Array<{ surface: string; freq: number }>,
        provenance: string,
      ) => {
        for (const item of items) {
          if (seenSurface.has(item.surface)) continue;
          seenSurface.add(item.surface);
          // Use 'global' as toneDigit to indicate no digit relation
          freqRandomAll.push({
            surface: item.surface,
            toneDigit: "global",
            provenance,
            freq: item.freq,
          });
        }
      };
      addGlobalItems(global.topWords50, "freq-global-top-word");
      addGlobalItems(global.topChars50, "freq-global-top-char");
      addGlobalItems(global.randWords25, "freq-global-rand-word");
      addGlobalItems(global.randChars25, "freq-global-rand-char");
    } catch (e) {
      console.warn(`Global frequency picks failed: ${e}`);
    }

    const candidates = [...semantic, ...freqTopAll, ...freqRandomAll];
    const semanticCount = semantic.length;
    const freqTopCount = freqTopAll.length;
    const freqRandomCount = freqRandomAll.length;
    const total = candidates.length;

    // 5) Warnings and errors
    const warnings: string[] = [];
    const minSemAbs = req.config.minSemanticThreshold < 1
      ? Math.floor(
        (req.config.semanticTarget || 200) * req.config.minSemanticThreshold,
      )
      : Math.floor(req.config.minSemanticThreshold);
    if (semanticCount < minSemAbs) {
      warnings.push(LyricWarningCode.WARN_LOW_SEMANTIC);
    }
    // Frequency shortfall
    const wantTop = (req.config.freqTop || 100) * req.digitSet.length;
    const wantRand = (req.config.freqRandom || 50) * req.digitSet.length;
    if (freqTopCount < Math.min(wantTop, total)) {
      warnings.push(LyricWarningCode.WARN_LOW_FREQUENCY);
    }
    if (freqRandomCount < Math.min(wantRand, total)) {
      warnings.push(LyricWarningCode.WARN_LOW_FREQUENCY);
    }

    // digit insufficiency check (at least 3 overall per digit)
    const insufficientDigits = Object.entries(perDigit).filter(([_d, s]) =>
      s.total < this.minPerDigit
    );
    const error = insufficientDigits.length > 0
      ? LyricErrorCode.ERROR_DIGIT_INSUFFICIENT
      : undefined;

    return {
      lineIndex: req.lineIndex,
      semanticCount,
      freqTopCount,
      freqRandomCount,
      total,
      perDigit,
      candidates,
      patternSlots: slotPlan,
      warnings,
      error,
      globalPicks,
    };
  }

  // --- Internal helpers ---

  private async ensureChroma(): Promise<void> {
    if (this.chromaClient) return;
    const url = new URL(this.chromaUrl);
    this.chromaClient = new ChromaClient({
      ssl: url.protocol === "https:",
      host: url.hostname,
      port: Number(url.port || (url.protocol === "https:" ? 443 : 8000)),
    });
    // heartbeat to verify
    await this.chromaClient.heartbeat();
    await this.ensureChromaCollection();
  }

  private async ensureChromaCollection(forceReload = false): Promise<void> {
    if (!this.chromaClient) throw new Error("Chroma client not initialized");
    if (this.chromaCollection && !forceReload) return;
    // Verify collection exists; if not, try sensible fallbacks and provide diagnostics
    const collections = await this.chromaClient.listCollections();
    const names = collections.map((c: any) => c.name as string);
    if (!names.includes(this.collectionName)) {
      // Try common fallbacks
      const preferred = [
        "cantolyr_lexicon_v1_1024",
        "cantolyr_lexicon_v1_1024",
      ];
      const foundPreferred = preferred.find((n) => names.includes(n));
      if (foundPreferred) {
        console.warn(
          `Chroma collection '${this.collectionName}' not found. Falling back to '${foundPreferred}'.`,
        );
        this.collectionName = foundPreferred;
      } else if (names.length === 1) {
        console.warn(
          `Chroma collection '${this.collectionName}' not found. Using only available collection '${
            names[0]
          }'.`,
        );
        this.collectionName = names[0];
      } else {
        // Provide guidance and list available
        const list = names.length
          ? `Available collections: ${names.join(", ")}`
          : "No collections available on server.";
        const hint =
          `Set env 'CHROMA_COLLECTION' to one of the available names, or run 'deno run -A scripts/test-chroma.ts --limit=1' to list and verify.`;
        throw new Error(
          `Chroma collection '${this.collectionName}' not found. ${list} ${hint}`,
        );
      }
    }
    this.chromaCollection = await this.chromaClient.getCollection({
      name: this.collectionName,
    });
    try {
      // Some servers expose metadata via count or describe; attempt a light call to ensure it's reachable
      const cnt = await this.chromaCollection.count();
      console.log(
        `Chroma collection '${this.collectionName}' reachable. Count=${cnt}`,
      );
    } catch (e) {
      console.warn(
        `Warning: Could not verify collection count for '${this.collectionName}': ${e}`,
      );
    }
  }

  private async ensureEmbedding(): Promise<void> {
    if (this.embeddingFunction || this.useCloudEmbedding) return;
    let cacheDir = this.transformersCache || ".cache/transformers";
    try {
      // Resolve TRANSFORMERS_CACHE to an absolute project-root path
      if (!isAbsolute(cacheDir)) {
        cacheDir = normalize(join(Deno.cwd(), cacheDir));
      }
      await Deno.mkdir(cacheDir, { recursive: true });
    } catch { /* ignore */ }
    // Use EMBEDDING_MODEL from env with default fallback
    const modelId = this.embeddingModel ||
      "onnx-community/Qwen3-Embedding-0.6B-ONNX";
    this.embeddingFunction = await pipeline("feature-extraction", modelId, {
      cache_dir: cacheDir,
      dtype: "fp32",
    });
  }

  private async ensurePrisma(): Promise<void> {
    if (this.prisma) return;
    // Rely on DATABASE_URL env configured by runtime
    const dbUrl = Deno.env.get("DATABASE_URL");
    if (!dbUrl || !dbUrl.trim()) {
      throw new Error(
        "DATABASE_URL is not set. Set it in your environment or .env (e.g., postgresql://user:pass@localhost:5432/cantolyr). See prisma/.env.example or docs/CONFIGURATION.md.",
      );
    }
    this.prisma = new PrismaClient({
      datasources: {
        db: {
          // If DATABASE_URL missing, Prisma will throw; let it surface
          url: dbUrl,
        },
      },
      log: ["warn", "error"],
    });
    await this.prisma.$connect();
    try {
      await this.prisma.$executeRawUnsafe("SET client_encoding TO 'UTF8'");
    } catch { /* ignore */ }
  }

  private async embed(text: string): Promise<number[]> {
    if (this.useCloudEmbedding) {
      if (!this.siliconflowProvider) {
        throw new Error(LyricErrorCode.ERROR_EMBEDDING_FAILED);
      }
      const [vec] = await this.siliconflowProvider.embed([text]);
      if (!vec) throw new Error(LyricErrorCode.ERROR_EMBEDDING_FAILED);
      return vec.map((x) => Number(x));
    }
    if (!this.embeddingFunction) {
      throw new Error(LyricErrorCode.ERROR_EMBEDDING_FAILED);
    }
    const out = await this.embeddingFunction([text], {
      pooling: "last_token",
      normalize: true,
    });
    return Array.from(out.data);
  }

  private async inferSceneIntent(
    scene: SceneIntent,
    toneSequence: string,
  ): Promise<SceneIntent> {
    // If API key missing, return as-is
    if (!this.geminiApiKey) return scene;
    if (!this.genAI) {
      this.genAI = new GoogleGenAI({ apiKey: this.geminiApiKey });
    }
    const system =
      "Extract concise micro-scene intent for Cantonese lyric line. Output JSON with keys: title, emotions (<=4, lowercase), microIntent, continuityNotes. Be grounded in the given theme.";
    const user = `Theme: ${
      scene.title || scene.microIntent
    }\nTone sequence: ${toneSequence}\nEmotions hint: ${(scene.emotions || []).join(", ")}`;
    const prompt = `${system}\n${user}`;
    try {
      const response = await this.genAI.models.generateContent({
        model: this.geminiSceneModel,
        contents: prompt,
        config: {
          temperature: 0.2,
          maxOutputTokens: 200,
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: "object",
            properties: {
              title: { type: "string" },
              emotions: { type: "array", items: { type: "string" } },
              microIntent: { type: "string" },
              continuityNotes: { type: "string" },
            },
            required: ["title", "emotions", "microIntent", "continuityNotes"],
          },
        },
      });
      const text = this.extractText(response);
      if (!text) throw new Error("No text in response");
      const parsed = this.safeParseIntent(text);
      return {
        title: parsed.title || scene.title,
        emotions: parsed.emotions?.length ? parsed.emotions : (scene.emotions || []),
        microIntent: parsed.microIntent || scene.microIntent || scene.title,
        continuityNotes: parsed.continuityNotes || scene.continuityNotes || "",
      };
    } catch {
      return scene;
    }
  }

  // Split a tone digit string into 2-digit chunks (last may be 1-digit), e.g., '9405' -> ['94','05']
  private splitDigitForFallback(digit: string): string[] {
    const s = String(digit);
    // If only two characters, fall back to per-character digits like ['3','9']
    if (s.length <= 2) {
      return s.split("").filter(Boolean);
    }
    const chunks: string[] = [];
    for (let i = 0; i < s.length; i += 2) {
      chunks.push(s.slice(i, i + 2));
    }
    return chunks.filter(Boolean);
  }

  private safeParseIntent(text: string): Partial<SceneIntent> {
    try {
      const s = text.indexOf("{");
      const e = text.lastIndexOf("}");
      if (s !== -1 && e !== -1) return JSON.parse(text.slice(s, e + 1));
    } catch { /* ignore */ }
    return {};
  }

  private buildBaseAndSubThemeQueries(
    intent: SceneIntent,
    _req: RetrievalRequest,
  ): { baseQueries: string[]; subThemeQueries: string[] } {
    // Prefer per-line override theme and sub-themes when present
    const theme = _req.overrideTheme || intent.microIntent || intent.title ||
      "";
    const subThemes = (_req.overrideSubThemes || []).filter(Boolean);
    const emotions = (intent.emotions || []).join(", ");
    const base = `語境 主題:${theme} 情感:${emotions}`;
    // Also create a stripped, content-only variant to improve embedding recall
    const contentBits = [theme, emotions].filter(Boolean).join(" ")
      .replace(/[，。、；：:,.!！?？\[\]()（）]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const baseStripped = contentBits;
    const baseQueries: string[] = [base];
    if (baseStripped) baseQueries.push(baseStripped);
    // 子題 queries: emphasize descriptive and semantically neutral phrasing
    const subThemeQueries: string[] = [];
    for (const st of subThemes) {
      const q = `${base} 子題(描述性/語義中性):${st}`;
      subThemeQueries.push(q);
      const stripped = [theme, st, emotions].filter(Boolean).join(" ")
        .replace(/[，。、；：:,.!！?？\[\]()（）]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (stripped) subThemeQueries.push(stripped);
    }
    return {
      baseQueries: Array.from(new Set(baseQueries)),
      subThemeQueries: Array.from(new Set(subThemeQueries)),
    };
  }

  // Generate a coherent set of line themes and sub-themes for a story (one call up front)
  async generateStoryThemes(
    count: number,
    base: SceneIntent,
    toneSequences?: string[],
  ): Promise<LineThemePlan[]> {
    // If no API key, fallback: repeat base with lightweight variations
    if (!this.geminiApiKey) {
      const fallback: LineThemePlan[] = [];
      for (let i = 0; i < count; i++) {
        fallback.push({
          primary: `${base.title}·${i + 1}`,
          subThemes: [base.microIntent].filter(Boolean),
        });
      }
      return fallback;
    }
    if (!this.genAI) {
      this.genAI = new GoogleGenAI({ apiKey: this.geminiApiKey });
    }

    const schema = {
      type: "array",
      items: {
        type: "object",
        properties: {
          primary: { type: "string" },
          subThemes: { type: "array", items: { type: "string" } },
        },
        required: ["primary", "subThemes"],
      },
      minItems: count,
      maxItems: count,
    } as const;

    const userInstruction = [
      `請以粵語為基調，根據主題「${
        base.title || base.microIntent
      }」規劃 ${count} 行歌詞的劇情主軸（primary）與每行3-5個子題（subThemes）。`,
      `要求：`,
      `- 全部行之間要有連貫性（部分或完整故事）。`,
      `- 每行的 primary 不重複，但彼此呼應。`,
      `- 子題需「描述性且語義中性」，避免俚語與特定專有名詞（除非情節核心），`,
      `  優先使用可泛化的語彙：動作/關係/場景/氛圍/質感/感官/時序等，詞語精簡（每項 ≤ 8 字）。`,
      `- 子題應有助於語意檢索的擴展覆蓋與重述，不局限具體情節細節。`,
      toneSequences && toneSequences.length
        ? `- 參考各行聲調序列（僅作氣氛提示）：${toneSequences.join(" | ")}`
        : ``,
      `- 請輸出 JSON，符合 schema。`,
    ].filter(Boolean).join("\n");

    try {
      const response = await this.genAI.models.generateContent({
        model: this.geminiSceneModel,
        contents: userInstruction,
        config: {
          temperature: 0.3,
          maxOutputTokens: 400,
          responseMimeType: "application/json",
          responseJsonSchema: schema as unknown,
        },
      });
      const text = this.extractText(response);
      if (!text) throw new Error("No text in response");
      const s = text.indexOf("[");
      const e = text.lastIndexOf("]");
      const json = JSON.parse(
        text.slice(s !== -1 ? s : 0, e !== -1 ? e + 1 : text.length),
      );
      // Normalize shape
      const plans: LineThemePlan[] = Array.isArray(json)
        ? json.map((it: any) => ({
          primary: String(it?.primary ?? base.title ?? base.microIntent ?? ""),
          subThemes: Array.isArray(it?.subThemes)
            ? it.subThemes.map((x: any) => String(x)).filter(Boolean)
            : [],
        }))
        : [];
      // Pad or trim to count
      while (plans.length < count) {
        plans.push({
          primary: `${base.title}·${plans.length + 1}`,
          subThemes: [],
        });
      }
      return plans.slice(0, count);
    } catch {
      // Fallback on failure
      const fallback: LineThemePlan[] = [];
      for (let i = 0; i < count; i++) {
        fallback.push({ primary: `${base.title}·${i + 1}`, subThemes: [] });
      }
      return fallback;
    }
  }

  private normalizePosTag(pos?: string): string | undefined {
    if (!pos) return undefined;
    const cleaned = pos.trim();
    if (!cleaned) return undefined;
    const direct = cleaned.toUpperCase();
    if (ALLOWED_POS_TAGS.has(direct)) return direct;
    const alias = POS_ALIAS[direct] ?? POS_ALIAS[cleaned.toUpperCase()];
    if (alias && ALLOWED_POS_TAGS.has(alias)) return alias;
    return undefined;
  }

  private buildFallbackSlots(
    patterns: SegmentationPattern[],
    intent: SceneIntent,
  ): Record<string, PatternSlot[]> {
    const focus = intent.microIntent || intent.title || "這個場景";
    const plan: Record<string, PatternSlot[]> = {};
    for (const pattern of patterns) {
      const slots: PatternSlot[] = [];
      const baseSlots = pattern.slots ? Array.isArray(pattern.slots) ? pattern.slots : [] : [];
      if (baseSlots.length) {
        baseSlots.forEach((slot: PatternSlot, index: number) => {
          const toneDigit = slot.toneDigit || pattern.groups[index] ||
            pattern.groups[0] || "";
          const fallbackPos = this.normalizePosTag(slot.posTag) ??
            DEFAULT_POS_SEQUENCE[index % DEFAULT_POS_SEQUENCE.length];
          const normalizedPos = this.normalizePosTag(fallbackPos) ?? "NOUN";
          const hint = POS_HINTS[normalizedPos] ?? POS_HINTS.NOUN;
          const detail = FALLBACK_SLOT_THEMES[index % FALLBACK_SLOT_THEMES.length];
          slots.push({
            id: slot.id || `${pattern.id}_slot_${index}`,
            toneDigit,
            posTag: normalizedPos,
            description: slot.description || `${detail}-${hint.label}`,
            retrievalPrompt: slot.retrievalPrompt ||
              hint.template(focus, detail),
          });
        });
        plan[pattern.id] = slots;
        continue;
      }

      for (let index = 0; index < pattern.groups.length; index++) {
        const toneDigit = pattern.groups[index];
        const posSeed = DEFAULT_POS_SEQUENCE[index % DEFAULT_POS_SEQUENCE.length];
        const normalizedPos = this.normalizePosTag(posSeed) ?? "NOUN";
        const hint = POS_HINTS[normalizedPos] ?? POS_HINTS.NOUN;
        const detail = FALLBACK_SLOT_THEMES[index % FALLBACK_SLOT_THEMES.length];
        slots.push({
          id: `${pattern.id}_slot_${index}`,
          toneDigit,
          posTag: normalizedPos,
          description: `${detail}-${hint.label}`,
          retrievalPrompt: hint.template(focus, detail),
        });
      }
      plan[pattern.id] = slots;
    }
    return plan;
  }

  private async buildPatternSlotPlan(
    patterns: SegmentationPattern[],
    intent: SceneIntent,
  ): Promise<Record<string, PatternSlot[]>> {
    if (!patterns || patterns.length === 0) return {};
    const fallbackPlan = this.buildFallbackSlots(patterns, intent);
    if (!this.geminiApiKey) return fallbackPlan;
    if (!this.genAI) {
      this.genAI = new GoogleGenAI({ apiKey: this.geminiApiKey });
    }

    const result: Record<string, PatternSlot[]> = {};
    for (const pattern of patterns) {
      const fallbackSlots = fallbackPlan[pattern.id] ?? [];
      const schema = {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            toneDigit: { type: "string" },
            posTag: { type: "string" },
            description: { type: "string" },
            retrievalPrompt: { type: "string" },
          },
          required: ["posTag", "retrievalPrompt"],
        },
        minItems: pattern.groups.length,
        maxItems: pattern.groups.length,
      } as const;

      const instruction = [
        "你是一名粵語歌詞詞性規劃助手。",
        `主題：${intent.title}`,
        `微場景：${intent.microIntent}`,
        `情緒：${(intent.emotions || []).join("、")}`,
        `聲調分組：${pattern.patternString}`,
        "請為每個分組建立詞性槽位，輸出 JSON 陣列，每格包含 index、toneDigit、posTag(大寫)、description(≤12字)、retrievalPrompt(10-20字粵語描述)。",
        "POS 僅可使用：NOUN, VERB, ADJ, ADV, PRON, PART, CONJ, DET, NUM, AUX, ADP, SCONJ, PROPN, INTJ, X。",
        "retrievalPrompt 請用粵語或繁體中文，描述要檢索的詞語，例如「描述期待重逢的好友」。",
        "僅輸出 JSON。",
      ].join("\n");

      try {
        const response = await this.genAI.models.generateContent({
          model: this.geminiSceneModel,
          contents: instruction,
          config: {
            temperature: 0.45,
            maxOutputTokens: 400,
            responseMimeType: "application/json",
            responseJsonSchema: schema as unknown,
          },
        });
        const text = this.extractText(response);
        if (!text) throw new Error("Empty slot response");
        const jsonStart = text.indexOf("[");
        const jsonEnd = text.lastIndexOf("]");
        const slice = text.slice(
          jsonStart !== -1 ? jsonStart : 0,
          jsonEnd !== -1 ? jsonEnd + 1 : text.length,
        );
        const parsed = JSON.parse(slice);
        if (!Array.isArray(parsed)) throw new Error("Invalid slot JSON");
        const slots: PatternSlot[] = [];
        for (let index = 0; index < pattern.groups.length; index++) {
          const toneDigit = pattern.groups[index];
          const raw = parsed[index] ?? {};
          const normalizedPos = this.normalizePosTag(raw.posTag) ??
            fallbackSlots[index]?.posTag ?? "NOUN";
          const detail = FALLBACK_SLOT_THEMES[index % FALLBACK_SLOT_THEMES.length];
          const hint = POS_HINTS[normalizedPos] ?? POS_HINTS.NOUN;
          const description = typeof raw.description === "string" &&
              raw.description.trim().length > 0
            ? raw.description.trim()
            : (fallbackSlots[index]?.description ??
              `${detail}-${hint.label}`);
          const retrievalPrompt = typeof raw.retrievalPrompt === "string" &&
              raw.retrievalPrompt.trim().length > 0
            ? raw.retrievalPrompt.trim()
            : (fallbackSlots[index]?.retrievalPrompt ??
              hint.template(
                intent.microIntent || intent.title || "這個場景",
                detail,
              ));
          slots.push({
            id: `${pattern.id}_slot_${index}`,
            toneDigit: String(
              raw.toneDigit || toneDigit || fallbackSlots[index]?.toneDigit ||
                "",
            ),
            posTag: normalizedPos,
            description,
            retrievalPrompt,
          });
        }
        result[pattern.id] = slots;
      } catch (err) {
        console.warn(
          `Slot inference failed for pattern ${pattern.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        result[pattern.id] = fallbackSlots;
      }
    }

    return result;
  }

  private async semanticSearchForDigit(
    queries: string[],
    digit: string,
    budget: number,
    minSimilarity?: number,
    options?: { posTag?: string; slot?: PatternSlot },
  ): Promise<
    Array<{
      surface: string;
      similarity: number;
      freq?: number;
      posTag?: string;
      slotId?: string;
      prompt?: string;
    }>
  > {
    if (!this.chromaClient) {
      throw new Error(LyricErrorCode.ERROR_DATABASE_UNAVAILABLE);
    }
    await this.ensureChromaCollection();
    const coll = this.chromaCollection!;
    // Align with scripts/test-chroma.ts: build where dynamically and pass only when non-empty
    const filters: Array<Record<string, unknown>> = [];
    if (digit) {
      filters.push({ pronunciation: { "$eq": String(digit) } });
    }
    if (options?.posTag) {
      filters.push({ pos: { "$eq": String(options.posTag).toUpperCase() } });
    }
    let where: Record<string, unknown> | undefined;
    if (filters.length === 1) where = filters[0];
    else if (filters.length > 1) where = { "$and": filters };
    const perQuery = Math.max(
      5,
      Math.ceil(budget / Math.max(1, queries.length)) * 2,
    );
    const merged: Record<
      string,
      { surface: string; similarity: number; freq?: number; pos?: string }
    > = {};
    let usedServerFilter = false;
    for (const q of queries) {
      const emb = await this.embed(q);
      const res = await coll.query({
        queryEmbeddings: [emb],
        nResults: perQuery,
        include: ["documents", "metadatas", "distances"],
        where: where ? ((usedServerFilter = true), (where as any)) : undefined,
      });
      const docs = res.documents?.[0] ?? [];
      const metas = res.metadatas?.[0] ?? [];
      const dists = res.distances?.[0] ?? [];
      for (let i = 0; i < docs.length; i++) {
        const md = metas[i] as any;
        // Defensive post-filter to ensure digit alignment by metadata
        if (
          md && md.pronunciation && String(md.pronunciation) !== String(digit)
        ) continue;
        const surface = (md?.surface as string) ?? String(docs[i] ?? "");
        const sim = dists[i] != null ? 1 - Number(dists[i]) : 0;
        const prev = merged[surface];
        if (!prev || sim > prev.similarity) {
          merged[surface] = {
            surface,
            similarity: sim,
            freq: md?.freq,
            pos: typeof md?.pos === "string" ? md.pos.toUpperCase() : undefined,
          };
        }
      }
    }
    // If nothing found and server-side filter was used, retry queries without the where filter then post-filter locally by digit
    if (Object.keys(merged).length === 0 && usedServerFilter) {
      for (const q of queries) {
        const emb = await this.embed(q);
        const res = await coll.query({
          queryEmbeddings: [emb],
          nResults: perQuery,
          include: ["documents", "metadatas", "distances"],
          where: undefined,
        });
        const docs = res.documents?.[0] ?? [];
        const metas = res.metadatas?.[0] ?? [];
        const dists = res.distances?.[0] ?? [];
        for (let i = 0; i < docs.length; i++) {
          const md = metas[i] as any;
          if (
            md && md.pronunciation && String(md.pronunciation) !== String(digit)
          ) continue;
          const surface = (md?.surface as string) ?? String(docs[i] ?? "");
          const sim = dists[i] != null ? 1 - Number(dists[i]) : 0;
          const prev = merged[surface];
          if (!prev || sim > prev.similarity) {
            merged[surface] = {
              surface,
              similarity: sim,
              freq: md?.freq,
              pos: typeof md?.pos === "string" ? md.pos.toUpperCase() : undefined,
            };
          }
        }
      }
    }
    // Sort and apply similarity threshold post-hoc with adaptive relaxation
    const all = Object.values(merged).sort((a, b) => b.similarity - a.similarity);
    if (minSimilarity == null) {
      return all.slice(0, budget * 3).map((item) => ({
        surface: item.surface,
        similarity: item.similarity,
        freq: item.freq,
        posTag: item.pos ?? options?.posTag,
        slotId: options?.slot?.id,
        prompt: options?.slot?.retrievalPrompt,
      }));
    }
    let filtered = all.filter((x) => x.similarity >= minSimilarity);
    if (filtered.length === 0) {
      const relaxed = Math.max(0.5, minSimilarity - 0.1);
      filtered = all.filter((x) => x.similarity >= relaxed);
    }
    return (filtered.length ? filtered : all).slice(0, budget * 3).map((
      item,
    ) => ({
      surface: item.surface,
      similarity: item.similarity,
      freq: item.freq,
      posTag: item.pos ?? options?.posTag,
      slotId: options?.slot?.id,
      prompt: options?.slot?.retrievalPrompt,
    }));
  }

  private async getFrequencyEnrichmentForDigit(
    digit: string,
    cfg: RetrievalConfig,
  ): Promise<
    {
      top: Array<{ surface: string; freq: number }>;
      randomSlice: Array<{ surface: string; freq: number }>;
    }
  > {
    if (!this.prisma) {
      throw new Error(LyricErrorCode.ERROR_DATABASE_UNAVAILABLE);
    }
    // Fetch a window sorted by freq desc for the pronunciation digit
    const limitWindow = 200; // enough to cover top 100 and some buffer
    const readings = await this.prisma.reading.findMany({
      where: { pronunciation: { equals: digit } },
      include: { entry: true },
      orderBy: [{ freq: "desc" }],
      take: limitWindow,
    });
    const items = readings
      .map((r) => ({
        surface: String((r as any).entry?.surface ?? ""),
        freq: Number((r as any).freq ?? 0),
      }))
      .filter((it) => !!it.surface);
    // Top fixed 10
    const topFixedCount = Math.min(10, items.length);
    const top = items.slice(0, topFixedCount);
    // Random from ranks 11..100 to fill up to cfg.freqTop (default 100 total)
    const endRank = Math.min(items.length, 100);
    const slice = items.slice(10, endRank); // 0-based index: 10..(endRank-1) => ranks 11..endRank
    const wantTotal = Math.max(0, (cfg.freqTop || 100) - topFixedCount);
    const want = Math.min(wantTotal, slice.length);
    const randomSlice: Array<{ surface: string; freq: number }> = [];
    for (let i = 0; i < want; i++) {
      if (slice.length === 0) break;
      const idx = Math.floor(Math.random() * slice.length);
      randomSlice.push(slice[idx]);
      slice.splice(idx, 1);
    }
    return { top, randomSlice };
  }

  // Global frequency picks, not tied to any digit
  private async getGlobalFrequencyPicks(): Promise<{
    topWords50: Array<{ surface: string; freq: number }>;
    topChars50: Array<{ surface: string; freq: number }>;
    randWords25: Array<{ surface: string; freq: number }>;
    randChars25: Array<{ surface: string; freq: number }>;
  }> {
    if (!this.prisma) {
      throw new Error(LyricErrorCode.ERROR_DATABASE_UNAVAILABLE);
    }
    // Fetch a wide window of readings globally, then deduplicate by surface (keep highest freq)
    const limitWindow = 4000;
    const readings = await this.prisma.reading.findMany({
      include: { entry: true },
      orderBy: [{ freq: "desc" }],
      take: limitWindow,
    });
    const dedup: Map<string, number> = new Map(); // surface -> freq
    for (const r of readings as any[]) {
      const surface = String(r.entry?.surface ?? "");
      const freq = Number(r.freq ?? 0);
      if (!surface) continue;
      if (!dedup.has(surface)) dedup.set(surface, freq);
    }
    const all = Array.from(dedup.entries()).map(([surface, freq]) => ({
      surface,
      freq,
    }))
      .sort((a, b) => b.freq - a.freq);
    const words = all.filter((x) => x.surface.length > 1);
    const chars = all.filter((x) => x.surface.length === 1);

    const topWords50 = words.slice(0, 50);
    const topChars50 = chars.slice(0, 50);

    // Ranks 26..500 (1-based) => indexes 25..499
    const wordSlice = words.slice(25, Math.min(words.length, 500));
    const charSlice = chars.slice(25, Math.min(chars.length, 500));
    const sample = (
      arr: Array<{ surface: string; freq: number }>,
      n: number,
    ) => {
      const out: Array<{ surface: string; freq: number }> = [];
      const pool = arr.slice();
      const count = Math.min(n, pool.length);
      for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        out.push(pool[idx]);
        pool.splice(idx, 1);
      }
      return out;
    };
    const randWords25 = sample(wordSlice, 25);
    const randChars25 = sample(charSlice, 25);

    return { topWords50, topChars50, randWords25, randChars25 };
  }

  private extractText(response: any): string | undefined {
    try {
      if (!response) return undefined;
      if (typeof response.text === "string" && response.text.trim()) {
        return response.text;
      }

      const maybeResp = response.response ?? response;
      if (maybeResp && typeof maybeResp.text === "function") {
        const t = maybeResp.text();
        if (typeof t === "string" && t.trim()) return t;
      }

      const candidates = maybeResp?.candidates ?? response?.candidates;
      if (Array.isArray(candidates) && candidates.length) {
        for (const c of candidates) {
          const contentItems = c?.content ? Array.isArray(c.content) ? c.content : [c.content] : [];
          for (const content of contentItems) {
            const parts = content?.parts ?? c?.parts ?? [];
            if (Array.isArray(parts) && parts.length) {
              for (const p of parts) {
                if (typeof p?.text === "string" && p.text.trim()) return p.text;
              }
            }
          }
          if (typeof c?.text === "string" && c.text.trim()) return c.text;
        }
      }

      if (
        typeof maybeResp?.output_text === "string" &&
        maybeResp.output_text.trim()
      ) {
        return maybeResp.output_text;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}

export default RetrievalService;
