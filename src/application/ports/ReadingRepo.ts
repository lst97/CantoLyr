import type { EntryType } from '../../shared/types/common.js';

/**
 * Search query parameters for reading repository
 */
export interface SearchQuery {
  /** Mapped tone pattern to search for (e.g., "403") */
  toneMapped: string;
  /** Whether to treat the pattern as a prefix */
  isPrefix?: boolean;
  /** Filter by entry type */
  entryType?: EntryType;
  /** Maximum number of results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Reading data transfer object for API responses
 */
export interface ReadingDTO {
  /** Reading ID */
  id: bigint;
  /** Entry ID this reading belongs to */
  entryId: bigint;
  /** The actual character/word text */
  surface: string;
  /** Entry type (vocab or char) */
  type: EntryType;
  /** Language code */
  lang: string;
  /** Jyutping pronunciation */
  jyutping: string;
  /** Original tone pattern extracted from jyutping */
  toneOriginal: string;
  /** Mapped tone pattern using tone conversion */
  toneMapped: string;
  /** Number of syllables */
  syllables: number;
  /** Frequency score */
  freq: number;
  /** Part of speech */
  pos: string;
  /** Register (formal, neutral, colloquial) */
  register: string;
  /** English gloss/definition */
  gloss: string;
  /** Data source identifier */
  source: string;
}

/**
 * Repository interface for reading operations (CQRS read side)
 * Handles tone-based search queries with optimized performance
 */
export interface ReadingRepo {
  /**
   * Search for readings by mapped tone pattern
   * Results are ordered deterministically by type, syllables, tone mapping, and jyutping
   */
  searchByToneMapped(query: SearchQuery): Promise<ReadingDTO[]>;

  /**
   * Get specific readings by their IDs
   * Used for compose operations and feedback recording
   */
  getByIds(ids: bigint[]): Promise<ReadingDTO[]>;

  /**
   * Get a single reading by ID
   * Returns null if not found
   */
  getById(id: bigint): Promise<ReadingDTO | null>;

  /**
   * Count total results for a search query (for pagination)
   */
  countByToneMapped(query: Omit<SearchQuery, 'limit' | 'offset'>): Promise<number>;
}