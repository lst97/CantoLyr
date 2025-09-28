// New grouped selector exports
export { GeminiLlmGroupedSelector } from "./GeminiLlmGroupedSelector.ts";
export { MvpPrefilterService } from "./MvpPrefilterService.ts";

import type {
  LlmConfig,
  LlmGroupedSelector,
} from "../../../application/ports/LlmGroupedSelector.ts";
import { GeminiLlmGroupedSelector } from "./GeminiLlmGroupedSelector.ts";

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
      throw new Error(`Unsupported LLM grouped selector provider: ${provider}`);
  }
}
