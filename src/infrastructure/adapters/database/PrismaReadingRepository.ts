import { PrismaClient } from '@prisma/client';
import type { ReadingRepo, SearchQuery, ReadingDTO } from '../../../application/ports/ReadingRepo.js';
import type { EntryType } from '../../../shared/types/common.js';

/**
 * Prisma implementation of ReadingRepo for optimized search operations
 * Implements CQRS read side with tone-based search and deterministic ordering
 */
export class PrismaReadingRepository implements ReadingRepo {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Search for readings by mapped tone pattern with optimized queries
   * Results are ordered deterministically by type, syllables, tone mapping, and jyutping
   */
  async searchByToneMapped(query: SearchQuery): Promise<ReadingDTO[]> {
    const {
      toneMapped,
      isPrefix = false,
      entryType,
      limit = 50,
      offset = 0
    } = query;

    // Build the where clause for tone matching
    const toneCondition = isPrefix
      ? { startsWith: toneMapped }
      : { equals: toneMapped };

    // Build the entry type filter
    const entryTypeCondition = entryType ? { type: entryType } : {};

    const readings = await this.prisma.reading.findMany({
      where: {
        toneMapped: toneCondition,
        entry: entryTypeCondition
      },
      include: {
        entry: true
      },
      orderBy: [
        // Deterministic ordering as specified in requirements
        { entry: { type: 'asc' } },    // vocab before char
        { syllables: 'asc' },          // fewer syllables first
        { toneMapped: 'asc' },         // alphabetical tone pattern
        { jyutping: 'asc' }            // alphabetical jyutping
      ],
      take: limit,
      skip: offset
    });

    return readings.map(this.mapToDTO);
  }

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
        { toneMapped: 'asc' },
        { jyutping: 'asc' }
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
   * Count total results for a search query (for pagination)
   */
  async countByToneMapped(query: Omit<SearchQuery, 'limit' | 'offset'>): Promise<number> {
    const {
      toneMapped,
      isPrefix = false,
      entryType
    } = query;

    // Build the where clause for tone matching
    const toneCondition = isPrefix
      ? { startsWith: toneMapped }
      : { equals: toneMapped };

    // Build the entry type filter
    const entryTypeCondition = entryType ? { type: entryType } : {};

    return await this.prisma.reading.count({
      where: {
        toneMapped: toneCondition,
        entry: entryTypeCondition
      }
    });
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
      toneOriginal: reading.toneOriginal,
      toneMapped: reading.toneMapped,
      syllables: reading.syllables,
      freq: reading.freq,
      pos: reading.pos,
      register: reading.register,
      gloss: reading.gloss,
      source: reading.source
    };
  }
}