import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaReadingRepository } from '../../../../../src/infrastructure/adapters/database/PrismaReadingRepository.js';
import type { SearchQuery } from '../../../../../src/application/ports/ReadingRepo.js';

// Mock Prisma Client
const mockPrisma = {
  reading: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn()
  }
} as unknown as PrismaClient;

describe('PrismaReadingRepository', () => {
  let repository: PrismaReadingRepository;
  let mockFindMany: MockedFunction<any>;
  let mockFindUnique: MockedFunction<any>;
  let mockCount: MockedFunction<any>;

  beforeEach(() => {
    repository = new PrismaReadingRepository(mockPrisma);
    mockFindMany = mockPrisma.reading.findMany as MockedFunction<any>;
    mockFindUnique = mockPrisma.reading.findUnique as MockedFunction<any>;
    mockCount = mockPrisma.reading.count as MockedFunction<any>;
    
    // Reset all mocks
    vi.clearAllMocks();
  });

  describe('searchByToneMapped', () => {
    const mockReadingData = {
      id: BigInt(1),
      entryId: BigInt(1),
      jyutping: 'zaai3 kyun4 jan4',
      toneOriginal: '341',
      toneMapped: '403',
      syllables: 3,
      freq: 0.8,
      pos: 'NOUN',
      register: 'formal',
      gloss: 'creditor',
      source: 'lexicon_v1',
      entry: {
        id: BigInt(1),
        surface: '債權人',
        type: 'vocab',
        lang: 'zh-HK'
      }
    };

    it('should search by exact tone match', async () => {
      mockFindMany.mockResolvedValue([mockReadingData]);

      const query: SearchQuery = {
        toneMapped: '403',
        limit: 10
      };

      const result = await repository.searchByToneMapped(query);

      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          toneMapped: { equals: '403' },
          entry: {}
        },
        include: { entry: true },
        orderBy: [
          { entry: { type: 'asc' } },
          { syllables: 'asc' },
          { toneMapped: 'asc' },
          { jyutping: 'asc' }
        ],
        take: 10,
        skip: 0
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: BigInt(1),
        entryId: BigInt(1),
        surface: '債權人',
        type: 'vocab',
        lang: 'zh-HK',
        jyutping: 'zaai3 kyun4 jan4',
        toneOriginal: '341',
        toneMapped: '403',
        syllables: 3,
        freq: 0.8,
        pos: 'NOUN',
        register: 'formal',
        gloss: 'creditor',
        source: 'lexicon_v1'
      });
    });

    it('should search by prefix when isPrefix is true', async () => {
      mockFindMany.mockResolvedValue([mockReadingData]);

      const query: SearchQuery = {
        toneMapped: '40',
        isPrefix: true,
        limit: 5
      };

      await repository.searchByToneMapped(query);

      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          toneMapped: { startsWith: '40' },
          entry: {}
        },
        include: { entry: true },
        orderBy: [
          { entry: { type: 'asc' } },
          { syllables: 'asc' },
          { toneMapped: 'asc' },
          { jyutping: 'asc' }
        ],
        take: 5,
        skip: 0
      });
    });

    it('should filter by entry type when specified', async () => {
      mockFindMany.mockResolvedValue([mockReadingData]);

      const query: SearchQuery = {
        toneMapped: '403',
        entryType: 'vocab',
        limit: 10
      };

      await repository.searchByToneMapped(query);

      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          toneMapped: { equals: '403' },
          entry: { type: 'vocab' }
        },
        include: { entry: true },
        orderBy: [
          { entry: { type: 'asc' } },
          { syllables: 'asc' },
          { toneMapped: 'asc' },
          { jyutping: 'asc' }
        ],
        take: 10,
        skip: 0
      });
    });

    it('should handle pagination with offset', async () => {
      mockFindMany.mockResolvedValue([mockReadingData]);

      const query: SearchQuery = {
        toneMapped: '403',
        limit: 10,
        offset: 20
      };

      await repository.searchByToneMapped(query);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20
        })
      );
    });

    it('should use default limit when not specified', async () => {
      mockFindMany.mockResolvedValue([mockReadingData]);

      const query: SearchQuery = {
        toneMapped: '403'
      };

      await repository.searchByToneMapped(query);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
          skip: 0
        })
      );
    });
  });

  describe('getByIds', () => {
    const mockReadingData = {
      id: BigInt(1),
      entryId: BigInt(1),
      jyutping: 'zaai3',
      toneOriginal: '3',
      toneMapped: '4',
      syllables: 1,
      freq: 0.5,
      pos: 'NOUN',
      register: 'neutral',
      gloss: 'debt',
      source: 'test',
      entry: {
        id: BigInt(1),
        surface: '債',
        type: 'char',
        lang: 'zh-HK'
      }
    };

    it('should get readings by IDs', async () => {
      mockFindMany.mockResolvedValue([mockReadingData]);

      const ids = [BigInt(1), BigInt(2)];
      const result = await repository.getByIds(ids);

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { id: { in: ids } },
        include: { entry: true },
        orderBy: [
          { entry: { type: 'asc' } },
          { syllables: 'asc' },
          { toneMapped: 'asc' },
          { jyutping: 'asc' }
        ]
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(BigInt(1));
    });

    it('should return empty array for empty IDs', async () => {
      const result = await repository.getByIds([]);

      expect(mockFindMany).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('getById', () => {
    const mockReadingData = {
      id: BigInt(1),
      entryId: BigInt(1),
      jyutping: 'zaai3',
      toneOriginal: '3',
      toneMapped: '4',
      syllables: 1,
      freq: 0.5,
      pos: 'NOUN',
      register: 'neutral',
      gloss: 'debt',
      source: 'test',
      entry: {
        id: BigInt(1),
        surface: '債',
        type: 'char',
        lang: 'zh-HK'
      }
    };

    it('should get reading by ID', async () => {
      mockFindUnique.mockResolvedValue(mockReadingData);

      const result = await repository.getById(BigInt(1));

      expect(mockFindUnique).toHaveBeenCalledWith({
        where: { id: BigInt(1) },
        include: { entry: true }
      });

      expect(result).not.toBeNull();
      expect(result!.id).toBe(BigInt(1));
      expect(result!.surface).toBe('債');
    });

    it('should return null when reading not found', async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await repository.getById(BigInt(999));

      expect(result).toBeNull();
    });
  });

  describe('countByToneMapped', () => {
    it('should count by exact tone match', async () => {
      mockCount.mockResolvedValue(42);

      const query = {
        toneMapped: '403'
      };

      const result = await repository.countByToneMapped(query);

      expect(mockCount).toHaveBeenCalledWith({
        where: {
          toneMapped: { equals: '403' },
          entry: {}
        }
      });

      expect(result).toBe(42);
    });

    it('should count by prefix when isPrefix is true', async () => {
      mockCount.mockResolvedValue(15);

      const query = {
        toneMapped: '40',
        isPrefix: true
      };

      const result = await repository.countByToneMapped(query);

      expect(mockCount).toHaveBeenCalledWith({
        where: {
          toneMapped: { startsWith: '40' },
          entry: {}
        }
      });

      expect(result).toBe(15);
    });

    it('should count with entry type filter', async () => {
      mockCount.mockResolvedValue(8);

      const query = {
        toneMapped: '403',
        entryType: 'char' as const
      };

      const result = await repository.countByToneMapped(query);

      expect(mockCount).toHaveBeenCalledWith({
        where: {
          toneMapped: { equals: '403' },
          entry: { type: 'char' }
        }
      });

      expect(result).toBe(8);
    });
  });
});