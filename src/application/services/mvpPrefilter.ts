import type { ReadingDTO } from "../../application/ports/ReadingRepo.ts";

export type GroupedOption = {
  option: number; // 1-based index used in the prompt
  surface: string; // only the text goes to the LLM
  readingId: bigint; // used locally to map selection back
  freq?: number;
};

export type Group = {
  groupIndex: number; // 1-based group index in order
  pattern: string; // tone pattern for this group (e.g., "00" or "3")
  options: GroupedOption[]; // up to maxPerGroup options
};

export type FetchByTone = (
  toneMapped: string,
  limit: number,
) => Promise<ReadingDTO[]>;

/**
 * Port interface for prefiltering services
 */
export interface PrefilterService {
  prefilterGroupsByTone(
    tonePattern: string,
    fetchByTone: FetchByTone,
    maxPerGroup?: number,
    seed?: number,
  ): Promise<Group[]>;
}

/**
 * MVP prefilter:
 * - Split tone pattern by spaces into groups
 * - For 1-digit groups: 70% highest freq + 30% random from remainder
 * - For multi-digit groups: uniform random sample
 * - Deduplicate by surface (keep highest freq)
 * - Cap each group to maxPerGroup (default 100)
 *
 * Only the surface text is sent to the LLM; we keep a local mapping to readingId.
 */
export async function prefilterGroupsByTone(
  tonePattern: string,
  fetchByTone: FetchByTone,
  maxPerGroup = 100,
  seed?: number,
): Promise<Group[]> {
  const rng = seededRng(seed);
  const groups = tonePattern
    .split(" ")
    .map((g) => g.trim())
    .filter(Boolean);

  const results: Group[] = [];

  for (let i = 0; i < groups.length; i++) {
    const patternMaybe = groups[i];
    if (!patternMaybe) {
      // Defensive: skip if indexing produced undefined (noUncheckedIndexedAccess)
      continue;
    }
    const pattern: string = patternMaybe;

    // Fetch a larger pool so randomness has room; the backend can cap.
    const poolLimit = Math.max(maxPerGroup * 4, 1000);
    const pool = await fetchByTone(pattern, poolLimit);

    const deduped = dedupeBySurfaceKeepTopFreq(pool);

    let selected: ReadingDTO[] = [];
    if (pattern.length === 1) {
      // 70% by freq, 30% random from the rest
      const sorted = [...deduped].sort((a, b) => b.freq - a.freq);
      const topCount = Math.min(Math.floor(maxPerGroup * 0.7), sorted.length);
      const top = sorted.slice(0, topCount);
      const remaining = sorted.slice(topCount);
      const randomCount = Math.max(
        0,
        Math.min(maxPerGroup - top.length, remaining.length),
      );
      const rand = uniformSample(remaining, randomCount, rng);
      selected = [...top, ...rand];
    } else {
      // Uniform random for multi-syllable patterns
      const k = Math.min(maxPerGroup, deduped.length);
      selected = uniformSample(deduped, k, rng);
    }

    const options: GroupedOption[] = selected.map((r, idx) => ({
      option: idx + 1,
      surface: r.surface,
      readingId: r.id,
      freq: r.freq,
    }));

    results.push({ groupIndex: i + 1, pattern, options });
  }

  return results;
}

function dedupeBySurfaceKeepTopFreq(items: ReadingDTO[]): ReadingDTO[] {
  const bySurface = new Map<string, ReadingDTO>();
  for (const r of items) {
    const existing = bySurface.get(r.surface);
    if (!existing || r.freq > existing.freq) {
      bySurface.set(r.surface, r);
    }
  }
  return Array.from(bySurface.values());
}

function uniformSample<T>(arr: T[], k: number, rng: () => number): T[] {
  if (k >= arr.length) return [...arr];
  // Reservoir sampling for efficiency
  const result: T[] = [];
  let count = 0;
  for (const item of arr) {
    count++;
    if (result.length < k) {
      result.push(item);
    } else {
      const j = Math.floor(rng() * count);
      if (j < k) result[j] = item;
    }
  }
  return result;
}

function seededRng(seed?: number): () => number {
  if (typeof seed !== "number") return Math.random;
  // Simple LCG for reproducibility
  let s = (seed >>> 0) || 1;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return (s & 0xffffffff) / 0x100000000;
  };
}
