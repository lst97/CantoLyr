import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MvpPrefilterService } from '../MvpPrefilterService.js';
import type { ReadingDTO } from '../../../../application/ports/ReadingRepo.js';
import type { FetchByTone } from '../../../../application/services/mvpPrefilter.js';

describe('MvpPrefilterService', () => {
  let service: MvpPrefilterService;

  beforeEach(() => {
    service = new MvpPrefilterService();
  });

  const createMockReadings = (count: number, baseFreq = 50): ReadingDTO[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: BigInt(i + 1),
      surface: `字${i + 1}`,
      jyutping: `zi${i + 1}`,
      toneOriginal: '1',
      toneMapped: '3',
      syllables: 1,
      freq: baseFreq + (i * 10),
      pos: 'NOUN',
      register: 'neutral',
      gloss: `word ${i + 1}`,
      source: 'test',
      type: 'char',
      lang: 'zh-HK',
      entryId: BigInt(i + 1)
    }));
  };

  const createMockFetchByTone = (mockData: Record<string, ReadingDTO[]>): FetchByTone => {
    return vi.fn().mockImplementation((toneMapped: string, limit: number) => {
      const data = mockData[toneMapped] || [];
      return Promise.resolve(data.slice(0, limit));
    });
  };

  describe('prefilterGroupsByTone', () => {
    it('should split tone pattern by spaces and process each group', async () => {
      const mockData = {
        '3': createMockReadings(10),
        '4': createMockReadings(8)
      };
      const fetchByTone = createMockFetchByTone(mockData);

      const result = await service.prefilterGroupsByTone('3 4', fetchByTone, 5);

      expect(result).toHaveLength(2);
      expect(result[0]?.groupIndex).toBe(1);
      expect(result[0]?.pattern).toBe('3');
      expect(result[1]?.groupIndex).toBe(2);
      expect(result[1]?.pattern).toBe('4');
    });

    it('should apply 70/30 frequency/random split for single-digit patterns', async () => {
      const mockData = {
        '3': createMockReadings(100) // Large dataset
      };
      const fetchByTone = createMockFetchByTone(mockData);

      const result = await service.prefilterGroupsByTone('3', fetchByTone, 10, 12345);

      expect(result).toHaveLength(1);
      expect(result[0]?.options).toHaveLength(10);
      
      // With seed 12345, results should be deterministic
      const surfaces = result[0]?.options.map(o => o.surface);
      expect(surfaces).toContain('字100'); // Should include highest frequency items
    });

    it('should apply uniform random sampling for multi-digit patterns', async () => {
      const mockData = {
        '34': createMockReadings(50)
      };
      const fetchByTone = createMockFetchByTone(mockData);

      const result = await service.prefilterGroupsByTone('34', fetchByTone, 10, 12345);

      expect(result).toHaveLength(1);
      expect(result[0]?.options).toHaveLength(10);
      expect(result[0]?.pattern).toBe('34');
    });

    it('should deduplicate by surface text keeping highest frequency', async () => {
      const duplicateReadings: ReadingDTO[] = [
        {
          id: BigInt(1),
          surface: '愛',
          jyutping: 'oi3',
          toneOriginal: '3',
          toneMapped: '4',
          syllables: 1,
          freq: 50,
          pos: 'NOUN',
          register: 'neutral',
          gloss: 'love',
          source: 'test1',
          type: 'char',
          lang: 'zh-HK',
          entryId: BigInt(1)
        },
        {
          id: BigInt(2),
          surface: '愛',
          jyutping: 'oi3',
          toneOriginal: '3',
          toneMapped: '4',
          syllables: 1,
          freq: 80, // Higher frequency
          pos: 'VERB',
          register: 'formal',
          gloss: 'to love',
          source: 'test2',
          type: 'char',
          lang: 'zh-HK',
          entryId: BigInt(2)
        }
      ];

      const mockData = { '4': duplicateReadings };
      const fetchByTone = createMockFetchByTone(mockData);

      const result = await service.prefilterGroupsByTone('4', fetchByTone, 5);

      expect(result).toHaveLength(1);
      expect(result[0]?.options).toHaveLength(1);
      expect(result[0]?.options[0]?.readingId).toBe(BigInt(2)); // Should keep higher frequency
      expect(result[0]?.options[0]?.freq).toBe(80);
    });

    it('should respect maxPerGroup limit', async () => {
      const mockData = {
        '3': createMockReadings(100)
      };
      const fetchByTone = createMockFetchByTone(mockData);

      const result = await service.prefilterGroupsByTone('3', fetchByTone, 15);

      expect(result).toHaveLength(1);
      expect(result[0]?.options.length).toBeLessThanOrEqual(15);
    });

    it('should handle empty results gracefully', async () => {
      const mockData = { '3': [] };
      const fetchByTone = createMockFetchByTone(mockData);

      const result = await service.prefilterGroupsByTone('3', fetchByTone, 10);

      expect(result).toHaveLength(1);
      expect(result[0]?.options).toHaveLength(0);
    });

    it('should be deterministic with same seed', async () => {
      const mockData = {
        '3': createMockReadings(50)
      };
      const fetchByTone = createMockFetchByTone(mockData);

      const result1 = await service.prefilterGroupsByTone('3', fetchByTone, 10, 12345);
      const result2 = await service.prefilterGroupsByTone('3', fetchByTone, 10, 12345);

      expect(result1[0]?.options).toEqual(result2[0]?.options);
    });

    it('should produce different results with different seeds', async () => {
      const mockData = {
        '3': createMockReadings(50)
      };
      const fetchByTone = createMockFetchByTone(mockData);

      const result1 = await service.prefilterGroupsByTone('3', fetchByTone, 10, 12345);
      const result2 = await service.prefilterGroupsByTone('3', fetchByTone, 10, 54321);

      // Results should be different (though this is probabilistic)
      const surfaces1 = result1[0]?.options.map(o => o.surface).sort();
      const surfaces2 = result2[0]?.options.map(o => o.surface).sort();
      expect(surfaces1).not.toEqual(surfaces2);
    });

    it('should assign correct option numbers (1-based)', async () => {
      const mockData = {
        '3': createMockReadings(5)
      };
      const fetchByTone = createMockFetchByTone(mockData);

      const result = await service.prefilterGroupsByTone('3', fetchByTone, 5);

      expect(result).toHaveLength(1);
      const options = result[0]?.options;
      expect(options![0]?.option).toBe(1);
      expect(options![1]?.option).toBe(2);
      expect(options![2]?.option).toBe(3);
      expect(options![3]?.option).toBe(4);
      expect(options![4]?.option).toBe(5);
    });
  });

  describe('getInfo', () => {
    it('should return correct service information', () => {
      const info = service.getInfo();
      expect(info.provider).toBe('MVP Heuristic Prefilter');
      expect(info.version).toBe('1.0');
      expect(info.strategy).toBe('frequency-based + random sampling');
    });
  });

  describe('validateConfig', () => {
    it('should not throw any errors', () => {
      expect(() => service.validateConfig()).not.toThrow();
    });
  });
});