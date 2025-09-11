import { PrismaClient } from "../../../../../prisma/generated/client.ts";
import { ReadingRepo, ReadingDTO } from "../../../../application/ports/ReadingRepo.ts";
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
    const pronunciationCondition = isPrefix ? { startsWith: pronunciation } : { equals: pronunciation };
    const entryTypeCondition = entryType ? { type: entryType } : {};
    return await this.prisma.reading.count({
      where: { pronunciation: pronunciationCondition, entry: entryTypeCondition },
    });
  }

  async searchByPronunciation(query: {
    pronunciation: string;
    isPrefix?: boolean;
    entryType?: EntryType;
    limit?: number;
    offset?: number;
  }): Promise<ReadingDTO[]> {
    const { pronunciation, isPrefix = false, entryType, limit = 50, offset = 0 } = query;
    const pronunciationCondition = isPrefix ? { startsWith: pronunciation } : { equals: pronunciation };
    const entryTypeCondition = entryType ? { type: entryType } : {};

    const readings = await this.prisma.reading.findMany({
      where: { pronunciation: pronunciationCondition, entry: entryTypeCondition },
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
    rhyme: string;
    entryType?: EntryType;
    limit?: number;
    offset?: number;
  }): Promise<ReadingDTO[]> {
    const { rhyme, entryType, limit = 50, offset = 0 } = query;
    const entryTypeCondition = entryType ? { type: entryType } : {};

    const readings = await this.prisma.reading.findMany({
      where: { rhymes: { has: rhyme }, entry: entryTypeCondition },
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
