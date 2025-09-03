import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiLlmReranker } from '../../../../../src/infrastructure/adapters/llm/GeminiLlmReranker.js';
import type { RerankInput, LlmConfig } from '../../../../../src/application/ports/LlmReranker.js';
import type { ReadingDTO } from '../../../../../src/application/ports/ReadingRepo.js';

// Mock the GoogleGenAI SDK
const mockGenerateContent = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent
    }
  }))
}));

describe('GeminiLlmReranker', () => {
  let reranker: GeminiLlmReranker;
  let config: LlmConfig;
  let mockInput: RerankInput;
  let mockCandidates: ReadingDTO[];

  beforeEach(() => {
    config = {
      apiKey: 'test-api-key',
      model: 'gemini-2.5-flash',
      timeoutMs: 5000,
      maxRetries: 3
    };

    mockCandidates = [
      {
        id: BigInt(1),
        entryId: BigInt(101),
        surface: '愛',
        type: 'char' as const,
        lang: 'zh-HK',
        jyutping: 'oi3',
        toneOriginal: '3',
        toneMapped: '4',
        syllables: 1,
        freq: 85.5,
        pos: 'VERB',
        register: 'neutral',
        gloss: 'love',
        source: 'test'
      },
      {
        id: BigInt(2),
        entryId: BigInt(102),
        surface: '心',
        type: 'char' as const,
        lang: 'zh-HK',
        jyutping: 'sam1',
        toneOriginal: '1',
        toneMapped: '3',
        syllables: 1,
        freq: 92.1,
        pos: 'NOUN',
        register: 'neutral',
        gloss: 'heart',
        source: 'test'
      }
    ];

    mockInput = {
      candidates: mockCandidates,
      tonePattern: '43',
      topK: 10
    };

    reranker = new GeminiLlmReranker(config);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with valid config', () => {
      expect(reranker).toBeInstanceOf(GeminiLlmReranker);
    });
  });

  describe('validateConfig', () => {
    it('should pass with valid config', async () => {
      await expect(reranker.validateConfig()).resolves.not.toThrow();
    });

    it('should throw error when API key is missing', async () => {
      const invalidReranker = new GeminiLlmReranker({} as LlmConfig);
      await expect(invalidReranker.validateConfig()).rejects.toThrow('Gemini API key is required');
    });

    it('should throw error when timeout is invalid', async () => {
      const invalidReranker = new GeminiLlmReranker({ ...config, timeoutMs: -1 });
      await expect(invalidReranker.validateConfig()).rejects.toThrow('Timeout must be positive');
    });

    it('should throw error when maxRetries is invalid', async () => {
      const invalidReranker = new GeminiLlmReranker({ ...config, maxRetries: -1 });
      await expect(invalidReranker.validateConfig()).rejects.toThrow('Max retries cannot be negative');
    });
  });

  describe('isAvailable', () => {
    it('should return true when config is valid', async () => {
      const result = await reranker.isAvailable();
      expect(result).toBe(true);
    });

    it('should return false when config is invalid', async () => {
      const invalidReranker = new GeminiLlmReranker({} as LlmConfig);
      const result = await invalidReranker.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('getInfo', () => {
    it('should return correct provider info', () => {
      const info = reranker.getInfo();
      expect(info).toEqual({
        provider: 'Google Gemini',
        model: 'gemini-2.5-flash',
        version: '2.0'
      });
    });

    it('should use default model when not specified', () => {
      const defaultReranker = new GeminiLlmReranker({ apiKey: 'test' });
      const info = defaultReranker.getInfo();
      expect(info.model).toBe('gemini-2.5-flash');
    });
  });

  describe('rerank', () => {
    const mockSdkResponse = {
      text: JSON.stringify({
        rankings: [
          { readingId: '1', score: 0.9, reason: 'Perfect for romantic lyrics' },
          { readingId: '2', score: 0.7, reason: 'Good semantic fit' }
        ]
      })
    };

    it('should successfully rerank candidates', async () => {
      mockGenerateContent.mockResolvedValueOnce(mockSdkResponse);

      const result = await reranker.rerank(mockInput);

      expect(result.success).toBe(true);
      expect(result.rankings).toHaveLength(2);
      expect(result.rankings[0]).toEqual({
        readingId: BigInt(1),
        score: 0.9,
        reason: 'Perfect for romantic lyrics'
      });
      expect(result.model).toBe('gemini-2.5-flash');
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle API errors gracefully', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('API Error: Bad Request'));

      const result = await reranker.rerank(mockInput);

      expect(result.success).toBe(false);
      expect(result.error).toContain('API Error: Bad Request');
      expect(result.rankings).toHaveLength(0);
    });

    it('should handle network timeouts', async () => {
      const shortTimeoutReranker = new GeminiLlmReranker({ ...config, timeoutMs: 100 });
      
      mockGenerateContent.mockImplementationOnce(() => 
        new Promise((resolve) => {
          setTimeout(() => resolve(mockSdkResponse), 200);
        })
      );

      const result = await shortTimeoutReranker.rerank(mockInput);

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });

    it('should handle invalid JSON responses', async () => {
      const invalidResponse = {
        text: 'This is not valid JSON'
      };

      mockGenerateContent.mockResolvedValueOnce(invalidResponse);

      const result = await reranker.rerank(mockInput);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse Gemini rankings');
    });

    it('should filter out invalid reading IDs', async () => {
      const responseWithInvalidIds = {
        text: JSON.stringify({
          rankings: [
            { readingId: '1', score: 0.9, reason: 'Valid ID' },
            { readingId: '999', score: 0.8, reason: 'Invalid ID' },
            { readingId: '2', score: 0.7, reason: 'Valid ID' }
          ]
        })
      };

      mockGenerateContent.mockResolvedValueOnce(responseWithInvalidIds);

      const result = await reranker.rerank(mockInput);

      expect(result.success).toBe(true);
      expect(result.rankings).toHaveLength(2);
      expect(result.rankings.map(r => r.readingId)).toEqual([BigInt(1), BigInt(2)]);
    });

    it('should clamp scores to valid range', async () => {
      const responseWithInvalidScores = {
        text: `{"rankings": [{"readingId": "1", "score": 1.5, "reason": "Score too high"}, {"readingId": "2", "score": -0.5, "reason": "Score too low"}]}`
      };

      mockGenerateContent.mockResolvedValueOnce(responseWithInvalidScores);

      const result = await reranker.rerank(mockInput);

      expect(result.success).toBe(true);
      expect(result.rankings).toHaveLength(2);
      expect(result.rankings[0]?.score).toBe(1.0);
      expect(result.rankings[1]?.score).toBe(0.0);
    });

    it('should include constraints and context in prompt', async () => {
      const inputWithExtras = {
        ...mockInput,
        constraints: { theme: 'romantic' },
        context: { mood: 'happy' }
      };

      mockGenerateContent.mockResolvedValueOnce(mockSdkResponse);

      await reranker.rerank(inputWithExtras);

      const callArgs = mockGenerateContent.mock.calls[0]?.[0];
      const prompt = callArgs.contents;

      expect(prompt).toContain('Constraints: {"theme":"romantic"}');
      expect(prompt).toContain('Context: {"mood":"happy"}');
    });

    it('should handle missing API response content', async () => {
      const emptyResponse = {
        text: undefined
      };

      mockGenerateContent.mockResolvedValueOnce(emptyResponse);

      const result = await reranker.rerank(mockInput);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No text content in Gemini response');
    });
  });
});