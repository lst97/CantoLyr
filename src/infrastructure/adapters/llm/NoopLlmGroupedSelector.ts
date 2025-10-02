import type {
  GroupedSelectionInput,
  GroupedSelectionResult,
  LlmConfig,
  LlmGroupedSelector,
} from "../../../application/ports/LlmGroupedSelector.ts";

interface NoopConfig extends LlmConfig {
  reason?: string;
  provider?: string;
}

/**
 * No-op implementation used when an LLM provider is unavailable or disabled.
 * Always reports itself as unavailable so callers can execute heuristic fallbacks.
 */
export class NoopLlmGroupedSelector implements LlmGroupedSelector {
  constructor(private readonly config: NoopConfig = {}) {}

  selectFromGroups(
    _input: GroupedSelectionInput,
  ): Promise<GroupedSelectionResult> {
    return Promise.resolve({
      selections: [],
      line: "",
      success: false,
      error: this.config.reason ?? "LLM grouped selector disabled",
      model: this.config.model ?? "noop",
      processingTimeMs: 0,
    });
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(false);
  }

  getInfo() {
    return {
      provider: this.config.provider ?? "noop",
      model: this.config.model ?? "noop",
      version: "1.0",
    };
  }

  validateConfig(): void {
    // Nothing to validate for noop implementation.
  }
}
