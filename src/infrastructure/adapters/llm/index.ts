export { GeminiLlmReranker } from './GeminiLlmReranker.js';
export { DummyLlmReranker } from './DummyLlmReranker.js';

import type { LlmReranker, LlmConfig } from '../../../application/ports/LlmReranker.js';
import { GeminiLlmReranker } from './GeminiLlmReranker.js';
import { DummyLlmReranker } from './DummyLlmReranker.js';

/**
 * Factory function to create appropriate LLM reranker based on configuration
 */
export function createLlmReranker(config: LlmConfig & { provider?: string }): LlmReranker {
  const provider = config.provider?.toLowerCase() || 'dummy';
  
  switch (provider) {
    case 'gemini':
    case 'google':
      return new GeminiLlmReranker(config);
    case 'dummy':
    case 'heuristic':
    default:
      return new DummyLlmReranker(config);
  }
}