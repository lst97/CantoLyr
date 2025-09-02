import { describe, it, expect, beforeEach } from 'vitest';
import { DummyLlmReranker } from '../../../../../src/infrastructure/adapters/llm/DummyLlmReranker.js';
import type { RerankInput, LlmConfig } from '../../../../../src/application/ports/LlmReranker.js';
import type { ReadingDTO } from '../../../../../src/application/ports/ReadingRepo.js';

describe('DummyLlmReranker', () => {
  let reranker: DummyLlmReranker;
  let config: LlmConfig;
  let mockInput: RerankInput;
  let mockCandidates: ReadingDTO[];

  beforeEach(() => {
    config = {
      enableFallback: true
    };

    mockCandidates = [
      {
        id: BigInt(1),
        entryId: BigInt(101),
        surface: '愛',
        type: 'vocab' as const,
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
      },
      {
        id: BigInt(3),
        entryId: BigInt(103),
        surface: '低',
        type: 'char' as const,
        lang: 'zh-CN',
        jyutping: 'dai1',
        toneOriginal: '1',
        toneMapped: '3',
        syllables: 1,
        freq: 15.2,
        pos: 'ADJ',
        register: 'formal',
        gloss: 'low',
        source: 'test'
      }
    ];

    mockInput = {
      candidates: mockCandidates,
      tonePattern: '43',
      topK: 10
    };

    reranker = new DummyLlmReranker(config);
  });

  describe('constructor', () => {
    it('should create instance with config', () => {
      expect(reranker).toBeInstanceOf(DummyLlmReranker);
    });

    it('should create instance without config', () => {
      const defaultReranker = new DummyLlmReranker();
      expect(defaultReranker).toBeInstanceOf(DummyLlmReranker);
    });
  });

  describe('validateConfig', () => {
    it('should always pass validation', async () => {
      await expect(reranker.validateConfig()).resolves.not.toThrow();
    });
  });

  describe('isAvailable', () => {
    it('should always return true', async () => {
      const result = await reranker.isAvailable();
      expect(result).toBe(true);
    });
  });

  describe('getInfo', () => {
    it('should return correct provider info', () => {
      const info = reranker.getInfo();
      expect(info).toEqual({
        provider: 'Dummy Heuristic',
        model: 'heuristic-v1',
        version: '1.0'
      });
    });
  });

  describe('rerank', () => {
    it('should successfully rerank candidates', async () => {
      const result = await reranker.rerank(mockInput);

      expect(result.success).toBe(true);
      expect(result.rankings).toHaveLength(3);
      expect(result.model).toBe('dummy-heuristic');
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
      
      // Check that all rankings have required fields
      result.rankings.forEach(ranking => {
        expect(ranking.readingId).toBeDefined();
        expect(typeof ranking.score).toBe('number');
        expect(ranking.score).toBeGreaterThanOrEqual(0);
        expect(ranking.score).toBeLessThanOrEqual(1);
        expect(typeof ranking.reason).toBe('string');
      });
    });

    it('should rank by heuristic scores in descending order', async () => {
      const result = await reranker.rerank(mockInput);

      expect(result.success).toBe(true);
      
      // Scores should be in descending order
      for (let i = 1; i < result.rankings.length; i++) {
        expect(result.rankings[i - 1]!.score).toBeGreaterThanOrEqual(result.rankings[i]!.score);
      }
    });

    it('should respect topK limit', async () => {
      const limitedInput = { ...mockInput, topK: 2 };
      const result = await reranker.rerank(limitedInput);

      expect(result.success).toBe(true);
      expect(result.rankings).toHaveLength(2);
    });

    it('should handle empty candidates', async () => {
      const emptyInput = { ...mockInput, candidates: [] };
      const result = await reranker.rerank(emptyInput);

      expect(result.success).toBe(true);
      expect(result.rankings).toHaveLength(0);
    });

    it('should prefer higher frequency candidates', async () => {
      const highFreqCandidate: ReadingDTO = {
        ...mockCandidates[0]!,
        id: BigInt(999),
        entryId: BigInt(999),
        freq: 150.0
      };

      const inputWithHighFreq = {
        ...mockInput,
        candidates: [highFreqCandidate, ...mockCandidates]
      };

      const result = await reranker.rerank(inputWithHighFreq);

      expect(result.success).toBe(true);
      // High frequency candidate should be ranked first
      expect(result.rankings[0]!.readingId).toBe(BigInt(999));
    });

    it('should prefer neutral register', async () => {
      const neutralCandidate: ReadingDTO = {
        ...mockCandidates[0]!,
        id: BigInt(888),
        entryId: BigInt(888),
        register: 'neutral',
        freq: 50 // Lower frequency to test register preference
      };

      const formalCandidate: ReadingDTO = {
        ...mockCandidates[0]!,
        id: BigInt(777),
        entryId: BigInt(777),
        register: 'formal',
        freq: 50
      };

      const inputWithRegisterTest = {
        ...mockInput,
        candidates: [formalCandidate, neutralCandidate]
      };

      const result = await reranker.rerank(inputWithRegisterTest);

      expect(result.success).toBe(true);
      // Neutral should score higher than formal
      const neutralScore = result.rankings.find(r => r.readingId === BigInt(888))?.score;
      const formalScore = result.rankings.find(r => r.readingId === BigInt(777))?.score;
      
      expect(neutralScore).toBeGreaterThan(formalScore!);
    });

    it('should prefer vocab over char type', async () => {
      const vocabCandidate: ReadingDTO = {
        ...mockCandidates[0]!,
        id: BigInt(666),
        entryId: BigInt(666),
        type: 'vocab' as const,
        freq: 50
      };

      const charCandidate: ReadingDTO = {
        ...mockCandidates[0]!,
        id: BigInt(555),
        entryId: BigInt(555),
        type: 'char' as const,
        freq: 50
      };

      const inputWithTypeTest = {
        ...mockInput,
        candidates: [charCandidate, vocabCandidate]
      };

      const result = await reranker.rerank(inputWithTypeTest);

      expect(result.success).toBe(true);
      // Vocab should score higher than char
      const vocabScore = result.rankings.find(r => r.readingId === BigInt(666))?.score;
      const charScore = result.rankings.find(r => r.readingId === BigInt(555))?.score;
      
      expect(vocabScore).toBeGreaterThan(charScore!);
    });

    it('should prefer zh-HK language', async () => {
      const hkCandidate: ReadingDTO = {
        ...mockCandidates[0]!,
        id: BigInt(444),
        entryId: BigInt(444),
        lang: 'zh-HK',
        freq: 50
      };

      const cnCandidate: ReadingDTO = {
        ...mockCandidates[0]!,
        id: BigInt(333),
        entryId: BigInt(333),
        lang: 'zh-CN',
        freq: 50
      };

      const inputWithLangTest = {
        ...mockInput,
        candidates: [cnCandidate, hkCandidate]
      };

      const result = await reranker.rerank(inputWithLangTest);

      expect(result.success).toBe(true);
      // HK should score higher than CN
      const hkScore = result.rankings.find(r => r.readingId === BigInt(444))?.score;
      const cnScore = result.rankings.find(r => r.readingId === BigInt(333))?.score;
      
      expect(hkScore).toBeGreaterThan(cnScore!);
    });

    it('should prefer matching syllable count', async () => {
      const matchingSyllables: ReadingDTO = {
        ...mockCandidates[0]!,
        id: BigInt(222),
        entryId: BigInt(222),
        syllables: 2, // Matches tonePattern length
        freq: 50
      };

      const nonMatchingSyllables: ReadingDTO = {
        ...mockCandidates[0]!,
        id: BigInt(111),
        entryId: BigInt(111),
        syllables: 4, // Doesn't match tonePattern length
        freq: 50
      };

      const inputWithSyllableTest = {
        ...mockInput,
        tonePattern: '43', // 2 syllables
        candidates: [nonMatchingSyllables, matchingSyllables]
      };

      const result = await reranker.rerank(inputWithSyllableTest);

      expect(result.success).toBe(true);
      // Matching syllables should score higher
      const matchingScore = result.rankings.find(r => r.readingId === BigInt(222))?.score;
      const nonMatchingScore = result.rankings.find(r => r.readingId === BigInt(111))?.score;
      
      expect(matchingScore).toBeGreaterThan(nonMatchingScore!);
    });

    it('should generate appropriate reasons', async () => {
      const result = await reranker.rerank(mockInput);

      expect(result.success).toBe(true);
      
      result.rankings.forEach(ranking => {
        expect(ranking.reason).toBeDefined();
        expect(ranking.reason!.length).toBeGreaterThan(0);
        
        if (ranking.score > 0.8) {
          expect(ranking.reason).toContain('Excellent choice');
        } else if (ranking.score > 0.6) {
          expect(ranking.reason).toContain('Good option');
        } else if (ranking.score > 0.4) {
          expect(ranking.reason).toContain('Acceptable');
        } else {
          expect(ranking.reason).toContain('Lower priority');
        }
      });
    });

    it('should handle different POS preferences', async () => {
      const nounCandidate: ReadingDTO = {
        ...mockCandidates[0]!,
        id: BigInt(100),
        entryId: BigInt(100),
        pos: 'NOUN',
        freq: 50
      };

      const letterCandidate: ReadingDTO = {
        ...mockCandidates[0]!,
        id: BigInt(200),
        entryId: BigInt(200),
        pos: 'LETTER',
        freq: 50
      };

      const inputWithPosTest = {
        ...mockInput,
        candidates: [letterCandidate, nounCandidate]
      };

      const result = await reranker.rerank(inputWithPosTest);

      expect(result.success).toBe(true);
      // NOUN should score higher than LETTER
      const nounScore = result.rankings.find(r => r.readingId === BigInt(100))?.score;
      const letterScore = result.rankings.find(r => r.readingId === BigInt(200))?.score;
      
      expect(nounScore).toBeGreaterThan(letterScore!);
    });
  });
});