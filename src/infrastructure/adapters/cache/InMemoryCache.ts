// deno-lint-ignore-file require-await
import { Cache, CacheOptions, CacheStats } from "../../../application/ports/Cache.ts";

/**
 * Cache entry with expiration timestamp
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * In-memory cache implementation with TTL support
 * Suitable for MVP and single-instance deployments
 */
export class InMemoryCache implements Cache {
  private readonly cache = new Map<string, CacheEntry<any>>();
  private readonly options: Required<CacheOptions>;
  private stats: CacheStats;

  constructor(options: CacheOptions = {}) {
    this.options = {
      defaultTtl: options.defaultTtl ?? 60,
      maxSize: options.maxSize ?? 1000,
      enableStats: options.enableStats ?? true,
    };

    this.stats = {
      gets: 0,
      hits: 0,
      misses: 0,
      hitRatio: 0,
      sets: 0,
      deletes: 0,
      size: 0,
    };

    // Start cleanup interval to remove expired entries
    this.startCleanupInterval();
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.options.enableStats) {
      this.stats.gets++;
    }

    const entry = this.cache.get(key);

    if (!entry) {
      if (this.options.enableStats) {
        this.stats.misses++;
        this.updateHitRatio();
      }
      return null;
    }

    // Check if entry has expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      if (this.options.enableStats) {
        this.stats.misses++;
        this.stats.size = this.cache.size;
        this.updateHitRatio();
      }
      return null;
    }

    if (this.options.enableStats) {
      this.stats.hits++;
      this.updateHitRatio();
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSec?: number): Promise<void> {
    const ttl = ttlSec ?? this.options.defaultTtl;
    const expiresAt = Date.now() + ttl * 1000;

    // Enforce max size by removing oldest entries
    if (this.cache.size >= this.options.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    this.cache.set(key, { value, expiresAt });

    if (this.options.enableStats) {
      this.stats.sets++;
      this.stats.size = this.cache.size;
    }
  }

  async delete(key: string): Promise<boolean> {
    const deleted = this.cache.delete(key);

    if (this.options.enableStats && deleted) {
      this.stats.deletes++;
      this.stats.size = this.cache.size;
    }

    return deleted;
  }

  async deleteMany(keys: string[]): Promise<number> {
    let deletedCount = 0;

    for (const key of keys) {
      if (this.cache.delete(key)) {
        deletedCount++;
      }
    }

    if (this.options.enableStats) {
      this.stats.deletes += deletedCount;
      this.stats.size = this.cache.size;
    }

    return deletedCount;
  }

  async clear(): Promise<void> {
    const size = this.cache.size;
    this.cache.clear();

    if (this.options.enableStats) {
      this.stats.deletes += size;
      this.stats.size = 0;
    }
  }

  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    // Check if entry has expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      if (this.options.enableStats) {
        this.stats.size = this.cache.size;
      }
      return false;
    }

    return true;
  }

  async getStats(): Promise<CacheStats | null> {
    if (!this.options.enableStats) {
      return null;
    }

    return { ...this.stats };
  }

  async resetStats(): Promise<void> {
    this.stats = {
      gets: 0,
      hits: 0,
      misses: 0,
      hitRatio: 0,
      sets: 0,
      deletes: 0,
      size: this.cache.size,
    };
  }

  async keys(pattern?: string): Promise<string[]> {
    const allKeys = Array.from(this.cache.keys());

    if (!pattern) {
      return allKeys;
    }

    // Convert glob pattern to regex
    const regexPattern = pattern.replace(/\*/g, ".*").replace(/\?/g, ".");
    const regex = new RegExp(`^${regexPattern}$`);

    return allKeys.filter((key) => regex.test(key));
  }

  async ttl(key: string): Promise<number> {
    const entry = this.cache.get(key);

    if (!entry) {
      return -1; // Key doesn't exist
    }

    const remainingMs = entry.expiresAt - Date.now();

    if (remainingMs <= 0) {
      // Key has expired, remove it
      this.cache.delete(key);
      if (this.options.enableStats) {
        this.stats.size = this.cache.size;
      }
      return -1;
    }

    return Math.ceil(remainingMs / 1000);
  }

  /**
   * Generate cache key for search queries
   */
  static generateSearchKey(query: {
    v: string;
    mode?: string;
    prefix?: boolean;
    limit?: number;
  }): string {
    const parts = [
      "search",
      query.v,
      query.mode || "all",
      query.prefix ? "prefix" : "exact",
      query.limit?.toString() || "default",
    ];
    return parts.join(":");
  }

  /**
   * Generate cache key for compose queries
   */
  static generateComposeKey(toneMap: string, topK?: number): string {
    return `compose:${toneMap}:${topK || "default"}`;
  }

  /**
   * Warm cache with frequently accessed data
   */
  async warmCache(
    warmupData: Array<{ key: string; value: any; ttl?: number }>,
  ): Promise<void> {
    for (const item of warmupData) {
      await this.set(item.key, item.value, item.ttl);
    }
  }

  /**
   * Invalidate cache entries matching a pattern
   */
  async invalidatePattern(pattern: string): Promise<number> {
    const keysToDelete = await this.keys(pattern);
    return await this.deleteMany(keysToDelete);
  }

  private updateHitRatio(): void {
    this.stats.hitRatio = this.stats.gets > 0 ? this.stats.hits / this.stats.gets : 0;
  }

  private evictOldest(): void {
    // Find the entry with the earliest expiration time
    let oldestKey: string | null = null;
    let oldestExpiration = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < oldestExpiration) {
        oldestExpiration = entry.expiresAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  private startCleanupInterval(): void {
    // Clean up expired entries every 30 seconds
    setInterval(() => {
      this.cleanupExpired();
    }, 30000);
  }

  private cleanupExpired(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    if (this.options.enableStats && keysToDelete.length > 0) {
      this.stats.size = this.cache.size;
    }
  }
}
