import { ToneMap } from '../value-objects/ToneMap.js';
import { extractTones, countSyllables, normalizeJyutping } from '../../shared/utils/jyutping.js';
import type { PartOfSpeech, Register } from '../../shared/types/common.js';

/**
 * Reading entity represents pronunciation and tone information for an entry
 */
export class Reading {
  readonly id: bigint;
  readonly entryId: bigint;
  readonly jyutping: string;
  readonly toneOriginal: string;
  readonly toneMapped: ToneMap;
  readonly syllables: number;
  readonly freq: number;
  readonly pos: PartOfSpeech;
  readonly register: Register;
  readonly gloss: string;
  readonly source: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(params: {
    id: bigint;
    entryId: bigint;
    jyutping: string;
    freq: number;
    pos: PartOfSpeech;
    register: Register;
    gloss: string;
    source: string;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    // Validate and normalize jyutping
    const normalizedJyutping = normalizeJyutping(params.jyutping);
    
    // Extract tone information
    const toneOriginal = extractTones(normalizedJyutping);
    const syllables = countSyllables(normalizedJyutping);

    // Validate frequency
    if (params.freq < 0) {
      throw new Error('Frequency must be non-negative');
    }

    // Validate gloss
    if (!params.gloss || params.gloss.trim().length === 0) {
      throw new Error('Gloss cannot be empty');
    }

    // Validate source
    if (!params.source || params.source.trim().length === 0) {
      throw new Error('Source cannot be empty');
    }

    this.id = params.id;
    this.entryId = params.entryId;
    this.jyutping = normalizedJyutping;
    this.toneOriginal = toneOriginal;
    this.toneMapped = ToneMap.mapTones(toneOriginal);
    this.syllables = syllables;
    this.freq = params.freq;
    this.pos = params.pos;
    this.register = params.register;
    this.gloss = params.gloss.trim();
    this.source = params.source.trim();
    this.createdAt = params.createdAt || new Date();
    this.updatedAt = params.updatedAt || new Date();
  }

  /**
   * Check if this reading matches a tone pattern query
   */
  matchesTonePattern(pattern: string, isPrefix: boolean = false): boolean {
    if (isPrefix) {
      return this.toneMapped.startsWith(pattern);
    }
    return this.toneMapped.value === pattern;
  }

  /**
   * Get a display-friendly representation of this reading
   */
  getDisplayInfo(): {
    surface: string;
    jyutping: string;
    tones: string;
    syllables: number;
    pos: string;
    gloss: string;
  } {
    return {
      surface: '', // Will be filled by Entry
      jyutping: this.jyutping,
      tones: this.toneMapped.value,
      syllables: this.syllables,
      pos: this.pos,
      gloss: this.gloss
    };
  }

  /**
   * Create a Reading from raw data (for data import)
   */
  static fromRawData(params: {
    id: bigint;
    entryId: bigint;
    jyutping: string;
    freq: number;
    pos: string;
    register: string;
    gloss: string;
    source: string;
  }): Reading {
    // Normalize and validate POS
    const normalizedPos = params.pos.toUpperCase() as PartOfSpeech;
    const validPos: PartOfSpeech[] = [
      'NOUN', 'ADJ', 'NUM', 'LETTER', 'VERB', 'ADV', 
      'PREP', 'CONJ', 'INTJ', 'PRON', 'DET', 'PART', 'UNKNOWN'
    ];
    
    const pos = validPos.includes(normalizedPos) ? normalizedPos : 'UNKNOWN';

    // Normalize and validate register
    const normalizedRegister = params.register.toLowerCase();
    const validRegisters: Register[] = ['formal', 'neutral', 'colloquial'];
    const register = validRegisters.includes(normalizedRegister as Register) 
      ? (normalizedRegister as Register) 
      : 'neutral';

    return new Reading({
      id: params.id,
      entryId: params.entryId,
      jyutping: params.jyutping,
      freq: params.freq,
      pos,
      register,
      gloss: params.gloss,
      source: params.source
    });
  }
}