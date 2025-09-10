/**
 * RankCombiner domain service combines heuristic and LLM scores
 * according to the specified weighting formula.
 *
 * Formula: (llm ?? 0) * 0.7 + heuristic * 0.3
 */
export class RankCombiner {
  private static readonly LLM_WEIGHT = 0.7;
  private static readonly HEURISTIC_WEIGHT = 0.3;

  /**
   * Combine heuristic and LLM scores using weighted formula
   *
   * @param heuristic - Heuristic score (required)
   * @param llm - LLM score (optional, defaults to 0 if not provided)
   * @returns Combined score
   */
  static combineScores(heuristic: number, llm?: number): number {
    // Validate heuristic score
    if (typeof heuristic !== "number" || !isFinite(heuristic)) {
      throw new Error("Heuristic score must be a finite number");
    }

    // Validate LLM score if provided
    if (llm !== undefined && (typeof llm !== "number" || !isFinite(llm))) {
      throw new Error("LLM score must be a finite number");
    }

    // Apply weighting formula
    const llmScore = llm ?? 0;
    return llmScore * this.LLM_WEIGHT + heuristic * this.HEURISTIC_WEIGHT;
  }

  /**
   * Get the weighting configuration
   */
  static getWeights(): { llm: number; heuristic: number } {
    return {
      llm: this.LLM_WEIGHT,
      heuristic: this.HEURISTIC_WEIGHT,
    };
  }

  /**
   * Combine multiple score pairs
   *
   * @param scorePairs - Array of {heuristic, llm?} score pairs
   * @returns Array of combined scores
   */
  static combineMultipleScores(
    scorePairs: Array<{ heuristic: number; llm?: number }>,
  ): number[] {
    return scorePairs.map(({ heuristic, llm }) => this.combineScores(heuristic, llm));
  }
}
