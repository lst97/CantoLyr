import { describe, it, expect } from "vitest";
import type { ReadingDTO } from "../../../../src/application/ports/ReadingRepo.js";
import { prefilterGroupsByTone } from "../../../../src/application/services/mvpPrefilter.js";

function makeReading(overrides: Partial<ReadingDTO> = {}): ReadingDTO {
  const base: ReadingDTO = {
    id: BigInt(1),
    entryId: BigInt(1),
    surface: "愛",
    type: "char",
    lang: "zh-HK",
    jyutping: "oi3",
    toneOriginal: "3",
    toneMapped: "0",
    syllables: 1,
    freq: 10,
    pos: "NOUN",
    register: "neutral",
    gloss: "love",
    source: "test",
  };
  return { ...base, ...overrides };
}

describe("prefilterGroupsByTone (MVP)", () => {
  it("splits tone pattern into groups and limits per group", async () => {
    const pool: ReadingDTO[] = [];
    for (let i = 0; i < 500; i++) {
      pool.push(
        makeReading({
          id: BigInt(i + 1),
          entryId: BigInt(1000 + i),
          surface: `字${i}`,
          freq: i, // ascending freq
          toneMapped: "0",
          jyutping: `zi${(i % 6) + 1}`,
        })
      );
    }

    const fetchByTone = async (tone: string) => {
      expect(tone).toBe("0");
      // ignore limit and return the pool
      return pool;
    };

    const groups = await prefilterGroupsByTone("0", fetchByTone, 100, 42);
    expect(groups.length).toBe(1);
    const g = groups[0];
    expect(g?.pattern).toBe("0");
    expect(g?.groupIndex).toBe(1);
    expect(g?.options.length).toBeLessThanOrEqual(100);
    // options are 1-based
    expect(g?.options[0]?.option).toBe(1);
    expect(g?.options[g.options.length - 1]?.option).toBe(g?.options.length);
    // only surfaces passed, ids retained locally
    expect(typeof g?.options[0]?.surface).toBe("string");
    expect(typeof g?.options[0]?.readingId).toBe("bigint");
  });

  it("for single-digit pattern: ~70% top by freq + 30% random remainder", async () => {
    const N = 100;
    const pool: ReadingDTO[] = [];
    for (let i = 0; i < N; i++) {
      pool.push(
        makeReading({
          id: BigInt(i + 1),
          entryId: BigInt(2000 + i),
          surface: `甲${i}`,
          freq: i, // higher index = higher freq
          toneMapped: "3",
          jyutping: `gaap${(i % 6) + 1}`,
        })
      );
    }
    const fetchByTone = async () => pool;

    const maxPerGroup = 50;
    const groups = await prefilterGroupsByTone(
      "3",
      fetchByTone,
      maxPerGroup,
      123
    );
    const g = groups[0];
    // 70% top by freq
    const topCount = Math.floor(maxPerGroup * 0.7);
    const optionIds = new Set(g?.options.map((o) => Number(o.readingId)));
    const topByFreqIds = new Set(
      pool
        .sort((a, b) => b.freq - a.freq)
        .slice(0, topCount)
        .map((r) => Number(r.id))
    );

    let inTop = 0;
    for (const id of optionIds) if (topByFreqIds.has(id)) inTop++;
    // at least the top segment should be heavily represented
    expect(inTop).toBeGreaterThanOrEqual(topCount - 2); // allow small variance
  });

  it("for multi-digit pattern: uniform random sample and dedupe by surface (keep highest freq)", async () => {
    // build duplicates by surface with different freq
    const pool: ReadingDTO[] = [];
    for (let i = 0; i < 20; i++) {
      pool.push(
        makeReading({
          id: BigInt(i + 1),
          surface: `同${i}`,
          freq: i,
          toneMapped: "22",
          jyutping: "tung4",
        })
      );
      pool.push(
        makeReading({
          id: BigInt(100 + i),
          surface: `同${i}`,
          freq: 1000 + i,
          toneMapped: "22",
          jyutping: "tung4",
        })
      );
    }
    const fetchByTone = async () => pool;
    const groups = await prefilterGroupsByTone("22", fetchByTone, 25, 7);
    expect(groups.length).toBe(1);
    const g = groups[0]!;
    // After dedupe, each surface appears once, and the kept freq should be the higher one
    const surfaces = new Map<string, number>();
    for (const o of g.options) {
      expect(surfaces.has(o.surface)).toBe(false);
      surfaces.set(o.surface, o.freq ?? 0);
    }
    // Frequencies should be from the higher set (>= 1000)
    for (const f of surfaces.values()) expect(f).toBeGreaterThanOrEqual(1000);
  });
});
