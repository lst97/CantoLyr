import type { ReadingDTO, ReadingRepo } from "../ports/ReadingRepo.ts";
import type { Cache } from "../ports/Cache.ts";
import type { EntryType } from "../../shared/types/common.ts";

/**
 * Input for search use case
 */
export interface SearchInput {
  /** Mapped tone pattern to search for */
  tonePattern: string;
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
 * Output from search use case
 */
export interface SearchOutput {
  /** Search query that was executed */
  query: string;
  /** Total number of results found */
  count: number;
  /** Array of matching readings */
  items: ReadingDTO[];
  /** Whether results came from cache */
  fromCache: boolean;
  /** Processing time in milliseconds */
  processingTimeMs: number;
}

/**
 * Use case for tone-based search with caching integration
 * Implements requirement 1.1-1.6 for fast character/word retrieval
 */
export class SearchUseCase {
  private static readonly CACHE_TTL_SECONDS = 300; // 5 minutes
  private static readonly DEFAULT_LIMIT = 50;
  private static readonly MAX_LIMIT = 9999;

  constructor(
    private readonly readingRepo: ReadingRepo,
    private readonly cache: Cache,
  ) {}

  /**
   * Execute search with caching
   * Results are cached for performance optimization
   */
  async execute(input: SearchInput): Promise<SearchOutput> {
    const startTime = Date.now();

    // Validate and normalize input
    const normalizedInput = this.validateAndNormalizeInput(input);

    // Generate cache key
    const cacheKey = this.generateCacheKey(normalizedInput);

    // Try to get from cache first
    const cachedResult = await this.cache.get<SearchOutput>(cacheKey);
    if (cachedResult) {
      return {
        ...cachedResult,
        fromCache: true,
        processingTimeMs: Date.now() - startTime,
      };
    }

    // Execute search query
    const items = await this.readingRepo.searchByPronunciation({
      pronunciation: normalizedInput.tonePattern,
      isPrefix: normalizedInput.isPrefix,
      limit: normalizedInput.limit,
      offset: normalizedInput.offset,
      ...(normalizedInput.entryType && {
        entryType: normalizedInput.entryType,
      }),
    });

    // Get total count for pagination (without limit/offset)
    const count = await this.readingRepo.countByPronunciation({
      pronunciation: normalizedInput.tonePattern,
      isPrefix: normalizedInput.isPrefix,
      ...(normalizedInput.entryType && {
        entryType: normalizedInput.entryType,
      }),
    });

    const result: SearchOutput = {
      query: normalizedInput.tonePattern,
      count,
      items,
      fromCache: false,
      processingTimeMs: Date.now() - startTime,
    };

    // Cache the result
    await this.cache.set(cacheKey, result, SearchUseCase.CACHE_TTL_SECONDS);

    return result;
  }

  /**
   * Validate and normalize search input
   */
  private validateAndNormalizeInput(
    input: SearchInput,
  ): SearchInput & { limit: number; offset: number; isPrefix: boolean } {
    if (!input.tonePattern) {
      throw new Error("Tone pattern is required");
    }

    // Validate tone pattern format (mapped tones: 0,3,9,4,5,2)
    if (!/^[039452\s]+$/.test(input.tonePattern)) {
      throw new Error(
        "Invalid tone pattern. Must contain only mapped tone digits (0,3,9,4,5,2) and spaces",
      );
    }

    const limit = Math.min(
      input.limit ?? SearchUseCase.DEFAULT_LIMIT,
      SearchUseCase.MAX_LIMIT,
    );

    return {
      ...input,
      tonePattern: input.tonePattern.trim(),
      isPrefix: input.isPrefix ?? false,
      limit,
      offset: input.offset ?? 0,
    };
  }

  /**
   * Generate cache key for search parameters
   */
  private generateCacheKey(
    input: SearchInput & { limit: number; offset: number; isPrefix: boolean },
  ): string {
    const parts = [
      "search",
      input.tonePattern,
      input.isPrefix ? "prefix" : "exact",
      input.entryType ?? "all",
      input.limit.toString(),
      input.offset.toString(),
    ];
    return parts.join(":");
  }
}
