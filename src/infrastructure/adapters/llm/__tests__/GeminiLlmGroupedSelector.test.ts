import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiLlmGroupedSelector } from '../GeminiLlmGroupedSelector.js';
import type { GroupedSelectionInput } from '../../../../application/ports/LlmGroupedSelector.js';
import type { Group } from '../../../../application/services/mvpPrefilter.js';

// Mock the Google GenAI SDK
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: vi.fn()
    }
  }))
}));

describe('GeminiLlmGroupedSelector', () => {
  let selector: GeminiLlmGroupedSelector;
  let mockGenAI: any;

  beforeEach(async () => {
    const { GoogleGenAI } = vi.mocked(await import('@google/genai'));
    mockGenAI = {
      models: {
        generateContent: vi.fn()
      }
    };
    (GoogleGenAI as any).mockImplementation(() => mockGenAI);

    selector = new GeminiLlmGroupedSelector({
      apiKey: 'test-api-key',
      model: 'gemini-2.5-flash',
      timeoutMs: 5000
    });
  });

  const createTestGroups = (): Group[] => [
    {
      groupIndex: 1,
      pattern: '3',
      options: [
        { option: 1, surface: '愛', readingId: BigInt(1), freq: 85 },
        { option: 2, surface: '我', readingId: BigInt(2), freq: 95 }
      ]
    },
    {
      groupIndex: 2,
      pattern: '4',
      options: [
        { option: 1, surface: '你', readingId: BigInt(3), freq: 90 },
        { option: 2, surface: '他', readingId: BigInt(4), freq: 75 }
      ]
    }
  ];

  describe('selectFromGroups', () => {
    it('should successfully select from groups with valid Gemini response', async () => {
      const groups = createTestGroups();
      const input: GroupedSelectionInput = {
        groups,
        theme: 'love',
        mood: 'romantic'
      };

      const mockResponse = {
        text: JSON.stringify({
          selections: [
            { group: 1, option: 1 },
            { group: 2, option: 1 }
          ],
          line: '愛你',
          reason: 'Perfect romantic combination'
        })
      };

      mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

      const result = await selector.selectFromGroups(input);

      expect(result.success).toBe(true);
      expect(result.selections).toHaveLength(2);
      expect(result.selections[0]).toEqual({
        group: 1,
        option: 1,
        surface: '愛',
        readingId: BigInt(1)
      });
      expect(result.selections[1]).toEqual({
        group: 2,
        option: 1,
        surface: '你',
        readingId: BigInt(3)
      });
      expect(result.line).toBe('愛你');
      expect(result.reason).toBe('Perfect romantic combination');
      expect(result.model).toBe('gemini-2.5-flash');
    });

    it('should handle invalid JSON response gracefully', async () => {
      const groups = createTestGroups();
      const input: GroupedSelectionInput = { groups };

      const mockResponse = {
        text: 'This is not valid JSON'
      };

      mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

      const result = await selector.selectFromGroups(input);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No JSON found in Gemini response');
      expect(result.selections).toHaveLength(0);
    });

    it('should handle invalid group/option numbers', async () => {
      const groups = createTestGroups();
      const input: GroupedSelectionInput = { groups };

      const mockResponse = {
        text: JSON.stringify({
          selections: [
            { group: 1, option: 5 }, // Invalid option number
            { group: 2, option: 1 }
          ],
          line: 'test'
        })
      };

      mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

      const result = await selector.selectFromGroups(input);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid option number');
    });

    it('should handle API timeout', async () => {
      const groups = createTestGroups();
      const input: GroupedSelectionInput = { groups };

      mockGenAI.models.generateContent.mockImplementation(() => 
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout')), 100);
        })
      );

      const result = await selector.selectFromGroups(input);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Timeout');
    });

    it('should validate missing selections for all groups', async () => {
      const groups = createTestGroups();
      const input: GroupedSelectionInput = { groups };

      const mockResponse = {
        text: JSON.stringify({
          selections: [
            { group: 1, option: 1 }
            // Missing group 2 selection
          ],
          line: '愛'
        })
      };

      mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

      const result = await selector.selectFromGroups(input);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Expected 2 selections, got 1');
    });
  });

  describe('isAvailable', () => {
    it('should return true when properly configured', async () => {
      const available = await selector.isAvailable();
      expect(available).toBe(true);
    });

    it('should return false when API key is missing', async () => {
      const selectorWithoutKey = new GeminiLlmGroupedSelector({});
      const available = await selectorWithoutKey.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('getInfo', () => {
    it('should return correct provider information', () => {
      const info = selector.getInfo();
      expect(info.provider).toBe('Google Gemini');
      expect(info.model).toBe('gemini-2.5-flash');
      expect(info.version).toBe('2.0');
    });
  });

  describe('validateConfig', () => {
    it('should pass validation with valid config', async () => {
      await expect(selector.validateConfig()).resolves.not.toThrow();
    });

    it('should throw error when API key is missing', async () => {
      const selectorWithoutKey = new GeminiLlmGroupedSelector({});
      await expect(selectorWithoutKey.validateConfig()).rejects.toThrow('Gemini API key is required');
    });

    it('should throw error when timeout is invalid', async () => {
      const selectorWithInvalidTimeout = new GeminiLlmGroupedSelector({
        apiKey: 'test-key',
        timeoutMs: -1
      });
      await expect(selectorWithInvalidTimeout.validateConfig()).rejects.toThrow('Timeout must be positive');
    });
  });
});