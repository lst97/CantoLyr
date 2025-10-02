// New grouped selector exports
export { GeminiLlmGroupedSelector } from "./GeminiLlmGroupedSelector.ts";
export { MvpPrefilterService } from "./MvpPrefilterService.ts";
export { NoopLlmGroupedSelector } from "./NoopLlmGroupedSelector.ts";

import type {
  LlmConfig,
  LlmGroupedSelector,
} from "../../../application/ports/LlmGroupedSelector.ts";
import { GeminiLlmGroupedSelector } from "./GeminiLlmGroupedSelector.ts";
import { NoopLlmGroupedSelector } from "./NoopLlmGroupedSelector.ts";

/**
 * Factory function to create appropriate LLM grouped selector based on configuration
 */
export function createLlmGroupedSelector(
  config: LlmConfig & { provider?: string },
): LlmGroupedSelector {
  const provider = config.provider?.toLowerCase() || "gemini";

  if (provider === "gemini" || provider === "google") {
    if (!config.apiKey) {
      return new NoopLlmGroupedSelector({
        ...config,
        provider,
        reason: "Gemini API key is not configured",
      });
    }
    return new GeminiLlmGroupedSelector(config);
  }

  return new NoopLlmGroupedSelector({
    ...config,
    provider,
    reason: `Unsupported LLM grouped selector provider: ${provider}`,
  });
}
