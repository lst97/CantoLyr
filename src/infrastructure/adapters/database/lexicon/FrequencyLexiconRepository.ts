// FrequencyLexiconRepository (Infrastructure Adapter)
// Provides high-frequency and random lexical sampling operations for retrieval stage.
// This is a placeholder which can wrap Prisma (if available) or an in-memory dataset injected at construction.

export interface FrequencyEntry {
  surface: string; // lexical surface form
  toneDigit: string; // mapped tone digit
  frequency: number; // larger = more frequent
}

export interface SeedRng {
  next(): number; // [0,1)
}

export interface FrequencyLexiconRepositoryConfig {
  entries?: FrequencyEntry[]; // Optional preloaded entries (e.g., from seed file)
  prismaClient?: unknown; // Future Prisma client instance (typed later)
}

export class FrequencyLexiconRepository {
  private entries: FrequencyEntry[] = [];
  private prisma?: unknown;

  constructor(cfg: FrequencyLexiconRepositoryConfig = {}) {
    if (cfg.entries) this.entries = cfg.entries.slice();
    this.prisma = cfg.prismaClient;
  }

  /**
   * Returns the top N entries per digit (overall frequency sort) limited by maxPerDigit.
   * If digits array empty, returns global top N.
   */
  getTopFrequency(digits: string[], maxPerDigit: number): FrequencyEntry[] {
    if (this.prisma) {
      // TODO: implement actual Prisma query when schema available.
      // Placeholder: fall back to in-memory for now.
    }
    const pool = digits.length
      ? this.entries.filter((e) => digits.includes(e.toneDigit))
      : this.entries;
    const grouped = new Map<string, FrequencyEntry[]>();
    for (const e of pool) {
      if (!grouped.has(e.toneDigit)) grouped.set(e.toneDigit, []);
      grouped.get(e.toneDigit)!.push(e);
    }
    const result: FrequencyEntry[] = [];
    for (const [, list] of grouped.entries()) {
      list.sort((a, b) => b.frequency - a.frequency);
      result.push(...list.slice(0, maxPerDigit));
    }
    return result;
  }

  /** Random sampling across digits with at most maxPerDigit each (seeded). */
  getRandomSample(digits: string[], maxPerDigit: number, rng: SeedRng): FrequencyEntry[] {
    const pool = digits.length
      ? this.entries.filter((e) => digits.includes(e.toneDigit))
      : this.entries;
    const grouped = new Map<string, FrequencyEntry[]>();
    for (const e of pool) {
      if (!grouped.has(e.toneDigit)) grouped.set(e.toneDigit, []);
      grouped.get(e.toneDigit)!.push(e);
    }
    const out: FrequencyEntry[] = [];
    for (const list of grouped.values()) {
      // Fisher-Yates partial shuffle until we have maxPerDigit
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      out.push(...list.slice(0, maxPerDigit));
    }
    return out;
  }

  /** Add or upsert entries (used for seeding). */
  upsert(entries: FrequencyEntry[]): void {
    const byKey = new Map<string, FrequencyEntry>();
    for (const e of this.entries) byKey.set(`${e.surface}|${e.toneDigit}`, e);
    for (const e of entries) {
      const key = `${e.surface}|${e.toneDigit}`;
      const existing = byKey.get(key);
      if (existing) existing.frequency = e.frequency;
      else {
        this.entries.push({ ...e });
        byKey.set(key, e);
      }
    }
  }

  /** Utility: load from JSON lines (each entry per line) - Deno file system convenience. */
  static async fromJsonl(path: string): Promise<FrequencyLexiconRepository> {
    const text = await Deno.readTextFile(path);
    const entries: FrequencyEntry[] = [];
    for (const line of text.split(/\n+/)) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.surface && obj.toneDigit) {
          entries.push({
            surface: obj.surface,
            toneDigit: obj.toneDigit,
            frequency: obj.frequency ?? 1,
          });
        }
      } catch (_) { /* ignore malformed */ }
    }
    return new FrequencyLexiconRepository({ entries });
  }
}

export default FrequencyLexiconRepository;
