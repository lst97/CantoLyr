// Legacy reranker exports (deprecated)
export { GeminiLlmReranker } from "./GeminiLlmReranker.js";
export { DummyLlmReranker } from "./DummyLlmReranker.js";

// New grouped selector exports
export { GeminiLlmGroupedSelector } from "./GeminiLlmGroupedSelector.js";
export { DummyLlmGroupedSelector } from "./DummyLlmGroupedSelector.js";
export { MvpPrefilterService } from "./MvpPrefilterService.js";

import type {
  LlmConfig as LegacyLlmConfig,
  LlmReranker,
} from "../../../application/ports/LlmReranker.js";
import type {
  LlmConfig,
  LlmGroupedSelector,
} from "../../../application/ports/LlmGroupedSelector.js";
import type { PrefilterService } from "../../../application/services/mvpPrefilter.js";
import { GeminiLlmReranker } from "./GeminiLlmReranker.js";
import { DummyLlmReranker } from "./DummyLlmReranker.js";
import { GeminiLlmGroupedSelector } from "./GeminiLlmGroupedSelector.js";
import { DummyLlmGroupedSelector } from "./DummyLlmGroupedSelector.js";
import { MvpPrefilterService } from "./MvpPrefilterService.js";

/**
 * Factory function to create appropriate LLM grouped selector based on configuration
 */
export function createLlmGroupedSelector(
  config: LlmConfig & { provider?: string },
): LlmGroupedSelector {
  const provider = config.provider?.toLowerCase() || "dummy";

  switch (provider) {
    case "gemini":
    case "google":
      return new GeminiLlmGroupedSelector(config);
    case "dummy":
    case "heuristic":
    default:
      return new DummyLlmGroupedSelector(config);
  }
}

/**
 * Factory function to create prefilter service
 */
export function createPrefilterService(): PrefilterService {
  return new MvpPrefilterService();
}

/**
 * Legacy factory function to create appropriate LLM reranker based on configuration
 * @deprecated Use createLlmGroupedSelector instead
 */
export function createLlmReranker(config: LegacyLlmConfig & { provider?: string }): LlmReranker {
  const provider = config.provider?.toLowerCase() || "dummy";

  switch (provider) {
    case "gemini":
    case "google":
      return new GeminiLlmReranker(config);
    case "dummy":
    case "heuristic":
    default:
      return new DummyLlmReranker(config);
  }
}
