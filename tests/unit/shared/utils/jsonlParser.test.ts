/**
 * Unit tests for JSONL parser
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { JsonlParser, createJsonlParser } from '../../../../src/shared/utils/jsonlParser.js';

describe('JsonlParser', () => {
  let parser: JsonlParser;
  let tempDir: string;

  beforeEach(() => {
    parser = new JsonlParser();
    tempDir = join(process.cwd(), 'temp-test');
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('validateEntry', () => {
    it('should validate a correct entry', () => {
      const validEntry = {
        surface: "債權人",
        type: "vocab",
        lang: "zh-HK",
        readings: [{
          jyutping: "zaai3 kyun4 jan4",
          freq: 0.8,
          pos: "NOUN",
          register: "formal",
          gloss: "creditor",
          source: "lexicon_v1"
        }]
      };

      expect(() => parser.validateEntry(validEntry)).not.toThrow();
      const result = parser.validateEntry(validEntry);
      expect(result).toEqual(validEntry);
    });

    it('should reject entry with missing surface', () => {
      const invalidEntry = {
        type: "vocab",
        lang: "zh-HK",
        readings: [{
          jyutping: "zaai3 kyun4 jan4",
          freq: 0.8,
          pos: "NOUN",
          register: "formal",
          gloss: "creditor",
          source: "lexicon_v1"
        }]
      };

      expect(() => parser.validateEntry(invalidEntry)).toThrow(/surface/);
    });

    it('should reject entry with invalid type', () => {
      const invalidEntry = {
        surface: "test",
        type: "invalid",
        lang: "zh-HK",
        readings: [{
          jyutping: "zaai3 kyun4 jan4",
          freq: 0.8,
          pos: "NOUN",
          register: "formal",
          gloss: "creditor",
          source: "lexicon_v1"
        }]
      };

      expect(() => parser.validateEntry(invalidEntry)).toThrow(/type/);
    });

    it('should reject entry with empty readings array', () => {
      const invalidEntry = {
        surface: "test",
        type: "vocab",
        lang: "zh-HK",
        readings: []
      };

      expect(() => parser.validateEntry(invalidEntry)).toThrow(/readings/);
    });

    it('should reject entry with invalid reading', () => {
      const invalidEntry = {
        surface: "test",
        type: "vocab",
        lang: "zh-HK",
        readings: [{
          jyutping: "zaai3 kyun4 jan4",
          // missing freq
          pos: "NOUN",
          register: "formal",
          gloss: "creditor",
          source: "lexicon_v1"
        }]
      };

      expect(() => parser.validateEntry(invalidEntry)).toThrow(/freq/);
    });
  });

  describe('normalizeEntry', () => {
    it('should normalize a valid entry', () => {
      const rawEntry = {
        surface: "  債權人  ",
        type: "vocab" as const,
        lang: "  zh-HK  ",
        readings: [{
          jyutping: "ZAAI3 KYUN4 JAN4",
          freq: 0.8,
          pos: "noun",
          register: "formal",
          gloss: "  creditor  ",
          source: "  lexicon_v1  "
        }]
      };

      const result = parser.normalizeEntry(rawEntry);

      expect(result.surface).toBe("債權人");
      expect(result.type).toBe("vocab");
      expect(result.lang).toBe("zh-HK");
      expect(result.readings).toHaveLength(1);
      
      const reading = result.readings[0];
      expect(reading?.jyutping).toBe("zaai3 kyun4 jan4");
      expect(reading?.toneOriginal).toBe("341");
      expect(reading?.toneMapped).toBe("403");
      expect(reading?.syllables).toBe(3);
      expect(reading?.pos).toBe("NOUN");
      expect(reading?.register).toBe("formal");
      expect(reading?.gloss).toBe("creditor");
      expect(reading?.source).toBe("lexicon_v1");
    });

    it('should handle single syllable jyutping', () => {
      const rawEntry = {
        surface: "亡",
        type: "char" as const,
        lang: "zh-HK",
        readings: [{
          jyutping: "mong4",
          freq: 39,
          pos: "NOUN",
          register: "neutral",
          gloss: "death",
          source: "charfreq_v1"
        }]
      };

      const result = parser.normalizeEntry(rawEntry);
      const reading = result.readings[0];
      
      expect(reading?.jyutping).toBe("mong4");
      expect(reading?.toneOriginal).toBe("4");
      expect(reading?.toneMapped).toBe("0");
      expect(reading?.syllables).toBe(1);
    });

    it('should normalize part of speech variations', () => {
      const testCases = [
        { input: "n", expected: "NOUN" },
        { input: "NOUN", expected: "NOUN" },
        { input: "v", expected: "VERB" },
        { input: "adjective", expected: "ADJ" },
        { input: "unknown_pos", expected: "UNKNOWN" }
      ];

      for (const testCase of testCases) {
        const rawEntry = {
          surface: "test",
          type: "vocab" as const,
          lang: "zh-HK",
          readings: [{
            jyutping: "test1",
            freq: 1,
            pos: testCase.input,
            register: "neutral",
            gloss: "test",
            source: "test"
          }]
        };

        const result = parser.normalizeEntry(rawEntry);
        expect(result.readings[0]?.pos).toBe(testCase.expected);
      }
    });

    it('should normalize register variations', () => {
      const testCases = [
        { input: "formal", expected: "formal" },
        { input: "FORMAL", expected: "formal" },
        { input: "standard", expected: "neutral" },
        { input: "informal", expected: "colloquial" },
        { input: "casual", expected: "colloquial" },
        { input: "unknown_register", expected: "neutral" }
      ];

      for (const testCase of testCases) {
        const rawEntry = {
          surface: "test",
          type: "vocab" as const,
          lang: "zh-HK",
          readings: [{
            jyutping: "test1",
            freq: 1,
            pos: "NOUN",
            register: testCase.input,
            gloss: "test",
            source: "test"
          }]
        };

        const result = parser.normalizeEntry(rawEntry);
        expect(result.readings[0]?.register).toBe(testCase.expected);
      }
    });

    it('should reject entry with invalid jyutping', () => {
      const rawEntry = {
        surface: "test",
        type: "vocab" as const,
        lang: "zh-HK",
        readings: [{
          jyutping: "invalid_jyutping",
          freq: 1,
          pos: "NOUN",
          register: "neutral",
          gloss: "test",
          source: "test"
        }]
      };

      expect(() => parser.normalizeEntry(rawEntry)).toThrow(/Invalid jyutping/);
    });

    it('should handle multiple readings', () => {
      const rawEntry = {
        surface: "test",
        type: "vocab" as const,
        lang: "zh-HK",
        readings: [
          {
            jyutping: "test1",
            freq: 1,
            pos: "NOUN",
            register: "neutral",
            gloss: "test1",
            source: "test"
          },
          {
            jyutping: "test2",
            freq: 2,
            pos: "VERB",
            register: "formal",
            gloss: "test2",
            source: "test"
          }
        ]
      };

      const result = parser.normalizeEntry(rawEntry);
      expect(result.readings).toHaveLength(2);
      expect(result.readings[0]?.gloss).toBe("test1");
      expect(result.readings[1]?.gloss).toBe("test2");
    });
  });

  describe('parseLine', () => {
    it('should parse a valid JSONL line', () => {
      const line = JSON.stringify({
        surface: "債權人",
        type: "vocab",
        lang: "zh-HK",
        readings: [{
          jyutping: "zaai3 kyun4 jan4",
          freq: 0.8,
          pos: "NOUN",
          register: "formal",
          gloss: "creditor",
          source: "lexicon_v1"
        }]
      });

      const result = parser.parseLine(line, 1);

      expect(result.success).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.lineNumber).toBe(1);
      expect(result.entry!.surface).toBe("債權人");
    });

    it('should handle invalid JSON', () => {
      const line = "invalid json {";
      const result = parser.parseLine(line, 1);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unexpected");
      expect(result.lineNumber).toBe(1);
    });

    it('should handle schema validation errors', () => {
      const line = JSON.stringify({
        surface: "test",
        // missing type
        lang: "zh-HK",
        readings: []
      });

      const result = parser.parseLine(line, 1);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Schema validation failed");
      expect(result.lineNumber).toBe(1);
    });

    it('should handle normalization errors', () => {
      const line = JSON.stringify({
        surface: "test",
        type: "vocab",
        lang: "zh-HK",
        readings: [{
          jyutping: "invalid_jyutping",
          freq: 1,
          pos: "NOUN",
          register: "neutral",
          gloss: "test",
          source: "test"
        }]
      });

      const result = parser.parseLine(line, 1);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid jyutping");
      expect(result.lineNumber).toBe(1);
    });
  });

  describe('parseFile', () => {
    it('should parse a valid JSONL file', async () => {
      const entries = [
        {
          surface: "債權人",
          type: "vocab",
          lang: "zh-HK",
          readings: [{
            jyutping: "zaai3 kyun4 jan4",
            freq: 0.8,
            pos: "NOUN",
            register: "formal",
            gloss: "creditor",
            source: "lexicon_v1"
          }]
        },
        {
          surface: "亡",
          type: "char",
          lang: "zh-HK",
          readings: [{
            jyutping: "mong4",
            freq: 39,
            pos: "NOUN",
            register: "neutral",
            gloss: "death",
            source: "charfreq_v1"
          }]
        }
      ];

      const jsonlContent = entries.map(entry => JSON.stringify(entry)).join('\n');
      const filePath = join(tempDir, 'test.jsonl');
      writeFileSync(filePath, jsonlContent);

      const results = [];
      for await (const result of parser.parseFile(filePath)) {
        results.push(result);
      }

      expect(results).toHaveLength(2);
      expect(results[0]?.success).toBe(true);
      expect(results[1]?.success).toBe(true);
      expect(results[0]?.entry!.surface).toBe("債權人");
      expect(results[1]?.entry!.surface).toBe("亡");
    });

    it('should skip empty lines', async () => {
      const content = `
${JSON.stringify({ surface: "test1", type: "vocab", lang: "zh-HK", readings: [{ jyutping: "test1", freq: 1, pos: "NOUN", register: "neutral", gloss: "test", source: "test" }] })}

${JSON.stringify({ surface: "test2", type: "vocab", lang: "zh-HK", readings: [{ jyutping: "test2", freq: 1, pos: "NOUN", register: "neutral", gloss: "test", source: "test" }] })}
`;

      const filePath = join(tempDir, 'test.jsonl');
      writeFileSync(filePath, content);

      const results = [];
      for await (const result of parser.parseFile(filePath)) {
        results.push(result);
      }

      expect(results).toHaveLength(2);
      expect(results[0]?.entry!.surface).toBe("test1");
      expect(results[1]?.entry!.surface).toBe("test2");
    });

    it('should handle mixed valid and invalid lines', async () => {
      const content = [
        JSON.stringify({ surface: "valid1", type: "vocab", lang: "zh-HK", readings: [{ jyutping: "test1", freq: 1, pos: "NOUN", register: "neutral", gloss: "test", source: "test" }] }),
        "invalid json {",
        JSON.stringify({ surface: "valid2", type: "vocab", lang: "zh-HK", readings: [{ jyutping: "test2", freq: 1, pos: "NOUN", register: "neutral", gloss: "test", source: "test" }] })
      ].join('\n');

      const filePath = join(tempDir, 'test.jsonl');
      writeFileSync(filePath, content);

      const results = [];
      for await (const result of parser.parseFile(filePath)) {
        results.push(result);
      }

      expect(results).toHaveLength(3);
      expect(results[0]?.success).toBe(true);
      expect(results[1]?.success).toBe(false);
      expect(results[2]?.success).toBe(true);
    });
  });

  describe('parseFileWithStats', () => {
    it('should return correct statistics', async () => {
      const content = [
        JSON.stringify({ surface: "valid1", type: "vocab", lang: "zh-HK", readings: [{ jyutping: "test1", freq: 1, pos: "NOUN", register: "neutral", gloss: "test", source: "test" }] }),
        "invalid json {",
        JSON.stringify({ surface: "valid2", type: "vocab", lang: "zh-HK", readings: [{ jyutping: "test2", freq: 1, pos: "NOUN", register: "neutral", gloss: "test", source: "test" }] }),
        "", // empty line should be ignored
        "another invalid line"
      ].join('\n');

      const filePath = join(tempDir, 'test.jsonl');
      writeFileSync(filePath, content);

      const stats = await parser.parseFileWithStats(filePath);

      expect(stats.totalLines).toBe(4); // empty line is skipped
      expect(stats.successfulEntries).toBe(2);
      expect(stats.failedEntries).toBe(2);
      expect(stats.errors).toHaveLength(2);
      expect(stats.errors[0]?.lineNumber).toBe(2);
      expect(stats.errors[1]?.lineNumber).toBe(5);
    });
  });

  describe('createJsonlParser', () => {
    it('should create a new parser instance', () => {
      const parser = createJsonlParser();
      expect(parser).toBeInstanceOf(JsonlParser);
    });
  });
});