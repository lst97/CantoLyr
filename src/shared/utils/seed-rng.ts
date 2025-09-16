/**
 * Deterministic pseudo-random number generator (PRNG) wrapper
 * Uses Linear Congruential Generator (LCG) for reproducible results
 */

export interface SeedRng {
  /**
   * Generate a random number between 0 and 1
   */
  random(): number;

  /**
   * Generate a random integer between min (inclusive) and max (exclusive)
   */
  randomInt(min: number, max: number): number;

  /**
   * Generate a random integer between 0 and max (exclusive)
   */
  randomInt(max: number): number;

  /**
   * Select a random element from an array
   */
  choice<T>(array: readonly T[]): T;

  /**
   * Shuffle an array in place using Fisher-Yates algorithm
   */
  shuffle<T>(array: T[]): T[];

  /**
   * Get the current seed value
   */
  getSeed(): number;

  /**
   * Reset the generator with a new seed
   */
  reset(seed: number): void;
}

/**
 * Linear Congruential Generator parameters
 * These values provide a good balance of randomness and period length
 */
const LCG_A = 1664525;
const LCG_C = 1013904223;
const LCG_M = 2 ** 32;

/**
 * Create a seeded random number generator
 * @param seed - Initial seed value (must be a positive integer)
 * @returns SeedRng instance
 */
export function createSeedRng(seed: number): SeedRng {
  if (!Number.isInteger(seed) || seed <= 0) {
    throw new Error("Seed must be a positive integer");
  }

  let currentSeed = seed;

  /**
   * Generate next random number using LCG
   */
  function next(): number {
    currentSeed = (LCG_A * currentSeed + LCG_C) % LCG_M;
    return currentSeed / LCG_M;
  }

  return {
    random(): number {
      return next();
    },

    randomInt(min: number, max?: number): number {
      if (max === undefined) {
        max = min;
        min = 0;
      }

      if (!Number.isInteger(min) || !Number.isInteger(max)) {
        throw new Error("Min and max must be integers");
      }

      if (min >= max) {
        throw new Error("Min must be less than max");
      }

      const range = max - min;
      return Math.floor(next() * range) + min;
    },

    choice<T>(array: readonly T[]): T {
      if (array.length === 0) {
        throw new Error("Cannot choose from empty array");
      }

      const index = Math.floor(next() * array.length);
      return array[index];
    },

    shuffle<T>(array: T[]): T[] {
      // Fisher-Yates shuffle algorithm
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    },

    getSeed(): number {
      return currentSeed;
    },

    reset(newSeed: number): void {
      if (!Number.isInteger(newSeed) || newSeed <= 0) {
        throw new Error("Seed must be a positive integer");
      }
      currentSeed = newSeed;
    },
  };
}
