// Maximal Marginal Relevance (MMR) selection logic (pure)
import { SentenceCandidate } from "../entities.ts";
import { safeNormalizeScore } from "../validation.ts";

export function selectWithMMR(
  sentences: SentenceCandidate[],
  lambda: number,
  targetCount: number,
): SentenceCandidate[] {
  if (sentences.length === 0) return [];
  if (targetCount <= 0) return [];
  const cappedTarget = Math.min(targetCount, sentences.length);

  // Normalize needed fields
  const pool = sentences.map((s) => ({
    ...s,
    relevanceScore: safeNormalizeScore(s.relevanceScore ?? 0),
    diversityPenalty: safeNormalizeScore(s.diversityPenalty ?? 0),
  }));

  // Sort by relevance for deterministic first pick (stable)
  pool.sort((a, b) => (b.relevanceScore! - a.relevanceScore!) || a.id.localeCompare(b.id));

  const selected: SentenceCandidate[] = [];

  while (selected.length < cappedTarget && pool.length > 0) {
    if (selected.length === 0) {
      selected.push(pool.shift()!);
      continue;
    }

    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i];
      // Diversity: penalty increases if candidate similar to already selected; we approximate using average diversityPenalty
      const avgPenalty = selected.reduce((acc, s) => acc + (s.diversityPenalty ?? 0), 0) /
        selected.length;
      // MMR scoring: lambda * relevance - (1-lambda) * similarityPenalty (here using candidate penalty + avgPenalty)/2
      const diversityComponent = ((cand.diversityPenalty ?? 0) + avgPenalty) /
        2;
      const mmrScore = lambda * (cand.relevanceScore ?? 0) -
        (1 - lambda) * diversityComponent;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    const chosen = pool.splice(bestIdx, 1)[0];
    selected.push(chosen);
  }

  return selected;
}
