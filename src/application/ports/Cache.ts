/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  /** Total number of get operations */
  gets: number;
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Cache hit ratio (hits / gets) */
  hitRatio: number;
  /** Number of set operations */
  sets: number;
  /** Number of delete operations */
  deletes: number;
  /** Current number of cached items */
  size: number;
}

/**
 * Cache configuration options
 */
export interface CacheOptions {
  /** Default TTL in seconds */
  defaultTtl?: number;
  /** Maximum number of items to cache */
  maxSize?: number;
  /** Whether to enable cache statistics */
  enableStats?: boolean;
}

/**
 * Port interface for pluggable caching
 * Supports both in-memory (MVP) and distributed caching (Redis)
 */
export interface Cache {
  /**
   * Get a value from the cache
   * Returns null if key doesn't exist or has expired
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Set a value in the cache with TTL
   * @param key Cache key
   * @param value Value to cache (must be serializable)
   * @param ttlSec Time to live in seconds
   */
  set<T>(key: string, value: T, ttlSec: number): Promise<void>;

  /**
   * Set a value in the cache with default TTL
   */
  set<T>(key: string, value: T): Promise<void>;

  /**
   * Delete a specific key from the cache
   */
  delete(key: string): Promise<boolean>;

  /**
   * Delete multiple keys from the cache
   * Returns the number of keys that were deleted
   */
  deleteMany(keys: string[]): Promise<number>;

  /**
   * Clear all cached items
   */
  clear(): Promise<void>;

  /**
   * Check if a key exists in the cache
   */
  has(key: string): Promise<boolean>;

  /**
   * Get cache statistics (if enabled)
   * Returns null if statistics are disabled
   */
  getStats(): Promise<CacheStats | null>;

  /**
   * Reset cache statistics
   */
  resetStats(): Promise<void>;

  /**
   * Get all keys matching a pattern (for debugging/monitoring)
   * Pattern uses glob-style matching (* and ?)
   */
  keys(pattern?: string): Promise<string[]>;

  /**
   * Get the remaining TTL for a key in seconds
   * Returns -1 if key doesn't exist, -2 if key exists but has no TTL
   */
  ttl(key: string): Promise<number>;
}