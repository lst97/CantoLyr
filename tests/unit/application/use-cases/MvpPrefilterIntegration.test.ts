import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prefilterGroupsByTone, type FetchByTone } from '../../../../src/application/services/mvpPrefilter.js';
import type { ReadingDTO } from '../../../../src/application/ports/ReadingRepo.js';

// Sample test data with varying frequencies
const createSampleReadings = (count: number, baseFreq: number = 1): ReadingDTO[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: BigInt(i + 1),
    entryId: BigInt(i + 1),
    surface: `word${i + 1}`,
    type: 'char' as const,
    lang: 'zh-HK',
    jyutping: `test${i + 1}`,
    toneOriginal: '4',
    toneMapped: '0',
    syllables: 1,
    freq: baseFreq - (i * 0.1), // Decreasing frequency
    pos: 'NOUN',
    register: 'neutral',
    gloss: `meaning ${i + 1}`,
    source: 'test'
  }));
};

describe('MVP Prefilter Integration', () => {
  let mockFetchByTone: FetchByTone;

  beforeEach(() => {
    mockFetchByTone = vi.fn();
  });

  describe('prefilterGroupsByTone', () => {
    it('should handle single-digit tone groups with 70/30 split', async () => {
      // Arrange
      const readings = createSampleReadings(100, 10); // 100 readings with decreasing freq
      vi.mocked(mockFetchByTone).mockResolvedValue(readings);

      // Act
      const groups = await prefilterGroupsByTone('4', mockFetchByTone, 10, 12345);

      // Assert
      expect(groups).toHaveLength(1);
      expect(groups[0]!.pattern).toBe('4');
      expect(groups[0]!.options).toHaveLength(10);
      
      // First 7 should be highest frequency (70%)
      const topOptions = groups[0]!.options.slice(0, 7);
      const randomOptions = groups[0]!.options.slice(7);
      
      expect(topOptions).toHaveLength(7);
      expect(randomOptions).toHaveLength(3);
      
      // Top options should have higher frequencies on average
      const avgTopFreq = topOptions.reduce((sum, opt) => sum + (opt.freq ?? 0), 0) / topOptions.length;
      const avgRandomFreq = randomOptions.reduce((sum, opt) => sum + (opt.freq ?? 0), 0) / randomOptions.length;
      
      expect(avgTopFreq).toBeGreaterThan(avgRandomFreq);
    });

    it('should handle multi-digit tone groups with uniform random sampling', async () => {
      // Arrange
      const readings = createSampleReadings(100, 10);
      vi.mocked(mockFetchByTone).mockResolvedValue(readings);

      // Act
      const groups = await prefilterGroupsByTone('40', mockFetchByTone, 20, 12345);

      // Assert
      expect(groups).toHaveLength(1);
      expect(groups[0]!.pattern).toBe('40');
      expect(groups[0]!.options).toHaveLength(20);
      
      // With uniform random sampling, we can't predict exact order,
      // but we should have a good distribution
      const frequencies = groups[0]!.options.map(opt => opt.freq ?? 0);
      const uniqueFreqs = new Set(frequencies);
      expect(uniqueFreqs.size).toBeGreaterThan(10); // Should have variety
    });

    it('should handle multiple tone groups correctly', async () => {
      // Arrange
      const readings1 = createSampleReadings(50, 5);
      const readings2 = createSampleReadings(30, 8);
      
      vi.mocked(mockFetchByTone)
        .mockResolvedValueOnce(readings1) // For '4'
        .mockResolvedValueOnce(readings2); // For '0'

      // Act
      const groups = await prefilterGroupsByTone('4 0', mockFetchByTone, 15, 12345);

      // Assert
      expect(groups).toHaveLength(2);
      
      expect(groups[0]!.groupIndex).toBe(1);
      expect(groups[0]!.pattern).toBe('4');
      expect(groups[0]!.options).toHaveLength(15);
      
      expect(groups[1]!.groupIndex).toBe(2);
      expect(groups[1]!.pattern).toBe('0');
      expect(groups[1]!.options).toHaveLength(15);
      
      expect(mockFetchByTone).toHaveBeenCalledTimes(2);
      expect(mockFetchByTone).toHaveBeenCalledWith('4', 1000); // Math.max(15 * 4, 1000) = 1000
      expect(mockFetchByTone).toHaveBeenCalledWith('0', 1000);
    });

    it('should deduplicate by surface text keeping highest frequency', async () => {
      // Arrange
      const duplicateReadings: ReadingDTO[] = [
        {
          id: 1n, entryId: 1n, surface: 'test', type: 'char', lang: 'zh-HK',
          jyutping: 'test1', toneOriginal: '4', toneMapped: '0', syllables: 1,
          freq: 5, pos: 'NOUN', register: 'neutral', gloss: 'test', source: 'test'
        },
        {
          id: 2n, entryId: 2n, surface: 'test', type: 'char', lang: 'zh-HK',
          jyutping: 'test2', toneOriginal: '4', toneMapped: '0', syllables: 1,
          freq: 10, pos: 'NOUN', register: 'neutral', gloss: 'test', source: 'test'
        },
        {
          id: 3n, entryId: 3n, surface: 'unique', type: 'char', lang: 'zh-HK',
          jyutping: 'unique1', toneOriginal: '4', toneMapped: '0', syllables: 1,
          freq: 3, pos: 'NOUN', register: 'neutral', gloss: 'unique', source: 'test'
        }
      ];
      
      vi.mocked(mockFetchByTone).mockResolvedValue(duplicateReadings);

      // Act
      const groups = await prefilterGroupsByTone('4', mockFetchByTone, 10, 12345);

      // Assert
      expect(groups[0]!.options).toHaveLength(2); // Deduplicated
      
      const testOption = groups[0]!.options.find(opt => opt.surface === 'test');
      expect(testOption).toBeDefined();
      expect(testOption!.readingId).toBe(2n); // Should keep the higher frequency one
      expect(testOption!.freq).toBe(10);
    });

    it('should handle empty results gracefully', async () => {
      // Arrange
      vi.mocked(mockFetchByTone).mockResolvedValue([]);

      // Act
      const groups = await prefilterGroupsByTone('4', mockFetchByTone, 10, 12345);

      // Assert
      expect(groups).toHaveLength(1);
      expect(groups[0]!.options).toHaveLength(0);
    });

    it('should respect maxPerGroup limit', async () => {
      // Arrange
      const readings = createSampleReadings(1000, 10);
      vi.mocked(mockFetchByTone).mockResolvedValue(readings);

      // Act
      const groups = await prefilterGroupsByTone('4', mockFetchByTone, 50, 12345);

      // Assert
      expect(groups[0]!.options).toHaveLength(50);
    });

    it('should use seeded randomness for reproducible results', async () => {
      // Arrange
      const readings = createSampleReadings(100, 10);
      vi.mocked(mockFetchByTone).mockResolvedValue(readings);

      // Act
      const groups1 = await prefilterGroupsByTone('40', mockFetchByTone, 20, 12345);
      
      // Reset mock and call again with same seed
      vi.mocked(mockFetchByTone).mockClear();
      vi.mocked(mockFetchByTone).mockResolvedValue(readings);
      const groups2 = await prefilterGroupsByTone('40', mockFetchByTone, 20, 12345);

      // Assert
      expect(groups1[0]!.options).toEqual(groups2[0]!.options);
    });

    it('should handle complex tone patterns with spaces', async () => {
      // Arrange
      const readings = createSampleReadings(20, 5);
      vi.mocked(mockFetchByTone).mockResolvedValue(readings);

      // Act
      const groups = await prefilterGroupsByTone('4  0   3', mockFetchByTone, 10, 12345);

      // Assert
      expect(groups).toHaveLength(3);
      expect(groups[0]!.pattern).toBe('4');
      expect(groups[1]!.pattern).toBe('0');
      expect(groups[2]!.pattern).toBe('3');
      expect(mockFetchByTone).toHaveBeenCalledTimes(3);
    });

    it('should assign correct option numbers (1-based)', async () => {
      // Arrange
      const readings = createSampleReadings(5, 10);
      vi.mocked(mockFetchByTone).mockResolvedValue(readings);

      // Act
      const groups = await prefilterGroupsByTone('4', mockFetchByTone, 5, 12345);

      // Assert
      const options = groups[0]!.options;
      expect(options.map(opt => opt.option)).toEqual([1, 2, 3, 4, 5]);
    });

    it('should preserve reading metadata in options', async () => {
      // Arrange
      const readings = createSampleReadings(3, 10);
      vi.mocked(mockFetchByTone).mockResolvedValue(readings);

      // Act
      const groups = await prefilterGroupsByTone('4', mockFetchByTone, 3, 12345);

      // Assert
      const options = groups[0]!.options;
      expect(options[0]).toEqual({
        option: 1,
        surface: 'word1',
        readingId: 1n,
        freq: 10
      });
    });
  });
});