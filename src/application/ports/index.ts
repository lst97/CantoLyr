// Application ports (interfaces) for dependency inversion
export type { ReadingRepo, SearchQuery, ReadingDTO } from './ReadingRepo.js';
export type { WriteRepo, SelectionInput, FeedbackRecord } from './WriteRepo.js';
export type { Cache, CacheStats, CacheOptions } from './Cache.js';

// Legacy LLM reranker (deprecated)
export type { 
  LlmReranker, 
  RerankInput, 
  RerankResult, 
  RankingItem, 
  LlmConfig as LegacyLlmConfig
} from './LlmReranker.js';

// New LLM grouped selector
export type {
  LlmGroupedSelector,
  GroupedSelectionInput,
  GroupedSelectionResult,
  GroupSelection,
  LlmConfig
} from './LlmGroupedSelector.js';