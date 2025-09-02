import type { ReadingDTO } from './ReadingRepo.js';

/**
 * Input for LLM reranking operation
 */
export interface RerankInput {
  /** List of candidate readings to rerank */
  candidates: ReadingDTO[];
  /** Target tone pattern for the composition */
  tonePattern: string;
  /** Optional constraints for the composition */
  constraints?: Record<string, any>;
  /** Optional context to help with ranking decisions */
  context?: Record<string, any>;
  /** Maximum number of results to return */
  topK?: number;
}

/**
 * Individual ranking result from LLM
 */
export interface RankingItem {
  /** Reading ID */
  readingId: bigint;
  /** LLM-assigned score (0.0 to 1.0) */
  score: number;
  /** Optional reasoning from the LLM */
  reason?: string;
}

/**
 * Result from LLM reranking operation
 */
export interface RerankResult {
  /** Reranked items with scores */
  rankings: RankingItem[];
  /** Whether the LLM operation was successful */
  success: boolean;
  /** Error message if operation failed */
  error?: string;
  /** Model used for reranking */
  model?: string;
  /** Processing time in milliseconds */
  processingTimeMs?: number;
}

/**
 * Configuration for LLM reranker
 */
export interface LlmConfig {
  /** API key for the LLM service */
  apiKey?: string;
  /** Model name to use */
  model?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Maximum number of retries */
  maxRetries?: number;
  /** Whether to enable fallback to heuristic ranking */
  enableFallback?: boolean;
}

/**
 * Port interface for LLM-powered reranking
 * Supports multiple LLM providers (Gemini, OpenAI, etc.) and fallback strategies
 */
export interface LlmReranker {
  /**
   * Rerank a list of candidate readings using LLM intelligence
   * Considers tone matching, semantic appropriateness, and context
   */
  rerank(input: RerankInput): Promise<RerankResult>;

  /**
   * Check if the LLM service is available and configured
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get information about the LLM service
   */
  getInfo(): {
    provider: string;
    model: string;
    version?: string;
  };

  /**
   * Validate the LLM configuration
   * Throws an error if configuration is invalid
   */
  validateConfig(): Promise<void>;
}