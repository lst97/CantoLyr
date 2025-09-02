import { describe, it, expect } from 'vitest';
import { createLlmReranker, GeminiLlmReranker, DummyLlmReranker } from '../../../../../src/infrastructure/adapters/llm/index.js';

describe('LLM Adapter Factory', () => {
  describe('createLlmReranker', () => {
    it('should create GeminiLlmReranker for gemini provider', () => {
      const reranker = createLlmReranker({ 
        provider: 'gemini',
        apiKey: 'test-key'
      });
      
      expect(reranker).toBeInstanceOf(GeminiLlmReranker);
    });

    it('should create GeminiLlmReranker for google provider', () => {
      const reranker = createLlmReranker({ 
        provider: 'google',
        apiKey: process.env["GOOGLE_API_KEY"] || 'test-key'
      });
      
      expect(reranker).toBeInstanceOf(GeminiLlmReranker);
    });

    it('should create DummyLlmReranker for dummy provider', () => {
      const reranker = createLlmReranker({ 
        provider: 'dummy'
      });
      
      expect(reranker).toBeInstanceOf(DummyLlmReranker);
    });

    it('should create DummyLlmReranker for heuristic provider', () => {
      const reranker = createLlmReranker({ 
        provider: 'heuristic'
      });
      
      expect(reranker).toBeInstanceOf(DummyLlmReranker);
    });

    it('should create DummyLlmReranker by default when no provider specified', () => {
      const reranker = createLlmReranker({});
      
      expect(reranker).toBeInstanceOf(DummyLlmReranker);
    });

    it('should create DummyLlmReranker for unknown provider', () => {
      const reranker = createLlmReranker({ 
        provider: 'unknown-provider'
      });
      
      expect(reranker).toBeInstanceOf(DummyLlmReranker);
    });

    it('should handle case insensitive provider names', () => {
      const geminiReranker = createLlmReranker({ 
        provider: 'GEMINI',
        apiKey: 'test-key'
      });
      
      const dummyReranker = createLlmReranker({ 
        provider: 'DUMMY'
      });
      
      expect(geminiReranker).toBeInstanceOf(GeminiLlmReranker);
      expect(dummyReranker).toBeInstanceOf(DummyLlmReranker);
    });
  });
});