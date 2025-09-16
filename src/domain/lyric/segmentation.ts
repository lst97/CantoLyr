// Segmentation algorithm producing exactly 3 deterministic patterns
import { createSegmentationPattern, SegmentationPattern } from "./entities.ts";
import { validateSegmentationPattern } from "./validation.ts";
import { createSeedRng } from "../../shared/utils/seed-rng.ts";

// Allowed digits: any combination of 0,2,3,4,5,9 for groups of 1-4 digits.
// Probabilities: 50% single digit, 40% double, 5% triple, 5% quadruple.

const ALLOWED_DIGITS = new Set(["0", "2", "3", "4", "5", "9"]);
const GROUP_SIZE_PROBS = [
  { size: 1, prob: 0.50 },
  { size: 2, prob: 0.40 },
  { size: 3, prob: 0.05 },
  { size: 4, prob: 0.05 },
];

function isValidGroup(g: string): boolean {
  return g.length >= 1 && g.length <= 4 && [...g].every((ch) => ALLOWED_DIGITS.has(ch));
}

function greedyPairs(seq: string): string[] {
  const groups: string[] = [];
  for (let i = 0; i < seq.length;) {
    if (i + 1 < seq.length && ALLOWED_DIGITS.has(seq[i]) && ALLOWED_DIGITS.has(seq[i + 1])) {
      const group = seq.slice(i, i + 2);
      if (!groups.includes(group)) {
        groups.push(group);
        i += 2;
      } else {
        groups.push(seq[i]);
        i += 1;
      }
    } else {
      const group = seq[i];
      if (!groups.includes(group)) {
        groups.push(group);
        i += 1;
      } else {
        i += 1; // skip duplicate
      }
    }
  }
  return groups;
}

function alternatingStartOne(seq: string): string[] {
  const groups: string[] = [];
  let i = 0;
  let toggle = true; // true => 1 digit, false => 2 digits
  while (i < seq.length) {
    if (toggle) {
      const group = seq[i];
      if (!groups.includes(group)) {
        groups.push(group);
        i += 1;
      } else {
        i += 1; // skip duplicate
      }
    } else {
      if (i + 1 < seq.length && ALLOWED_DIGITS.has(seq[i]) && ALLOWED_DIGITS.has(seq[i + 1])) {
        const group = seq.slice(i, i + 2);
        if (!groups.includes(group)) {
          groups.push(group);
          i += 2;
        } else {
          const single = seq[i];
          if (!groups.includes(single)) {
            groups.push(single);
            i += 1;
          } else {
            i += 1; // skip
          }
        }
      } else {
        const group = seq[i];
        if (!groups.includes(group)) {
          groups.push(group);
          i += 1;
        } else {
          i += 1; // skip duplicate
        }
      }
    }
    toggle = !toggle;
  }
  return groups;
}

function alternatingStartTwo(seq: string): string[] {
  const groups: string[] = [];
  let i = 0;
  let toggle = true; // true => 2 digits, false => 1 digit
  while (i < seq.length) {
    if (toggle) {
      if (i + 1 < seq.length && ALLOWED_DIGITS.has(seq[i]) && ALLOWED_DIGITS.has(seq[i + 1])) {
        const group = seq.slice(i, i + 2);
        if (!groups.includes(group)) {
          groups.push(group);
          i += 2;
        } else {
          const single = seq[i];
          if (!groups.includes(single)) {
            groups.push(single);
            i += 1;
          } else {
            i += 1; // skip
          }
        }
      } else {
        const group = seq[i];
        if (!groups.includes(group)) {
          groups.push(group);
          i += 1;
        } else {
          i += 1; // skip duplicate
        }
      }
    } else {
      const group = seq[i];
      if (!groups.includes(group)) {
        groups.push(group);
        i += 1;
      } else {
        i += 1; // skip duplicate
      }
    }
    toggle = !toggle;
  }
  return groups;
}

function hashToSeed(str: string): number {
  // simple deterministic hash -> positive 32-bit integer, ensure >0
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // avoid zero seed
  return (h & 0x7fffffff) + 1;
}

function randomMixAllowed(seq: string, rnd: { random: () => number }): string[] {
  const groups: string[] = [];
  for (let i = 0; i < seq.length;) {
    const r = rnd.random();
    let size = 1;
    let cumProb = 0;
    for (const { size: s, prob } of GROUP_SIZE_PROBS) {
      cumProb += prob;
      if (r < cumProb) {
        size = s;
        break;
      }
    }
    const end = Math.min(i + size, seq.length);
    const group = seq.slice(i, end);
    if (isValidGroup(group) && !groups.includes(group)) {
      groups.push(group);
      i = end;
    } else {
      // fallback to single digit if invalid or duplicate
      const single = seq[i];
      if (!groups.includes(single)) {
        groups.push(single);
        i += 1;
      } else {
        i += 1; // skip duplicate
      }
    }
  }
  return groups;
}

function maybeSplitOneComposite(groups: string[], rnd: { random: () => number }): string[] {
  const out = [...groups];
  const compositeIdx = out.findIndex((g) => g.length > 1);
  if (compositeIdx >= 0 && rnd.random() < 0.5) {
    const g = out[compositeIdx];
    let newGroups: string[] = [];
    if (g.length === 2) {
      newGroups = [g[0], g[1]];
    } else if (g.length === 3) {
      newGroups = [g[0], g.slice(1)];
    } else if (g.length === 4) {
      newGroups = [g.slice(0, 2), g.slice(2)];
    }
    // Check if any new group is already in out
    const canSplit = newGroups.every((ng) => !out.includes(ng));
    if (canSplit) {
      out.splice(compositeIdx, 1, ...newGroups);
    }
    // else leave as is
  }
  return out;
}

export function generatePatterns(toneSequence: string, seed?: number): SegmentationPattern[] {
  if (!/^[0-9]+$/.test(toneSequence)) throw new Error("Tone sequence must be digits");
  if (toneSequence.length === 0) throw new Error("Tone sequence empty");

  const effSeed = seed ? seed : hashToSeed("SEG:" + toneSequence);
  const rng = createSeedRng(effSeed);

  // Base candidates
  const candidates: string[][] = [];
  candidates.push(greedyPairs(toneSequence));
  candidates.push(alternatingStartOne(toneSequence));
  candidates.push(alternatingStartTwo(toneSequence));

  // Seeded variants
  candidates.push(randomMixAllowed(toneSequence, rng));
  // Mutated variants (split a composite sometimes)
  candidates.push(maybeSplitOneComposite(greedyPairs(toneSequence), rng));

  // Dedupe by pattern string
  const seen = new Set<string>();
  const unique: string[][] = [];
  for (const g of candidates) {
    const key = g.join(" ");
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(g);
    }
  }

  // Shuffle deterministically and pick first 3
  const idxs = unique.map((_, i) => i);
  // Fisher-Yates using rng
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(rng.random() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  const chosen = idxs.slice(0, 3).map((i) => unique[i]);
  while (chosen.length < 3) {
    // fallback: fill with alternatingStartOne to ensure exactly 3
    chosen.push(alternatingStartOne(toneSequence));
  }

  const patterns = chosen.map((g, i) => createSegmentationPattern(g, i));
  for (const ptn of patterns) validateSegmentationPattern(ptn);
  return patterns;
}
