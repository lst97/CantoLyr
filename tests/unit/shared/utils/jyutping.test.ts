import { describe, it, expect } from 'vitest';
import { 
  extractTones, 
  countSyllables, 
  isValidJyutping, 
  normalizeJyutping 
} from '../../../../src/shared/utils/jyutping.js';

describe('jyutping utilities', () => {
  describe('extractTones', () => {
    it('should extract tones from single syllable jyutping', () => {
      expect(extractTones('mong4')).toBe('4');
      expect(extractTones('hei3')).toBe('3');
      expect(extractTones('aa1')).toBe('1');
      expect(extractTones('ng6')).toBe('6');
    });

    it('should extract tones from multi-syllable jyutping', () => {
      expect(extractTones('zaai3 kyun4 jan1')).toBe('341');
      expect(extractTones('hei3 haa6')).toBe('36');
      expect(extractTones('jat1 go3 jan2')).toBe('132');
      expect(extractTones('m4 goi1')).toBe('41');
    });

    it('should handle jyutping without spaces', () => {
      expect(extractTones('zaai3kyun4jan1')).toBe('341');
      expect(extractTones('hei3haa6')).toBe('36');
    });

    it('should handle jyutping with extra whitespace', () => {
      expect(extractTones('  zaai3  kyun4  jan1  ')).toBe('341');
      expect(extractTones('hei3\thaa6')).toBe('36');
    });

    it('should extract all valid tone digits (1-6)', () => {
      expect(extractTones('aa1 bb2 cc3 dd4 ee5 ff6')).toBe('123456');
    });

    it('should throw error for non-string input', () => {
      expect(() => extractTones(null as any)).toThrow('Jyutping must be a string');
      expect(() => extractTones(123 as any)).toThrow('Jyutping must be a string');
    });

    it('should throw error for jyutping without tone digits', () => {
      expect(() => extractTones('mong')).toThrow('No tone digits found');
      expect(() => extractTones('hello world')).toThrow('No tone digits found');
      expect(() => extractTones('')).toThrow('No tone digits found');
    });

    it('should throw error for jyutping with invalid tone digits', () => {
      // Note: extractTones only looks for 1-6, so 0,7,8,9 won't be matched
      expect(() => extractTones('mong0')).toThrow('No tone digits found');
      expect(() => extractTones('mong7')).toThrow('No tone digits found');
    });
  });

  describe('countSyllables', () => {
    it('should count syllables correctly for single syllable', () => {
      expect(countSyllables('mong4')).toBe(1);
      expect(countSyllables('aa1')).toBe(1);
    });

    it('should count syllables correctly for multi-syllable jyutping', () => {
      expect(countSyllables('zaai3 kyun4 jan1')).toBe(3);
      expect(countSyllables('hei3 haa6')).toBe(2);
      expect(countSyllables('jat1 go3 jan2 ming4')).toBe(4);
    });

    it('should count syllables for jyutping without spaces', () => {
      expect(countSyllables('zaai3kyun4jan1')).toBe(3);
      expect(countSyllables('hei3haa6')).toBe(2);
    });

    it('should handle complex jyutping patterns', () => {
      expect(countSyllables('aa1 bb2 cc3 dd4 ee5 ff6')).toBe(6);
      expect(countSyllables('m4 goi1')).toBe(2); // 'm' is a valid syllable
    });

    it('should throw error for non-string input', () => {
      expect(() => countSyllables(null as any)).toThrow('Jyutping must be a string');
      expect(() => countSyllables(undefined as any)).toThrow('Jyutping must be a string');
    });

    it('should throw error for invalid jyutping', () => {
      expect(() => countSyllables('hello')).toThrow('No tone digits found');
      expect(() => countSyllables('')).toThrow('No tone digits found');
    });
  });

  describe('isValidJyutping', () => {
    it('should return true for valid jyutping strings', () => {
      const validJyutping = [
        'mong4',
        'zaai3 kyun4 jan1',
        'hei3 haa6',
        'aa1',
        'm4 goi1',
        'jat1go3jan2', // without spaces
        '  zaai3  kyun4  jan1  ' // with extra whitespace
      ];

      validJyutping.forEach(jyutping => {
        expect(isValidJyutping(jyutping)).toBe(true);
      });
    });

    it('should return false for invalid jyutping strings', () => {
      const invalidJyutping = [
        '',
        '   ',
        'hello',
        'mong',
        'mong0', // invalid tone
        'mong7', // invalid tone
        null,
        undefined,
        123
      ];

      invalidJyutping.forEach(jyutping => {
        expect(isValidJyutping(jyutping as any)).toBe(false);
      });
    });
  });

  describe('normalizeJyutping', () => {
    it('should trim whitespace and convert to lowercase', () => {
      expect(normalizeJyutping('  MONG4  ')).toBe('mong4');
      expect(normalizeJyutping('ZAAI3 KYUN4 JAN4')).toBe('zaai3 kyun4 jan4');
      expect(normalizeJyutping('\tHEI3\tHAA6\t')).toBe('hei3\thaa6');
    });

    it('should handle already normalized jyutping', () => {
      expect(normalizeJyutping('mong4')).toBe('mong4');
      expect(normalizeJyutping('zaai3 kyun4 jan1')).toBe('zaai3 kyun4 jan1');
    });

    it('should handle mixed case', () => {
      expect(normalizeJyutping('MoNg4')).toBe('mong4');
      expect(normalizeJyutping('ZaAi3 KyUn4 JaN1')).toBe('zaai3 kyun4 jan1');
    });

    it('should throw error for non-string input', () => {
      expect(() => normalizeJyutping(null as any)).toThrow('Jyutping must be a string');
      expect(() => normalizeJyutping(123 as any)).toThrow('Jyutping must be a string');
    });

    it('should handle empty string after trimming', () => {
      expect(normalizeJyutping('   ')).toBe('');
    });
  });
});