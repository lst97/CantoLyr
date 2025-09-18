// Segmentation algorithm producing exactly 3 deterministic patterns
import { createSegmentationPattern, SegmentationPattern } from "./entities.ts";
import { validateSegmentationPattern } from "./validation.ts";
import { createSeedRng } from "../../shared/utils/seed-rng.ts";

// Allowed digits: any combination of 0,2,3,4,5,9 for groups of 1-2 digits.
// Probabilities: 50% single digit, 50% double digit. No 3- or 4-digit groups.

const ALLOWED_DIGITS = new Set(["0", "2", "3", "4", "5", "9"]);
const GROUP_SIZE_PROBS = [
  { size: 1, prob: 0.50 },
  { size: 2, prob: 0.50 },
];

function isValidGroup(g: string): boolean {
  return g.length >= 1 && g.length <= 2 &&
    [...g].every((ch) => ALLOWED_DIGITS.has(ch));
}

function greedyPairs(seq: string): string[] {
  const groups: string[] = [];
  for (let i = 0; i < seq.length;) {
    if (
      i + 1 < seq.length && ALLOWED_DIGITS.has(seq[i]) &&
      ALLOWED_DIGITS.has(seq[i + 1])
    ) {
      const group = seq.slice(i, i + 2);
      groups.push(group);
      i += 2;
    } else {
      const group = seq[i];
      groups.push(group);
      i += 1;
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
      groups.push(group);
      i += 1;
    } else {
      if (
        i + 1 < seq.length && ALLOWED_DIGITS.has(seq[i]) &&
        ALLOWED_DIGITS.has(seq[i + 1])
      ) {
        const group = seq.slice(i, i + 2);
        groups.push(group);
        i += 2;
      } else {
        const group = seq[i];
        groups.push(group);
        i += 1;
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
      if (
        i + 1 < seq.length && ALLOWED_DIGITS.has(seq[i]) &&
        ALLOWED_DIGITS.has(seq[i + 1])
      ) {
        const group = seq.slice(i, i + 2);
        groups.push(group);
        i += 2;
      } else {
        const group = seq[i];
        groups.push(group);
        i += 1;
      }
    } else {
      const group = seq[i];
      groups.push(group);
      i += 1;
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

function randomMixAllowed(
  seq: string,
  rnd: { random: () => number },
): string[] {
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
    if (isValidGroup(group)) {
      groups.push(group);
      i = end;
    } else {
      // fallback to single digit if invalid
      const single = seq[i];
      groups.push(single);
      i += 1;
    }
  }
  return groups;
}

function maybeSplitOneComposite(
  groups: string[],
  rnd: { random: () => number },
): string[] {
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
    // Replace the composite group with its split parts regardless of duplicates
    if (newGroups.length) {
      out.splice(compositeIdx, 1, ...newGroups);
    }
  }
  return out;
}

export function generatePatterns(
  toneSequence: string,
  seed?: number,
): SegmentationPattern[] {
  if (!/^[0-9]+$/.test(toneSequence)) {
    throw new Error("Tone sequence must be digits");
  }
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
  const addUnique = (g: string[]) => {
    const key = g.join(" ");
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(g);
    }
  };
  for (const g of candidates) addUnique(g);

  // Keep generating randomized variants until we have at least 3 unique patterns (or max attempts)
  let attempts = 0;
  const MAX_ATTEMPTS = 50;
  while (unique.length < 3 && attempts < MAX_ATTEMPTS) {
    attempts++;
    const v1 = randomMixAllowed(toneSequence, rng);
    addUnique(v1);
    if (unique.length >= 3) break;
    const v2 = maybeSplitOneComposite(greedyPairs(toneSequence), rng);
    addUnique(v2);
  }

  // Shuffle deterministically and pick first 3
  const idxs = unique.map((_, i) => i);
  // Fisher-Yates using rng
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(rng.random() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  const chosen = idxs.slice(0, 3).map((i) => unique[i]);
  // Absolute fallback: if still < 3 unique (very unlikely), synthesize variants deterministically
  while (chosen.length < 3) {
    const extra = alternatingStartOne(toneSequence);
    // Avoid duplicates if possible by tweaking with maybeSplitOneComposite
    const tweaked = maybeSplitOneComposite(extra, rng);
    const k = tweaked.join(" ");
    if (!seen.has(k)) {
      seen.add(k);
      chosen.push(tweaked);
    } else {
      // last resort: push extra even if duplicate to prevent infinite loop
      chosen.push(extra);
    }
  }

  const patterns = chosen.map((g, i) => createSegmentationPattern(g, i));
  for (const ptn of patterns) validateSegmentationPattern(ptn);
  return patterns;
}
