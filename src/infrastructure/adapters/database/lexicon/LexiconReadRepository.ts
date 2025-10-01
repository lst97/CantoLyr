import { PrismaClient } from "../../../../../prisma/generated/client.ts";
import { ReadingDTO, ReadingRepo } from "../../../../application/ports/ReadingRepo.ts";
import { EntryType } from "../../../../shared/types/common.ts";

/**
 * Prisma implementation of ReadingRepo for the Lexicon domain
 * Implements CQRS read side with tone-based search and deterministic ordering
 */
export class LexiconReadRepository implements ReadingRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async getByIds(ids: bigint[]): Promise<ReadingDTO[]> {
    if (ids.length === 0) return [];

    const readings = await this.prisma.reading.findMany({
      where: { id: { in: ids } },
      include: { entry: true },
      orderBy: [
        { entry: { type: "asc" } },
        { syllables: "asc" },
        { pronunciation: "asc" },
      ],
    });
    return readings.map(this.mapToDTO);
  }

  async getById(id: bigint): Promise<ReadingDTO | null> {
    const reading = await this.prisma.reading.findUnique({
      where: { id },
      include: { entry: true },
    });
    return reading ? this.mapToDTO(reading) : null;
  }

  async countByPronunciation(query: {
    pronunciation: string;
    isPrefix?: boolean;
    entryType?: EntryType;
  }): Promise<number> {
    const { pronunciation, isPrefix = false, entryType } = query;
    const pronunciationCondition = isPrefix
      ? { startsWith: pronunciation }
      : { equals: pronunciation };
    const entryTypeCondition = entryType ? { type: entryType } : {};
    return await this.prisma.reading.count({
      where: {
        pronunciation: pronunciationCondition,
        entry: entryTypeCondition,
      },
    });
  }

  async countByRhyme(query: {
    rhyme: string[];
    entryType?: EntryType;
    requireSequence?: boolean;
  }): Promise<number> {
    const readings = await this.filterReadingsByRhymes(query);
    return readings.length;
  }

  async searchByPronunciation(query: {
    pronunciation: string;
    isPrefix?: boolean;
    entryType?: EntryType;
    limit?: number;
    offset?: number;
  }): Promise<ReadingDTO[]> {
    const {
      pronunciation,
      isPrefix = false,
      entryType,
      limit = 50,
      offset = 0,
    } = query;
    const pronunciationCondition = isPrefix
      ? { startsWith: pronunciation }
      : { equals: pronunciation };
    const entryTypeCondition = entryType ? { type: entryType } : {};

    const readings = await this.prisma.reading.findMany({
      where: {
        pronunciation: pronunciationCondition,
        entry: entryTypeCondition,
      },
      include: { entry: true },
      orderBy: [
        { entry: { type: "asc" } },
        { syllables: "asc" },
        { pronunciation: "asc" },
      ],
      take: limit,
      skip: offset,
    });
    return readings.map(this.mapToDTO);
  }

  async searchByRhyme(query: {
    rhyme: string[];
    entryType?: EntryType;
    requireSequence?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<ReadingDTO[]> {
    const { limit = 50, offset = 0 } = query;
    const readings = await this.filterReadingsByRhymes(query);
    const windowed = readings.slice(offset, offset + limit);
    return windowed.map((reading) => this.mapToDTO(reading));
  }

  private async filterReadingsByRhymes(query: {
    rhyme: string[];
    entryType?: EntryType;
    requireSequence?: boolean;
  }): Promise<any[]> {
    const normalizedTargets = this.normalizeRhymes(query.rhyme);
    if (normalizedTargets.length === 0) {
      return [];
    }

    const entryTypeCondition = query.entryType ? { type: query.entryType } : {};
    const readings = await this.prisma.reading.findMany({
      where: {
        rhymes: { hasSome: normalizedTargets },
        entry: entryTypeCondition,
      },
      include: { entry: true },
      orderBy: [
        { entry: { type: "asc" } },
        { syllables: "asc" },
        { pronunciation: "asc" },
      ],
    });

    return readings.filter((reading) =>
      this.matchesRhymes(
        Array.isArray(reading.rhymes) ? reading.rhymes : [],
        normalizedTargets,
        query.requireSequence ?? false,
      )
    );
  }

  private normalizeRhymes(rhymes: string[]): string[] {
    return Array.from(
      new Set(
        rhymes
          .map((value) => value?.trim().toLowerCase() ?? "")
          .filter((value) => value.length > 0),
      ),
    );
  }

  private matchesRhymes(
    rhymeList: string[],
    required: string[],
    requireSequence: boolean,
  ): boolean {
    if (required.length === 0) return false;
    const normalizedList = rhymeList.map((value) => value?.toLowerCase() ?? "");

    if (requireSequence) {
      if (required.length > normalizedList.length) return false;
      for (let start = 0; start <= normalizedList.length - required.length; start++) {
        let matched = true;
        for (let idx = 0; idx < required.length; idx++) {
          if (normalizedList[start + idx] !== required[idx]) {
            matched = false;
            break;
          }
        }
        if (matched) return true;
      }
      return false;
    }

    for (const target of required) {
      if (!normalizedList.includes(target)) {
        return false;
      }
    }
    return true;
  }

  private mapToDTO(reading: any): ReadingDTO {
    return {
      id: reading.id,
      entryId: reading.entryId,
      surface: reading.entry.surface,
      type: reading.entry.type as EntryType,
      lang: reading.entry.lang,
      jyutping: reading.jyutping,
      tone: reading.tone,
      pronunciation: reading.pronunciation,
      consonants: Array.isArray(reading.consonants) ? reading.consonants : [],
      rhymes: Array.isArray(reading.rhymes) ? reading.rhymes : [],
      syllables: reading.syllables,
      freq: reading.freq,
      pos: reading.pos,
      register: reading.register,
      gloss: reading.gloss,
      source: reading.source,
    };
  }
}
