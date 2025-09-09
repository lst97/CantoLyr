/**
 * ToneMap value object represents a mapped tone pattern for Cantonese characters/words.
 *
 * Mapped tones use the following conversion:
 * 1 → 3, 2 → 9, 3 → 4, 4 → 0, 5 → 5, 6 → 2
 *
 * Valid mapped tone patterns contain only digits: 0, 2, 3, 4, 5, 9
 */
export class ToneMap {
  private readonly _value: string;

  constructor(value: string) {
    if (!ToneMap.isValid(value)) {
      throw new Error(
        `Invalid tone map: "${value}". Must contain only mapped tone digits: 0, 2, 3, 4, 5, 9`,
      );
    }
    this._value = value;
  }

  get value(): string {
    return this._value;
  }

  get length(): number {
    return this._value.length;
  }

  /**
   * Check if a string is a valid mapped tone pattern
   */
  static isValid(value: string): boolean {
    if (typeof value !== "string" || value.length === 0) {
      return false;
    }
    // Valid mapped tones: 0, 2, 3, 4, 5, 9
    return /^[023459]+$/.test(value);
  }

  /**
   * Check if this tone map starts with the given prefix
   */
  startsWith(prefix: string): boolean {
    return this._value.startsWith(prefix);
  }

  /**
   * Convert original tone digits to mapped tone digits
   * 1→3, 2→9, 3→4, 4→0, 5→5, 6→2
   */
  static mapTones(originalTones: string): ToneMap {
    const toneMapping: Record<string, string> = {
      "1": "3",
      "2": "9",
      "3": "4",
      "4": "0",
      "5": "5",
      "6": "2",
    };

    const mappedTones = originalTones
      .split("")
      .map((tone) => {
        if (tone in toneMapping) {
          return toneMapping[tone];
        }
        throw new Error(`Invalid original tone digit: "${tone}". Must be 1-6`);
      })
      .join("");

    return new ToneMap(mappedTones);
  }

  toString(): string {
    return this._value;
  }

  equals(other: ToneMap): boolean {
    return this._value === other._value;
  }
}
