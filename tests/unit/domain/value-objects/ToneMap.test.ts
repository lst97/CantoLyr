import { describe, it, expect } from 'vitest';
import { ToneMap } from '../../../../src/domain/value-objects/ToneMap.js';

describe('ToneMap', () => {
  describe('constructor', () => {
    it('should create a valid ToneMap with mapped tone digits', () => {
      const toneMap = new ToneMap('340');
      expect(toneMap.value).toBe('340');
      expect(toneMap.length).toBe(3);
    });

    it('should accept all valid mapped tone digits', () => {
      const validTones = ['0', '2', '3', '4', '5', '9'];
      validTones.forEach(tone => {
        expect(() => new ToneMap(tone)).not.toThrow();
      });
    });

    it('should accept combinations of valid mapped tone digits', () => {
      const validCombinations = ['023459', '340', '95', '0000', '3333'];
      validCombinations.forEach(combination => {
        expect(() => new ToneMap(combination)).not.toThrow();
      });
    });

    it('should throw error for invalid tone digits', () => {
      const invalidTones = ['1', '6', '7', '8', 'a', 'x'];
      invalidTones.forEach(tone => {
        expect(() => new ToneMap(tone)).toThrow('Invalid tone map');
      });
    });

    it('should throw error for empty string', () => {
      expect(() => new ToneMap('')).toThrow('Invalid tone map');
    });

    it('should throw error for strings containing invalid characters', () => {
      const invalidStrings = ['34a', '3 4', '3-4', '341x', '12'];
      invalidStrings.forEach(str => {
        expect(() => new ToneMap(str)).toThrow('Invalid tone map');
      });
    });
  });

  describe('isValid', () => {
    it('should return true for valid mapped tone patterns', () => {
      const validPatterns = ['0', '2', '3', '4', '5', '9', '340', '023459', '9999'];
      validPatterns.forEach(pattern => {
        expect(ToneMap.isValid(pattern)).toBe(true);
      });
    });

    it('should return false for invalid patterns', () => {
      const invalidPatterns = ['', '1', '6', '7', '8', 'a', '34a', '3 4', '12'];
      invalidPatterns.forEach(pattern => {
        expect(ToneMap.isValid(pattern)).toBe(false);
      });
    });

    it('should return false for non-string inputs', () => {
      expect(ToneMap.isValid(null as any)).toBe(false);
      expect(ToneMap.isValid(undefined as any)).toBe(false);
      expect(ToneMap.isValid(123 as any)).toBe(false);
      expect(ToneMap.isValid([] as any)).toBe(false);
    });
  });

  describe('startsWith', () => {
    it('should return true when tone map starts with prefix', () => {
      const toneMap = new ToneMap('34059');
      expect(toneMap.startsWith('3')).toBe(true);
      expect(toneMap.startsWith('34')).toBe(true);
      expect(toneMap.startsWith('340')).toBe(true);
      expect(toneMap.startsWith('34059')).toBe(true);
    });

    it('should return false when tone map does not start with prefix', () => {
      const toneMap = new ToneMap('34059');
      expect(toneMap.startsWith('4')).toBe(false);
      expect(toneMap.startsWith('35')).toBe(false);
      expect(toneMap.startsWith('340590')).toBe(false);
    });

    it('should handle empty prefix', () => {
      const toneMap = new ToneMap('340');
      expect(toneMap.startsWith('')).toBe(true);
    });
  });

  describe('mapTones', () => {
    it('should map original tones correctly', () => {
      const mappings = [
        { original: '1', expected: '3' },
        { original: '2', expected: '9' },
        { original: '3', expected: '4' },
        { original: '4', expected: '0' },
        { original: '5', expected: '5' },
        { original: '6', expected: '2' }
      ];

      mappings.forEach(({ original, expected }) => {
        const result = ToneMap.mapTones(original);
        expect(result.value).toBe(expected);
      });
    });

    it('should map complex tone patterns', () => {
      const testCases = [
        { original: '341', expected: '403' }, // zaai3 kyun4 jan1
        { original: '4', expected: '0' },     // mong4
        { original: '36', expected: '42' },   // hei3 haa6
        { original: '123456', expected: '394052' }
      ];

      testCases.forEach(({ original, expected }) => {
        const result = ToneMap.mapTones(original);
        expect(result.value).toBe(expected);
      });
    });

    it('should throw error for invalid original tone digits', () => {
      const invalidOriginals = ['0', '7', '8', '9', 'a', '1a', '17'];
      invalidOriginals.forEach(original => {
        expect(() => ToneMap.mapTones(original)).toThrow('Invalid original tone digit');
      });
    });

    it('should throw error for empty string', () => {
      expect(() => ToneMap.mapTones('')).toThrow();
    });
  });

  describe('toString', () => {
    it('should return the tone map value as string', () => {
      const toneMap = new ToneMap('340');
      expect(toneMap.toString()).toBe('340');
    });
  });

  describe('equals', () => {
    it('should return true for equal tone maps', () => {
      const toneMap1 = new ToneMap('340');
      const toneMap2 = new ToneMap('340');
      expect(toneMap1.equals(toneMap2)).toBe(true);
    });

    it('should return false for different tone maps', () => {
      const toneMap1 = new ToneMap('340');
      const toneMap2 = new ToneMap('403');
      expect(toneMap1.equals(toneMap2)).toBe(false);
    });
  });
});