import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryCache } from "../../../src/infrastructure/adapters/cache/InMemoryCache.js";
import type { ReadingDTO } from "../../../src/application/ports/ReadingRepo.js";

describe("InMemoryCache Integration", () => {
	let cache: InMemoryCache;

	beforeEach(() => {
		cache = new InMemoryCache({
			defaultTtl: 60,
			maxSize: 100,
			enableStats: true,
		});
	});

	describe("Search Result Caching", () => {
		it("should cache and retrieve search results", async () => {
			const mockSearchResults: ReadingDTO[] = [
				{
					id: BigInt(1),
					entryId: BigInt(1),
					surface: "債權人",
					type: "vocab",
					lang: "zh-HK",
					jyutping: ["zaai3", "kyun4", "jan4"],
					tone: "341",
					pronunciation: "403",
					consonants: ["z", "k", "j"],
					rhymes: ["aai3", "yun4", "an4"],
					syllables: 3,
					freq: 0.8,
					pos: "NOUN",
					register: "formal",
					gloss: "creditor",
					source: "lexicon_v1",
				},
				{
					id: BigInt(2),
					entryId: BigInt(2),
					surface: "亡",
					type: "char",
					lang: "zh-HK",
					jyutping: ["mong4"],
					tone: "4",
					pronunciation: "0",
					consonants: ["m"],
					rhymes: ["ong4"],
					syllables: 1,
					freq: 39,
					pos: "NOUN",
					register: "neutral",
					gloss: "death; to perish",
					source: "words_hk_v28042025",
				},
			];

			const searchQuery = {
				v: "403",
				mode: "all" as const,
				prefix: false,
				limit: 50,
			};

			const cacheKey = InMemoryCache.generateSearchKey(searchQuery);

			// Cache the search results
			await cache.set(cacheKey, mockSearchResults, 60);

			// Retrieve from cache
			const cachedResults = await cache.get<ReadingDTO[]>(cacheKey);

			expect(cachedResults).not.toBeNull();
			expect(cachedResults).toHaveLength(2);
			expect(cachedResults![0]?.surface).toBe("債權人");
			expect(cachedResults![1]?.surface).toBe("亡");

			// Verify cache statistics
			const stats = await cache.getStats();
			expect(stats?.sets).toBe(1);
			expect(stats?.gets).toBe(1);
			expect(stats?.hits).toBe(1);
			expect(stats?.hitRatio).toBe(1);
		});

		it("should handle different search query variations", async () => {
			const baseResults: ReadingDTO[] = [
				{
					id: BigInt(1),
					entryId: BigInt(1),
					surface: "測試",
					type: "vocab",
					lang: "zh-HK",
					jyutping: ["cak1", "si3"],
					tone: "13",
					pronunciation: "34",
					consonants: ["c", "s"],
					rhymes: ["ak1", "i3"],
					syllables: 2,
					freq: 1.0,
					pos: "VERB",
					register: "neutral",
					gloss: "test",
					source: "test_v1",
				},
			];

			// Cache results for different query variations
			const queries = [
				{ v: "34", mode: "all" as const },
				{ v: "34", mode: "vocab" as const },
				{ v: "3", mode: "all" as const, prefix: true },
				{ v: "34", mode: "all" as const, limit: 10 },
			];

			for (const query of queries) {
				const key = InMemoryCache.generateSearchKey(query);
				await cache.set(key, baseResults);
			}

			// Verify all variations are cached separately
			for (const query of queries) {
				const key = InMemoryCache.generateSearchKey(query);
				const result = await cache.get<ReadingDTO[]>(key);
				expect(result).not.toBeNull();
				expect(result![0]?.surface).toBe("測試");
			}

			const stats = await cache.getStats();
			expect(stats?.sets).toBe(4);
			expect(stats?.gets).toBe(4);
			expect(stats?.hits).toBe(4);
		});
	});

	describe("Compose Result Caching", () => {
		it("should cache compose results with rankings", async () => {
			const mockComposeResults = {
				ranking: [
					{ id: BigInt(1), score: 0.95, reason: "High semantic relevance" },
					{ id: BigInt(2), score: 0.87, reason: "Good tone match" },
					{ id: BigInt(3), score: 0.72, reason: "Moderate relevance" },
				],
			};

			const toneMap = "403";
			const topK = 20;
			const cacheKey = InMemoryCache.generateComposeKey(toneMap, topK);

			// Cache the compose results
			await cache.set(cacheKey, mockComposeResults, 30);

			// Retrieve from cache
			const cachedResults = (await cache.get(cacheKey)) as any;

			expect(cachedResults).not.toBeNull();
			expect(cachedResults.ranking).toHaveLength(3);
			expect(cachedResults.ranking[0].score).toBe(0.95);
			expect(cachedResults.ranking[0].reason).toBe("High semantic relevance");
		});

		it("should handle compose cache with different topK values", async () => {
			const baseResults = {
				ranking: [
					{ id: BigInt(1), score: 0.9 },
					{ id: BigInt(2), score: 0.8 },
				],
			};

			const toneMap = "340";

			// Cache with different topK values
			await cache.set(
				InMemoryCache.generateComposeKey(toneMap, 10),
				baseResults
			);
			await cache.set(
				InMemoryCache.generateComposeKey(toneMap, 20),
				baseResults
			);
			await cache.set(InMemoryCache.generateComposeKey(toneMap), baseResults); // default

			// Verify separate caching
			const result10 = await cache.get(
				InMemoryCache.generateComposeKey(toneMap, 10)
			);
			const result20 = await cache.get(
				InMemoryCache.generateComposeKey(toneMap, 20)
			);
			const resultDefault = await cache.get(
				InMemoryCache.generateComposeKey(toneMap)
			);

			expect(result10).not.toBeNull();
			expect(result20).not.toBeNull();
			expect(resultDefault).not.toBeNull();

			const stats = await cache.getStats();
			expect(stats?.sets).toBe(3);
			expect(stats?.gets).toBe(3);
			expect(stats?.hits).toBe(3);
		});
	});

	describe("Cache Warming and Invalidation Scenarios", () => {
		it("should warm cache with frequently accessed tone patterns", async () => {
			const frequentPatterns = [
				{
					key: InMemoryCache.generateSearchKey({ v: "34" }),
					value: [{ id: BigInt(1), surface: "測試", pronunciation: "34" }],
					ttl: 120,
				},
				{
					key: InMemoryCache.generateSearchKey({ v: "403" }),
					value: [{ id: BigInt(2), surface: "債權人", pronunciation: "403" }],
					ttl: 120,
				},
				{
					key: InMemoryCache.generateSearchKey({ v: "0" }),
					value: [{ id: BigInt(3), surface: "亡", pronunciation: "0" }],
					ttl: 120,
				},
			];

			await cache.warmCache(frequentPatterns as any);

			// Verify all patterns are cached
			for (const pattern of frequentPatterns) {
				const result = await cache.get(pattern.key);
				expect(result).not.toBeNull();
				expect(Array.isArray(result)).toBe(true);
			}

			const stats = await cache.getStats();
			expect(stats?.sets).toBe(3);
			expect(stats?.size).toBe(3);
		});

		it("should invalidate search cache when data changes", async () => {
			// Cache some search results
			await cache.set(InMemoryCache.generateSearchKey({ v: "34" }), [
				"result1",
			]);
			await cache.set(InMemoryCache.generateSearchKey({ v: "403" }), [
				"result2",
			]);
			await cache.set(InMemoryCache.generateComposeKey("34"), { ranking: [] });

			// Invalidate all search-related cache entries
			const invalidatedCount = await cache.invalidatePattern("search:*");
			expect(invalidatedCount).toBe(2);

			// Verify search entries are gone but compose entries remain
			expect(
				await cache.get(InMemoryCache.generateSearchKey({ v: "34" }))
			).toBeNull();
			expect(
				await cache.get(InMemoryCache.generateSearchKey({ v: "403" }))
			).toBeNull();
			expect(
				await cache.get(InMemoryCache.generateComposeKey("34"))
			).not.toBeNull();
		});

		it("should handle cache invalidation for specific tone patterns", async () => {
			// Cache results for multiple tone patterns
			const patterns = ["34", "403", "340", "3403"];
			for (const pattern of patterns) {
				await cache.set(InMemoryCache.generateSearchKey({ v: pattern }), [
					`results-${pattern}`,
				]);
			}

			// Invalidate entries starting with '34'
			const invalidatedCount = await cache.invalidatePattern("search:34*");
			expect(invalidatedCount).toBe(3); // '34', '340', '3403'

			// Verify correct entries were invalidated
			expect(
				await cache.get(InMemoryCache.generateSearchKey({ v: "34" }))
			).toBeNull();
			expect(
				await cache.get(InMemoryCache.generateSearchKey({ v: "340" }))
			).toBeNull();
			expect(
				await cache.get(InMemoryCache.generateSearchKey({ v: "3403" }))
			).toBeNull();
			expect(
				await cache.get(InMemoryCache.generateSearchKey({ v: "403" }))
			).not.toBeNull();
		});
	});

	describe("Performance and Memory Management", () => {
		it("should handle large result sets efficiently", async () => {
			// Create a large mock result set
			const largeResultSet: ReadingDTO[] = Array.from(
				{ length: 1000 },
				(_, i) => ({
					id: BigInt(i + 1),
					entryId: BigInt(i + 1),
					surface: `字${i}`,
					type: "char" as const,
					lang: "zh-HK",
					jyutping: [`zi${(i % 6) + 1}`],
					tone: `${(i % 6) + 1}`,
					pronunciation: `${(i % 6) + 1}`,
					consonants: ["z"],
					rhymes: [`i${(i % 6) + 1}`],
					syllables: 1,
					freq: Math.random() * 100,
					pos: "NOUN",
					register: "neutral",
					gloss: `character ${i}`,
					source: "test_large",
				})
			);

			const cacheKey = InMemoryCache.generateSearchKey({ v: "123456" });

			// Cache large result set
			await cache.set(cacheKey, largeResultSet, 60);

			// Retrieve and verify
			const cachedResults = await cache.get<ReadingDTO[]>(cacheKey);
			expect(cachedResults).not.toBeNull();
			expect(cachedResults!).toHaveLength(1000);
			expect(cachedResults![0]?.surface).toBe("字0");
			expect(cachedResults![999]?.surface).toBe("字999");

			const stats = await cache.getStats();
			expect(stats?.size).toBe(1);
			expect(stats?.hits).toBe(1);
		});

		it("should respect cache size limits and evict appropriately", async () => {
			const smallCache = new InMemoryCache({ maxSize: 3, enableStats: true });

			// Fill cache to capacity
			await smallCache.set("key1", "value1");
			await smallCache.set("key2", "value2");
			await smallCache.set("key3", "value3");

			let stats = await smallCache.getStats();
			expect(stats?.size).toBe(3);

			// Add one more item, should evict oldest
			await smallCache.set("key4", "value4");

			stats = await smallCache.getStats();
			expect(stats?.size).toBe(3);

			// Verify oldest was evicted
			expect(await smallCache.get("key1")).toBeNull();
			expect(await smallCache.get("key2")).toBe("value2");
			expect(await smallCache.get("key3")).toBe("value3");
			expect(await smallCache.get("key4")).toBe("value4");
		});
	});

	describe("Real-world Usage Patterns", () => {
		it("should simulate typical search workflow with caching", async () => {
			// Simulate user searching for tone pattern '34'
			const searchKey = InMemoryCache.generateSearchKey({
				v: "34",
				mode: "all",
				limit: 50,
			});

			// First request - cache miss, simulate database fetch
			let cachedResults = await cache.get<ReadingDTO[]>(searchKey);
			expect(cachedResults).toBeNull();

			const dbResults: ReadingDTO[] = [
				{
					id: BigInt(1),
					entryId: BigInt(1),
					surface: "測試",
					type: "vocab",
					lang: "zh-HK",
					jyutping: ["cak1", "si3"],
					tone: "13",
					pronunciation: "34",
					consonants: ["c", "s"],
					rhymes: ["ak1", "i3"],
					syllables: 2,
					freq: 1.0,
					pos: "VERB",
					register: "neutral",
					gloss: "test",
					source: "lexicon_v1",
				},
			];

			// Cache the results
			await cache.set(searchKey, dbResults, 60);

			// Second request - cache hit
			cachedResults = await cache.get<ReadingDTO[]>(searchKey);
			expect(cachedResults).not.toBeNull();
			expect(cachedResults![0]?.surface).toBe("測試");

			// User then composes a line
			const composeKey = InMemoryCache.generateComposeKey("34", 20);
			const composeResults = {
				ranking: [{ id: BigInt(1), score: 0.95, reason: "Perfect tone match" }],
			};

			await cache.set(composeKey, composeResults, 30);

			// Verify both search and compose results are cached
			const stats = await cache.getStats();
			expect(stats?.sets).toBe(2);
			expect(stats?.gets).toBe(2);
			expect(stats?.hits).toBe(1);
			expect(stats?.misses).toBe(1);
			expect(stats?.size).toBe(2);
		});

		it("should handle cache expiration in realistic scenarios", async () => {
			// Simulate short-lived compose cache (30s) vs longer search cache (60s)
			const searchKey = InMemoryCache.generateSearchKey({ v: "403" });
			const composeKey = InMemoryCache.generateComposeKey("403");

			await cache.set(searchKey, ["search-results"], 60);
			await cache.set(composeKey, { ranking: [] }, 30);

			// Both should be available initially
			expect(await cache.get(searchKey)).not.toBeNull();
			expect(await cache.get(composeKey)).not.toBeNull();

			// Simulate time passing (would need real timers in production)
			const ttlSearch = await cache.ttl(searchKey);
			const ttlCompose = await cache.ttl(composeKey);

			expect(ttlSearch).toBeGreaterThan(ttlCompose);
			expect(ttlSearch).toBeLessThanOrEqual(60);
			expect(ttlCompose).toBeLessThanOrEqual(30);
		});
	});
});
