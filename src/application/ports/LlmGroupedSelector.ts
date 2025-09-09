import type { Group } from "../services/mvpPrefilter.ts";

/**
 * Input for LLM grouped selection operation
 */
export interface GroupedSelectionInput {
	/** Groups of prefiltered candidates organized by tone pattern */
	groups: Group[];
	/** Optional theme for creative selection */
	theme?: string;
	/** Optional mood for creative selection */
	mood?: string;
	/** Optional genre for creative selection */
	genre?: string;
	/** Optional language specification */
	language?: string;
}

/**
 * Individual selection from a group
 */
export interface GroupSelection {
	/** Group number (1-based) */
	group: number;
	/** Option number within the group (1-based) */
	option: number;
	/** The selected surface text */
	surface: string;
	/** Reading ID for mapping back to database */
	readingId: bigint;
}

/**
 * Result from LLM grouped selection operation
 */
export interface GroupedSelectionResult {
	/** Selected options from each group */
	selections: GroupSelection[];
	/** Composed line from concatenated selections */
	line: string;
	/** Optional reasoning from the LLM */
	reason?: string;
	/** Whether the LLM operation was successful */
	success: boolean;
	/** Error message if operation failed */
	error?: string;
	/** Model used for selection */
	model?: string;
	/** Processing time in milliseconds */
	processingTimeMs?: number;
}

/**
 * Configuration for LLM grouped selector
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
	/** Whether to enable fallback to heuristic selection */
	enableFallback?: boolean;
}

/**
 * Port interface for LLM-powered grouped selection
 * Supports multiple LLM providers (Gemini, OpenAI, etc.) and fallback strategies
 */
export interface LlmGroupedSelector {
	/**
	 * Select one option from each group using LLM intelligence
	 * Considers theme, mood, genre, and creative composition
	 */
	selectFromGroups(
		input: GroupedSelectionInput
	): Promise<GroupedSelectionResult>;

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
	validateConfig(): void;
}
