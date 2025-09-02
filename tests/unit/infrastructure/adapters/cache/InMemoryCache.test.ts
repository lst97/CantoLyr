import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InMemoryCache } from '../../../../../src/infrastructure/adapters/cache/InMemoryCache.js';

describe('InMemoryCache', () => {
  let cache: InMemoryCache;

  beforeEach(() => {
    cache = new InMemoryCache({
      defaultTtl: 60,
      maxSize: 100,
      enableStats: true,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Basic Operations', () => {
    it('should set and get values', async () => {
      await cache.set('key1', 'value1');
      const result = await cache.get('key1');
      expect(result).toBe('value1');
    });

    it('should return null for non-existent keys', async () => {
      const result = await cache.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should delete keys', async () => {
      await cache.set('key1', 'value1');
      const deleted = await cache.delete('key1');
      expect(deleted).toBe(true);
      
      const result = await cache.get('key1');
      expect(result).toBeNull();
    });

    it('should return false when deleting non-existent keys', async () => {
      const deleted = await cache.delete('nonexistent');
      expect(deleted).toBe(false);
    });

    it('should check if keys exist', async () => {
      await cache.set('key1', 'value1');
      expect(await cache.has('key1')).toBe(true);
      expect(await cache.has('nonexistent')).toBe(false);
    });

    it('should clear all entries', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      
      await cache.clear();
      
      expect(await cache.get('key1')).toBeNull();
      expect(await cache.get('key2')).toBeNull();
    });
  });

  describe('TTL Support', () => {
    it('should expire entries after TTL', async () => {
      vi.useFakeTimers();
      
      await cache.set('key1', 'value1', 1); // 1 second TTL
      
      // Should exist immediately
      expect(await cache.get('key1')).toBe('value1');
      
      // Fast forward 2 seconds
      vi.advanceTimersByTime(2000);
      
      // Should be expired
      expect(await cache.get('key1')).toBeNull();
      
      vi.useRealTimers();
    });

    it('should use default TTL when not specified', async () => {
      vi.useFakeTimers();
      
      await cache.set('key1', 'value1'); // Uses default TTL (60s)
      
      // Should exist before default TTL
      vi.advanceTimersByTime(30000); // 30 seconds
      expect(await cache.get('key1')).toBe('value1');
      
      // Should expire after default TTL
      vi.advanceTimersByTime(31000); // Total 61 seconds
      expect(await cache.get('key1')).toBeNull();
      
      vi.useRealTimers();
    });

    it('should return correct TTL for keys', async () => {
      vi.useFakeTimers();
      
      await cache.set('key1', 'value1', 60); // 60 seconds
      
      // Should return approximately 60 seconds
      const ttl = await cache.ttl('key1');
      expect(ttl).toBe(60);
      
      // Fast forward 30 seconds
      vi.advanceTimersByTime(30000);
      
      // Should return approximately 30 seconds
      const remainingTtl = await cache.ttl('key1');
      expect(remainingTtl).toBe(30);
      
      vi.useRealTimers();
    });

    it('should return -1 for non-existent keys', async () => {
      const ttl = await cache.ttl('nonexistent');
      expect(ttl).toBe(-1);
    });

    it('should return -1 for expired keys', async () => {
      vi.useFakeTimers();
      
      await cache.set('key1', 'value1', 1);
      vi.advanceTimersByTime(2000);
      
      const ttl = await cache.ttl('key1');
      expect(ttl).toBe(-1);
      
      vi.useRealTimers();
    });
  });

  describe('Multiple Operations', () => {
    it('should delete multiple keys', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');
      
      const deletedCount = await cache.deleteMany(['key1', 'key3', 'nonexistent']);
      expect(deletedCount).toBe(2);
      
      expect(await cache.get('key1')).toBeNull();
      expect(await cache.get('key2')).toBe('value2');
      expect(await cache.get('key3')).toBeNull();
    });

    it('should return all keys', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('prefix:key3', 'value3');
      
      const keys = await cache.keys();
      expect(keys).toHaveLength(3);
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toContain('prefix:key3');
    });

    it('should filter keys by pattern', async () => {
      await cache.set('user:1', 'user1');
      await cache.set('user:2', 'user2');
      await cache.set('post:1', 'post1');
      
      const userKeys = await cache.keys('user:*');
      expect(userKeys).toHaveLength(2);
      expect(userKeys).toContain('user:1');
      expect(userKeys).toContain('user:2');
      
      const singleCharKeys = await cache.keys('user:?');
      expect(singleCharKeys).toHaveLength(2);
      expect(singleCharKeys).toContain('user:1');
      expect(singleCharKeys).toContain('user:2');
    });
  });

  describe('Statistics', () => {
    it('should track cache statistics', async () => {
      // Initial stats
      let stats = await cache.getStats();
      expect(stats).toEqual({
        gets: 0,
        hits: 0,
        misses: 0,
        hitRatio: 0,
        sets: 0,
        deletes: 0,
        size: 0,
      });

      // Set a value
      await cache.set('key1', 'value1');
      stats = await cache.getStats();
      expect(stats?.sets).toBe(1);
      expect(stats?.size).toBe(1);

      // Cache hit
      await cache.get('key1');
      stats = await cache.getStats();
      expect(stats?.gets).toBe(1);
      expect(stats?.hits).toBe(1);
      expect(stats?.misses).toBe(0);
      expect(stats?.hitRatio).toBe(1);

      // Cache miss
      await cache.get('nonexistent');
      stats = await cache.getStats();
      expect(stats?.gets).toBe(2);
      expect(stats?.hits).toBe(1);
      expect(stats?.misses).toBe(1);
      expect(stats?.hitRatio).toBe(0.5);

      // Delete
      await cache.delete('key1');
      stats = await cache.getStats();
      expect(stats?.deletes).toBe(1);
      expect(stats?.size).toBe(0);
    });

    it('should reset statistics', async () => {
      await cache.set('key1', 'value1');
      await cache.get('key1');
      
      let stats = await cache.getStats();
      expect(stats?.sets).toBe(1);
      expect(stats?.gets).toBe(1);
      
      await cache.resetStats();
      
      stats = await cache.getStats();
      expect(stats?.sets).toBe(0);
      expect(stats?.gets).toBe(0);
      expect(stats?.size).toBe(1); // Size should reflect current state
    });

    it('should return null stats when disabled', async () => {
      const cacheWithoutStats = new InMemoryCache({ enableStats: false });
      const stats = await cacheWithoutStats.getStats();
      expect(stats).toBeNull();
    });
  });

  describe('Size Management', () => {
    it('should enforce max size by evicting oldest entries', async () => {
      const smallCache = new InMemoryCache({ maxSize: 2 });
      
      await smallCache.set('key1', 'value1', 100);
      await smallCache.set('key2', 'value2', 200);
      await smallCache.set('key3', 'value3', 300); // Should evict key1
      
      expect(await smallCache.get('key1')).toBeNull();
      expect(await smallCache.get('key2')).toBe('value2');
      expect(await smallCache.get('key3')).toBe('value3');
    });

    it('should not evict when updating existing keys', async () => {
      const smallCache = new InMemoryCache({ maxSize: 2 });
      
      await smallCache.set('key1', 'value1');
      await smallCache.set('key2', 'value2');
      await smallCache.set('key1', 'updated'); // Update existing key
      
      expect(await smallCache.get('key1')).toBe('updated');
      expect(await smallCache.get('key2')).toBe('value2');
    });
  });

  describe('Cache Key Generation', () => {
    it('should generate search cache keys', () => {
      const key1 = InMemoryCache.generateSearchKey({
        v: '123',
        mode: 'vocab',
        prefix: true,
        limit: 50
      });
      expect(key1).toBe('search:123:vocab:prefix:50');

      const key2 = InMemoryCache.generateSearchKey({
        v: '456'
      });
      expect(key2).toBe('search:456:all:exact:default');
    });

    it('should generate compose cache keys', () => {
      const key1 = InMemoryCache.generateComposeKey('123', 20);
      expect(key1).toBe('compose:123:20');

      const key2 = InMemoryCache.generateComposeKey('456');
      expect(key2).toBe('compose:456:default');
    });
  });

  describe('Cache Warming and Invalidation', () => {
    it('should warm cache with provided data', async () => {
      const warmupData = [
        { key: 'warm1', value: 'value1', ttl: 60 },
        { key: 'warm2', value: 'value2' }, // Uses default TTL
      ];

      await cache.warmCache(warmupData);

      expect(await cache.get('warm1')).toBe('value1');
      expect(await cache.get('warm2')).toBe('value2');
    });

    it('should invalidate entries matching pattern', async () => {
      await cache.set('user:1:profile', 'profile1');
      await cache.set('user:1:settings', 'settings1');
      await cache.set('user:2:profile', 'profile2');
      await cache.set('post:1', 'post1');

      const invalidatedCount = await cache.invalidatePattern('user:1:*');
      expect(invalidatedCount).toBe(2);

      expect(await cache.get('user:1:profile')).toBeNull();
      expect(await cache.get('user:1:settings')).toBeNull();
      expect(await cache.get('user:2:profile')).toBe('profile2');
      expect(await cache.get('post:1')).toBe('post1');
    });
  });

  describe('Data Types', () => {
    it('should handle different data types', async () => {
      // String
      await cache.set('string', 'hello');
      expect(await cache.get('string')).toBe('hello');

      // Number
      await cache.set('number', 42);
      expect(await cache.get('number')).toBe(42);

      // Boolean
      await cache.set('boolean', true);
      expect(await cache.get('boolean')).toBe(true);

      // Object
      const obj = { name: 'test', value: 123 };
      await cache.set('object', obj);
      expect(await cache.get('object')).toEqual(obj);

      // Array
      const arr = [1, 2, 3];
      await cache.set('array', arr);
      expect(await cache.get('array')).toEqual(arr);

      // Null
      await cache.set('null', null);
      expect(await cache.get('null')).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle expired entries in has() method', async () => {
      vi.useFakeTimers();
      
      await cache.set('key1', 'value1', 1);
      expect(await cache.has('key1')).toBe(true);
      
      vi.advanceTimersByTime(2000);
      expect(await cache.has('key1')).toBe(false);
      
      vi.useRealTimers();
    });

    it('should handle concurrent operations', async () => {
      const promises = [];
      
      // Concurrent sets
      for (let i = 0; i < 10; i++) {
        promises.push(cache.set(`key${i}`, `value${i}`));
      }
      
      await Promise.all(promises);
      
      // Verify all values were set
      for (let i = 0; i < 10; i++) {
        expect(await cache.get(`key${i}`)).toBe(`value${i}`);
      }
    });

    it('should handle empty string keys and values', async () => {
      await cache.set('', 'empty key');
      expect(await cache.get('')).toBe('empty key');
      
      await cache.set('empty-value', '');
      expect(await cache.get('empty-value')).toBe('');
    });
  });
});