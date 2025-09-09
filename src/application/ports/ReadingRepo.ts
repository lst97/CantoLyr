import type { EntryType } from "../../shared/types/common.ts";

/**
 * Search query parameters for reading repository
 */
export interface SearchQuery {
	/** Mapped tone pattern to search for (e.g., "403") */
	pronunciation: string;
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
	/** Jyutping grouped to surface tokens */
	jyutping: string[];
	/** Original tone pattern */
	tone: string;
	/** Mapped tone pattern (pronunciation) */
	pronunciation: string;
	/** Per-syllable initials */
	consonants: string[];
	/** Per-syllable rhymes */
	rhymes: string[];
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
	 * Get specific readings by their IDs
	 * Used for compose operations and feedback recording
	 */
	getByIds(ids: bigint[]): Promise<ReadingDTO[]>;

	/**
	 * Get a single reading by ID
	 * Returns null if not found
	 */
	getById(id: bigint): Promise<ReadingDTO | null>;

	/** Search by new mapped pronunciation field (equivalent to toneMapped) */
	searchByPronunciation(query: SearchQuery): Promise<ReadingDTO[]>;

	/** Count by new pronunciation field */
	countByPronunciation(
		query: Omit<SearchQuery, "limit" | "offset">
	): Promise<number>;

	/** Find readings that contain a specific rhyme in their decomposition */
	searchByRhyme(query: {
		rhyme: string;
		entryType?: EntryType;
		limit?: number;
		offset?: number;
	}): Promise<ReadingDTO[]>;
}
