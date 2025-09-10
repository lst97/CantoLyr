/**
 * Utilities for working with Jyutping romanization system
 */

/**
 * Extract tone digits from a jyutping string
 *
 * @param jyutping - Jyutping string like "zaai3 kyun4 jan1" or "mong4"
 * @returns String of tone digits like "341" or "4"
 *
 * @example
 * extractTones("zaai3 kyun4 jan1") // returns "341"
 * extractTones("mong4") // returns "4"
 * extractTones("hei3 haa6") // returns "36"
 */
export function extractTones(jyutping: string): string {
  if (typeof jyutping !== "string") {
    throw new Error("Jyutping must be a string");
  }

  // For spaced jyutping, split by spaces and extract tone from each syllable
  if (jyutping.includes(" ")) {
    const syllables = jyutping.trim().split(/\s+/);
    const tones: string[] = [];

    for (const syllable of syllables) {
      // Find the last digit (1-6) in each syllable - this should be the tone
      const toneMatch = syllable.match(/[1-6](?=[^1-6]*$)/);
      if (toneMatch) {
        tones.push(toneMatch[0]);
      }
    }

    if (tones.length === 0) {
      throw new Error(`No tone digits found in jyutping: "${jyutping}"`);
    }

    return tones.join("");
  } else {
    // For concatenated jyutping without spaces, match all tone digits
    // This is a simplified approach - in practice, proper syllable segmentation would be needed
    const toneMatches = jyutping.match(/[1-6]/g);

    if (!toneMatches || toneMatches.length === 0) {
      throw new Error(`No tone digits found in jyutping: "${jyutping}"`);
    }

    return toneMatches.join("");
  }
}

/**
 * Count the number of syllables in a jyutping string
 *
 * @param jyutping - Jyutping string like "zaai3 kyun4 jan4"
 * @returns Number of syllables
 *
 * @example
 * countSyllables("zaai3 kyun4 jan4") // returns 3
 * countSyllables("mong4") // returns 1
 */
export function countSyllables(jyutping: string): number {
  if (typeof jyutping !== "string") {
    throw new Error("Jyutping must be a string");
  }

  // Count tone digits as each represents one syllable
  const tones = extractTones(jyutping);
  return tones.length;
}

/**
 * Validate that a jyutping string is well-formed
 *
 * @param jyutping - Jyutping string to validate
 * @returns true if valid, false otherwise
 */
export function isValidJyutping(jyutping: string): boolean {
  if (typeof jyutping !== "string" || jyutping.trim().length === 0) {
    return false;
  }

  try {
    // Should be able to extract tones without error
    extractTones(jyutping);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize jyutping by trimming whitespace and converting to lowercase
 *
 * @param jyutping - Raw jyutping string
 * @returns Normalized jyutping string
 */
export function normalizeJyutping(jyutping: string): string {
  if (typeof jyutping !== "string") {
    throw new Error("Jyutping must be a string");
  }

  return jyutping.trim().toLowerCase();
}
