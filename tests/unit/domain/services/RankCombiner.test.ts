import { describe, it, expect } from "vitest";
import { RankCombiner } from "../../../../src/domain/services/RankCombiner.js";

describe("RankCombiner", () => {
  describe("combineScores", () => {
    it("should combine heuristic and LLM scores with correct weighting", () => {
      // Formula: (llm ?? 0) * 0.7 + heuristic * 0.3
      const heuristic = 0.6;
      const llm = 0.8;
      const expected = 0.8 * 0.7 + 0.6 * 0.3; // 0.56 + 0.18 = 0.74

      const result = RankCombiner.combineScores(heuristic, llm);
      expect(result).toBeCloseTo(expected, 10);
    });

    it("should use 0 for LLM score when not provided", () => {
      const heuristic = 0.6;
      const expected = 0 * 0.7 + 0.6 * 0.3; // 0 + 0.18 = 0.18

      const result = RankCombiner.combineScores(heuristic);
      expect(result).toBeCloseTo(expected, 10);
    });

    it("should handle edge case scores", () => {
      // Test with 0 scores
      expect(RankCombiner.combineScores(0, 0)).toBe(0);

      // Test with 1.0 scores
      const result1 = RankCombiner.combineScores(1.0, 1.0);
      expect(result1).toBeCloseTo(1.0, 10);

      // Test with only heuristic = 1.0
      const result2 = RankCombiner.combineScores(1.0);
      expect(result2).toBeCloseTo(0.3, 10);

      // Test with only LLM = 1.0
      const result3 = RankCombiner.combineScores(0, 1.0);
      expect(result3).toBeCloseTo(0.7, 10);
    });

    it("should handle negative scores", () => {
      const result = RankCombiner.combineScores(-0.5, -0.3);
      const expected = -0.3 * 0.7 + -0.5 * 0.3; // -0.21 + (-0.15) = -0.36
      expect(result).toBeCloseTo(expected, 10);
    });

    it("should handle decimal scores", () => {
      const result = RankCombiner.combineScores(0.123, 0.456);
      const expected = 0.456 * 0.7 + 0.123 * 0.3; // 0.3192 + 0.0369 = 0.3561
      expect(result).toBeCloseTo(expected, 10);
    });

    it("should throw error for invalid heuristic score", () => {
      expect(() => RankCombiner.combineScores(NaN)).toThrow(
        "Heuristic score must be a finite number"
      );
      expect(() => RankCombiner.combineScores(Infinity)).toThrow(
        "Heuristic score must be a finite number"
      );
      expect(() => RankCombiner.combineScores(-Infinity)).toThrow(
        "Heuristic score must be a finite number"
      );
      expect(() => RankCombiner.combineScores("0.5" as any)).toThrow(
        "Heuristic score must be a finite number"
      );
      expect(() => RankCombiner.combineScores(null as any)).toThrow(
        "Heuristic score must be a finite number"
      );
    });

    it("should throw error for invalid LLM score", () => {
      expect(() => RankCombiner.combineScores(0.5, NaN)).toThrow(
        "LLM score must be a finite number"
      );
      expect(() => RankCombiner.combineScores(0.5, Infinity)).toThrow(
        "LLM score must be a finite number"
      );
      expect(() => RankCombiner.combineScores(0.5, -Infinity)).toThrow(
        "LLM score must be a finite number"
      );
      expect(() => RankCombiner.combineScores(0.5, "0.8" as any)).toThrow(
        "LLM score must be a finite number"
      );
    });
  });

  describe("getWeights", () => {
    it("should return correct weight configuration", () => {
      const weights = RankCombiner.getWeights();
      expect(weights).toEqual({
        llm: 0.7,
        heuristic: 0.3,
      });
    });

    it("should return weights that sum to 1.0", () => {
      const weights = RankCombiner.getWeights();
      expect(weights.llm + weights.heuristic).toBeCloseTo(1.0, 10);
    });
  });

  describe("combineMultipleScores", () => {
    it("should combine multiple score pairs", () => {
      const scorePairs = [
        { heuristic: 0.6, llm: 0.8 },
        { heuristic: 0.4, llm: 0.9 },
        { heuristic: 0.7 }, // No LLM score
      ];

      const results = RankCombiner.combineMultipleScores(scorePairs);

      expect(results).toHaveLength(3);

      // First pair: 0.8 * 0.7 + 0.6 * 0.3 = 0.74
      expect(results[0]).toBeCloseTo(0.74, 10);

      // Second pair: 0.9 * 0.7 + 0.4 * 0.3 = 0.75
      expect(results[1]).toBeCloseTo(0.75, 10);

      // Third pair: 0 * 0.7 + 0.7 * 0.3 = 0.21
      expect(results[2]).toBeCloseTo(0.21, 10);
    });

    it("should handle empty array", () => {
      const results = RankCombiner.combineMultipleScores([]);
      expect(results).toEqual([]);
    });

    it("should handle array with single score pair", () => {
      const results = RankCombiner.combineMultipleScores([
        { heuristic: 0.5, llm: 0.6 },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0]).toBeCloseTo(0.57, 10); // 0.6 * 0.7 + 0.5 * 0.3
    });

    it("should propagate validation errors", () => {
      expect(() =>
        RankCombiner.combineMultipleScores([{ heuristic: NaN, llm: 0.5 }])
      ).toThrow("Heuristic score must be a finite number");

      expect(() =>
        RankCombiner.combineMultipleScores([{ heuristic: 0.5, llm: NaN }])
      ).toThrow("LLM score must be a finite number");
    });
  });

  describe("integration scenarios", () => {
    it("should handle realistic scoring scenarios", () => {
      // Scenario 1: High LLM, low heuristic
      const result1 = RankCombiner.combineScores(0.2, 0.9);
      expect(result1).toBeCloseTo(0.69, 10); // LLM dominates

      // Scenario 2: Low LLM, high heuristic
      const result2 = RankCombiner.combineScores(0.9, 0.2);
      expect(result2).toBeCloseTo(0.41, 10); // Still LLM weighted higher

      // Scenario 3: No LLM, only heuristic
      const result3 = RankCombiner.combineScores(0.8);
      expect(result3).toBeCloseTo(0.24, 10); // Only heuristic contribution

      // Scenario 4: Balanced scores
      const result4 = RankCombiner.combineScores(0.5, 0.5);
      expect(result4).toBeCloseTo(0.5, 10); // Should equal input when balanced
    });

    it("should maintain score ordering in typical cases", () => {
      // When LLM scores are available and different
      const scores = [
        { heuristic: 0.5, llm: 0.9 }, // Should rank highest
        { heuristic: 0.5, llm: 0.7 }, // Should rank middle
        { heuristic: 0.5, llm: 0.3 }, // Should rank lowest
      ];

      const results = RankCombiner.combineMultipleScores(scores);

      // Results should be in descending order
      expect(results[0]).toBeGreaterThan(Number(results[1]));
      expect(results[1]).toBeGreaterThan(Number(results[2]));
    });
  });
});
