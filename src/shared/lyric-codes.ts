/**
 * Warning and error codes for the Cantonese lyric generation system
 * These codes are used to categorize different types of issues that can occur
 * during the lyric generation pipeline
 */

/**
 * Warning codes for non-critical issues that don't prevent generation
 */
export enum LyricWarningCode {
  /**
   * Semantic similarity is below the configured threshold
   * Generation may proceed but with potentially lower quality results
   */
  WARN_LOW_SEMANTIC = "WARN_LOW_SEMANTIC",

  /**
   * Insufficient high-frequency candidates found
   * System fell back to lower frequency options
   */
  WARN_LOW_FREQUENCY = "WARN_LOW_FREQUENCY",

  /**
   * Tone compliance check found partial matches
   * Some syllables may not perfectly match the target tone pattern
   */
  WARN_PARTIAL_TONE_MATCH = "WARN_PARTIAL_TONE_MATCH",

  /**
   * Generation retry occurred due to quality constraints
   * Final result may differ from initial attempt
   */
  WARN_GENERATION_RETRY = "WARN_GENERATION_RETRY",

  /**
   * Cache miss for semantic search
   * Computation took longer than expected
   */
  WARN_CACHE_MISS = "WARN_CACHE_MISS",
}

/**
 * Error codes for critical issues that prevent successful generation
 */
export enum LyricErrorCode {
  /**
   * No semantic matches found above minimum threshold
   * Cannot proceed with generation due to lack of relevant content
   */
  ERROR_NO_SEMANTIC_MATCHES = "ERROR_NO_SEMANTIC_MATCHES",

  /**
   * Insufficient digit patterns available for the requested tone sequence
   * The tone constraint cannot be satisfied with available vocabulary
   */
  ERROR_DIGIT_INSUFFICIENT = "ERROR_DIGIT_INSUFFICIENT",

  /**
   * LLM generation failed after all retry attempts
   * External service or model issue
   */
  ERROR_GENERATION_FAILED = "ERROR_GENERATION_FAILED",

  /**
   * Embedding service unavailable or failed
   * Cannot compute semantic similarity
   */
  ERROR_EMBEDDING_FAILED = "ERROR_EMBEDDING_FAILED",

  /**
   * Database query failed or returned no results
   * Cannot retrieve lexical candidates
   */
  ERROR_DATABASE_UNAVAILABLE = "ERROR_DATABASE_UNAVAILABLE",

  /**
   * Operation timed out
   * Generation took too long to complete
   */
  ERROR_TIMEOUT = "ERROR_TIMEOUT",

  /**
   * Invalid input parameters or constraints
   * Request validation failed
   */
  ERROR_INVALID_INPUT = "ERROR_INVALID_INPUT",

  /**
   * Internal system error
   * Unexpected failure in processing pipeline
   */
  ERROR_INTERNAL = "ERROR_INTERNAL",
}

/**
 * Union type of all lyric codes
 */
export type LyricCode = LyricWarningCode | LyricErrorCode;

/**
 * Check if a code is a warning (non-critical)
 */
export function isWarning(code: LyricCode): code is LyricWarningCode {
  return Object.values(LyricWarningCode).includes(code as LyricWarningCode);
}

/**
 * Check if a code is an error (critical)
 */
export function isError(code: LyricCode): code is LyricErrorCode {
  return Object.values(LyricErrorCode).includes(code as LyricErrorCode);
}

/**
 * Get human-readable description for a lyric code
 */
export function getCodeDescription(code: LyricCode): string {
  const descriptions: Record<LyricCode, string> = {
    // Warnings
    [LyricWarningCode.WARN_LOW_SEMANTIC]:
      "Semantic similarity below threshold - results may be less relevant",
    [LyricWarningCode.WARN_LOW_FREQUENCY]:
      "Insufficient high-frequency candidates - using lower frequency options",
    [LyricWarningCode.WARN_PARTIAL_TONE_MATCH]:
      "Partial tone pattern match - some syllables may not match perfectly",
    [LyricWarningCode.WARN_GENERATION_RETRY]:
      "Generation retry occurred - final result differs from initial attempt",
    [LyricWarningCode.WARN_CACHE_MISS]: "Cache miss for semantic search - computation took longer",

    // Errors
    [LyricErrorCode.ERROR_NO_SEMANTIC_MATCHES]: "No semantic matches found above minimum threshold",
    [LyricErrorCode.ERROR_DIGIT_INSUFFICIENT]:
      "Insufficient digit patterns for requested tone sequence",
    [LyricErrorCode.ERROR_GENERATION_FAILED]: "LLM generation failed after all retry attempts",
    [LyricErrorCode.ERROR_EMBEDDING_FAILED]: "Embedding service unavailable or failed",
    [LyricErrorCode.ERROR_DATABASE_UNAVAILABLE]: "Database query failed or returned no results",
    [LyricErrorCode.ERROR_TIMEOUT]: "Operation timed out - generation took too long",
    [LyricErrorCode.ERROR_INVALID_INPUT]: "Invalid input parameters or constraints",
    [LyricErrorCode.ERROR_INTERNAL]: "Internal system error - unexpected failure",
  };

  return descriptions[code] || "Unknown error code";
}
