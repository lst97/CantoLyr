import { PrismaClient } from '@prisma/client';
import type { ReadingRepo, ReadingDTO } from '../../../application/ports/ReadingRepo.js';
import type { EntryType } from '../../../shared/types/common.js';

/**
 * Prisma implementation of ReadingRepo for optimized search operations
 * Implements CQRS read side with tone-based search and deterministic ordering
 */
export class PrismaReadingRepository implements ReadingRepo {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get specific readings by their IDs
   * Used for compose operations and feedback recording
   */
  async getByIds(ids: bigint[]): Promise<ReadingDTO[]> {
    if (ids.length === 0) {
      return [];
    }

    const readings = await this.prisma.reading.findMany({
      where: {
        id: { in: ids }
      },
      include: {
        entry: true
      },
      orderBy: [
        // Maintain deterministic ordering
        { entry: { type: 'asc' } },
        { syllables: 'asc' },
        { pronunciation: 'asc' },
      ]
    });

    return readings.map(this.mapToDTO);
  }

  /**
   * Get a single reading by ID
   * Returns null if not found
   */
  async getById(id: bigint): Promise<ReadingDTO | null> {
    const reading = await this.prisma.reading.findUnique({
      where: { id },
      include: {
        entry: true
      }
    });

    return reading ? this.mapToDTO(reading) : null;
  }

  /**
   * Count results by pronunciation (new mapped tone field)
   */
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

  /**
   * Search by new pronunciation column, with optional prefix
   */
  async searchByPronunciation(query: {
    pronunciation: string;
    isPrefix?: boolean;
    entryType?: EntryType;
    limit?: number;
    offset?: number;
  }): Promise<ReadingDTO[]> {
    const { pronunciation, isPrefix = false, entryType, limit = 50, offset = 0 } = query;
    const pronunciationCondition = isPrefix
      ? { startsWith: pronunciation }
      : { equals: pronunciation };
    const entryTypeCondition = entryType ? { type: entryType } : {};

    const readings = await this.prisma.reading.findMany({
      where: {
        pronunciation: pronunciationCondition,
        entry: entryTypeCondition
      },
      include: { entry: true },
      orderBy: [
        { entry: { type: 'asc' } },
        { syllables: 'asc' },
        { pronunciation: 'asc' },
      ],
      take: limit,
      skip: offset
    });
    return readings.map(this.mapToDTO);
  }

  /**
   * Search by rhyme token contained in the rhymes array column
   */
  async searchByRhyme(query: {
    rhyme: string;
    entryType?: EntryType;
    limit?: number;
    offset?: number;
  }): Promise<ReadingDTO[]> {
    const { rhyme, entryType, limit = 50, offset = 0 } = query;
    const entryTypeCondition = entryType ? { type: entryType } : {};

    const readings = await this.prisma.reading.findMany({
      where: {
        rhymes: { has: rhyme },
        entry: entryTypeCondition
      },
      include: { entry: true },
      orderBy: [
        { entry: { type: 'asc' } },
        { syllables: 'asc' },
        { pronunciation: 'asc' },
      ],
      take: limit,
      skip: offset
    });
    return readings.map(this.mapToDTO);
  }

  /**
   * Maps Prisma reading result to ReadingDTO
   */
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
      source: reading.source
    };
  }
}
