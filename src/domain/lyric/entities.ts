// Domain Entities & Value Objects for Cantonese Tone-Constrained Lyric Generation
// NOTE: Keep this file PURE (no external side-effects). Only types, interfaces, simple factories.

export type ToneDigit = string; // single tone digit (0-9) as string for flexibility
export type ToneGroup = string; // group of 1-2 tone digits (e.g., "22", "5", "39")

export interface ToneSequence {
  original: string; // raw sequence string e.g. "2253394259"
  groups: ToneGroup[]; // segmentation groups (1-2 digits) optional depending on pattern
}

export interface PatternSlot {
  id: string; // e.g. `${patternId}_slot_${index}`
  toneDigit: ToneGroup;
  posTag: string; // canonical uppercase POS tag (e.g., NOUN, VERB, ADJ)
  description: string; // short description of the slot role
  retrievalPrompt: string; // natural-language hint for semantic retrieval
}

export interface SegmentationPattern {
  id: string; // deterministic id from algorithm (e.g., hash or incremental)
  groups: ToneGroup[]; // e.g. ["22","53","39","42","59"]
  patternString: string; // groups joined by space for readability
  slots?: PatternSlot[]; // optional slot metadata provided at retrieval time
}

export interface SceneIntent {
  id: string;
  label: string; // e.g. "nostalgia", "longing"
  confidence?: number; // optional from LLM classifier
}

export interface LexicalCandidate {
  id: string; // stable id (e.g. word id)
  text: string;
  frequency?: number; // corpus frequency
  semanticScore?: number; // similarity score vs query
}

export interface SentenceCandidate {
  id: string;
  text: string;
  relevanceScore?: number; // retrieval relevance or LLM prior
  diversityPenalty?: number; // used during MMR
  continuityScore?: number; // coherence with previous line
  emotionalArcScore?: number; // alignment with emotional trajectory
  diversityScore?: number; // used in paragraph beam diversity
  tonePattern?: ToneGroup[]; // actual tone groups derived from text mapping
}

export interface LineResult {
  lineIndex: number;
  candidates: SentenceCandidate[];
}

export interface ParagraphVariant {
  id: string; // stable ID derived from sentence ids joined
  sentences: SentenceCandidate[]; // ordered by line index asc
  coherenceScore: number;
  emotionalArcScore: number;
  diversityScore: number;
  finalScore: number; // composite scoring used for ranking paragraphs
}

export interface GenerationSession {
  sessionId: string;
  seed: number;
  createdAt: string;
  toneSequence: string; // overall target tone sequence (per line or piece)
  lines: LineResult[];
  intents?: SceneIntent[];
  metadata?: Record<string, unknown>;
}

// ---------- Factory Helpers (lightweight) ----------

export function createSegmentationPattern(groups: ToneGroup[], index: number): SegmentationPattern {
  return {
    id: `pat_${index}_${groups.join("_")}`,
    groups: [...groups],
    patternString: groups.join(" "),
    slots: [],
  };
}

export function createParagraphVariant(sentences: SentenceCandidate[], scores: {
  coherence: number;
  emotional: number;
  diversity: number;
  final?: number;
}): ParagraphVariant {
  const coherenceScore = scores.coherence;
  const emotionalArcScore = scores.emotional;
  const diversityScore = scores.diversity;
  const finalScore = scores.final ?? (
    0.5 * coherenceScore + 0.3 * emotionalArcScore + 0.2 * diversityScore
  );
  return {
    id: sentences.map((s) => s.id).join("__"),
    sentences: [...sentences],
    coherenceScore,
    emotionalArcScore,
    diversityScore,
    finalScore,
  };
}

export function createGenerationSession(
  init: Omit<GenerationSession, "createdAt"> & { createdAt?: string },
): GenerationSession {
  return {
    createdAt: init.createdAt ?? new Date().toISOString(),
    ...init,
  };
}

export function cloneLineResult(line: LineResult): LineResult {
  return { lineIndex: line.lineIndex, candidates: line.candidates.map((c) => ({ ...c })) };
}

export function sortSentencesByLineIndex(lines: LineResult[]): LineResult[] {
  return [...lines].sort((a, b) => a.lineIndex - b.lineIndex);
}
