// Paragraph beam search assembly (pure)
import {
  createParagraphVariant,
  LineResult,
  ParagraphVariant,
  SentenceCandidate,
  sortSentencesByLineIndex,
} from "./entities.ts";
import { safeNormalizeScore } from "./validation.ts";

interface BeamNode {
  sentences: SentenceCandidate[]; // ordered by line index
  coherence: number;
  emotional: number;
  diversity: number;
  final: number;
}

function computeCoherence(prev: SentenceCandidate | undefined, current: SentenceCandidate): number {
  // Use continuityScore if provided else heuristic with relevanceScore
  const base = safeNormalizeScore(current.continuityScore ?? current.relevanceScore ?? 0.5);
  if (!prev) return base;
  const delta = Math.abs((prev.emotionalArcScore ?? 0.5) - (current.emotionalArcScore ?? 0.5));
  const smoothness = 1 - delta; // closer emotional scores => higher coherence
  return (base * 0.6 + smoothness * 0.4);
}

function computeDiversity(sentences: SentenceCandidate[]): number {
  if (sentences.length === 0) return 0;
  const sum = sentences.reduce(
    (acc, s) => acc + safeNormalizeScore(s.diversityScore ?? (1 - (s.diversityPenalty ?? 0))),
    0,
  );
  return sum / sentences.length;
}

function computeEmotionalArc(sentences: SentenceCandidate[]): number {
  if (sentences.length === 0) return 0;
  // simple: average emotionalArcScore penalized by variance (stable arcs score higher)
  const scores = sentences.map((s) => safeNormalizeScore(s.emotionalArcScore ?? 0.5));
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
  return mean * (1 - variance * 0.5);
}

function extendBeam(node: BeamNode, candidate: SentenceCandidate): BeamNode {
  const prev = node.sentences.length ? node.sentences[node.sentences.length - 1] : undefined;
  const coherence = (node.coherence * node.sentences.length + computeCoherence(prev, candidate)) /
    (node.sentences.length + 1);
  const sentences = [...node.sentences, candidate];
  const emotional = computeEmotionalArc(sentences);
  const diversity = computeDiversity(sentences);
  const final = 0.5 * coherence + 0.3 * emotional + 0.2 * diversity;
  return { sentences, coherence, emotional, diversity, final };
}

export function assembleParagraphs(lines: LineResult[], beamWidth: number): ParagraphVariant[] {
  if (lines.length === 0) return [];
  const sortedLines = sortSentencesByLineIndex(lines);
  let beam: BeamNode[] = [{ sentences: [], coherence: 0, emotional: 0, diversity: 0, final: 0 }];

  for (const line of sortedLines) {
    if (line.candidates.length === 0) return [];
    const next: BeamNode[] = [];
    for (const node of beam) {
      for (const cand of line.candidates) {
        next.push(extendBeam(node, cand));
      }
    }
    // Prune to beam width deterministically
    next.sort((a, b) =>
      b.final - a.final ||
      a.sentences.map((s) => s.id).join("").localeCompare(b.sentences.map((s) => s.id).join(""))
    );
    beam = next.slice(0, beamWidth);
  }

  // Map to ParagraphVariant
  const variants: ParagraphVariant[] = beam.map((node) =>
    createParagraphVariant(node.sentences, {
      coherence: node.coherence,
      emotional: node.emotional,
      diversity: node.diversity,
      final: node.final,
    })
  );

  // Sort final variants by finalScore desc
  variants.sort((a, b) => b.finalScore - a.finalScore || a.id.localeCompare(b.id));
  return variants.slice(0, beamWidth);
}
