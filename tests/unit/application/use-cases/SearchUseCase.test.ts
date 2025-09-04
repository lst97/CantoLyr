import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	SearchUseCase,
	type SearchInput,
} from "../../../../src/application/use-cases/SearchUseCase.js";
import type {
	ReadingRepo,
	ReadingDTO,
} from "../../../../src/application/ports/ReadingRepo.js";
import type { Cache } from "../../../../src/application/ports/Cache.js";

// Mock implementations
const mockReadingRepo: ReadingRepo = {
	searchByToneMapped: vi.fn(),
	getByIds: vi.fn(),
	getById: vi.fn(),
	countByToneMapped: vi.fn(),
};

const mockCache: Cache = {
	get: vi.fn(),
	set: vi.fn(),
	delete: vi.fn(),
	deleteMany: vi.fn(),
	clear: vi.fn(),
	has: vi.fn(),
	getStats: vi.fn(),
	resetStats: vi.fn(),
	keys: vi.fn(),
	ttl: vi.fn(),
};

// Sample test data
const sampleReadings: ReadingDTO[] = [
	{
		id: 1n,
		entryId: 1n,
		surface: "債權人",
		type: "vocab",
		lang: "zh-HK",
		jyutping: "zaai3 kyun4 jan4",
		toneOriginal: "341",
		toneMapped: "403",
		syllables: 3,
		freq: 0.8,
		pos: "NOUN",
		register: "formal",
		gloss: "creditor",
		source: "lexicon_v1",
	},
	{
		id: 2n,
		entryId: 2n,
		surface: "亡",
		type: "char",
		lang: "zh-HK",
		jyutping: "mong4",
		toneOriginal: "4",
		toneMapped: "0",
		syllables: 1,
		freq: 39,
		pos: "NOUN",
		register: "neutral",
		gloss: "death; to perish",
		source: "words_hk_v28042025",
	},
];

describe("SearchUseCase", () => {
	let searchUseCase: SearchUseCase;

	beforeEach(() => {
		vi.clearAllMocks();
		searchUseCase = new SearchUseCase(mockReadingRepo, mockCache);
	});

	describe("execute", () => {
		it("should return cached results when available", async () => {
			// Arrange
			const input: SearchInput = { tonePattern: "403" };
			const cachedResult = {
				query: "403",
				count: 2,
				items: sampleReadings,
				fromCache: true,
				processingTimeMs: 10,
			};

			vi.mocked(mockCache.get).mockResolvedValue(cachedResult);

			// Act
			const result = await searchUseCase.execute(input);

			// Assert
			expect(result.fromCache).toBe(true);
			expect(result.items).toEqual(sampleReadings);
			expect(mockCache.get).toHaveBeenCalledWith("search:403:exact:all:50:0");
			expect(mockReadingRepo.searchByToneMapped).not.toHaveBeenCalled();
		});

		it("should execute search and cache results when cache miss", async () => {
			// Arrange
			const input: SearchInput = { tonePattern: "403" };

			vi.mocked(mockCache.get).mockResolvedValue(null);
			vi.mocked(mockReadingRepo.searchByToneMapped).mockResolvedValue(
				sampleReadings
			);
			vi.mocked(mockReadingRepo.countByToneMapped).mockResolvedValue(2);

			// Act
			const result = await searchUseCase.execute(input);

			// Assert
			expect(result.fromCache).toBe(false);
			expect(result.items).toEqual(sampleReadings);
			expect(result.count).toBe(2);
			expect(result.query).toBe("403");
			expect(mockReadingRepo.searchByToneMapped).toHaveBeenCalledWith({
				toneMapped: "403",
				isPrefix: false,
				entryType: undefined,
				limit: 50,
				offset: 0,
			});
			expect(mockCache.set).toHaveBeenCalledWith(
				"search:403:exact:all:50:0",
				expect.objectContaining({
					query: "403",
					count: 2,
					items: sampleReadings,
					fromCache: false,
				}),
				300
			);
		});

		it("should handle prefix search correctly", async () => {
			// Arrange
			const input: SearchInput = {
				tonePattern: "40",
				isPrefix: true,
				entryType: "vocab",
				limit: 100,
			};

			vi.mocked(mockCache.get).mockResolvedValue(null);
			vi.mocked(mockReadingRepo.searchByToneMapped).mockResolvedValue([
				sampleReadings[0]!,
			]);
			vi.mocked(mockReadingRepo.countByToneMapped).mockResolvedValue(1);

			// Act
			await searchUseCase.execute(input);

			// Assert
			expect(mockReadingRepo.searchByToneMapped).toHaveBeenCalledWith({
				toneMapped: "40",
				isPrefix: true,
				entryType: "vocab",
				limit: 100,
				offset: 0,
			});
			expect(mockCache.set).toHaveBeenCalledWith(
				"search:40:prefix:vocab:100:0",
				expect.any(Object),
				300
			);
		});

		it("should enforce maximum limit", async () => {
			// Arrange
			const input: SearchInput = {
				tonePattern: "403",
				limit: 500, // Exceeds max of 200
			};

			vi.mocked(mockCache.get).mockResolvedValue(null);
			vi.mocked(mockReadingRepo.searchByToneMapped).mockResolvedValue(
				sampleReadings
			);
			vi.mocked(mockReadingRepo.countByToneMapped).mockResolvedValue(2);

			// Act
			await searchUseCase.execute(input);

			// Assert
			expect(mockReadingRepo.searchByToneMapped).toHaveBeenCalledWith(
				expect.objectContaining({ limit: 200 })
			);
		});

		it("should validate tone pattern format", async () => {
			// Arrange
			const input: SearchInput = { tonePattern: "123" }; // Invalid tones

			// Act & Assert
			await expect(searchUseCase.execute(input)).rejects.toThrow(
				"Invalid tone pattern. Must contain only mapped tone digits (0,3,9,4,5,2) and spaces"
			);
		});

		it("should require tone pattern", async () => {
			// Arrange
			const input: SearchInput = { tonePattern: "" };

			// Act & Assert
			await expect(searchUseCase.execute(input)).rejects.toThrow(
				"Tone pattern is required"
			);
		});

		it("should handle spaces in tone pattern", async () => {
			// Arrange
			const input: SearchInput = { tonePattern: "4 0 3" };

			vi.mocked(mockCache.get).mockResolvedValue(null);
			vi.mocked(mockReadingRepo.searchByToneMapped).mockResolvedValue(
				sampleReadings
			);
			vi.mocked(mockReadingRepo.countByToneMapped).mockResolvedValue(2);

			// Act
			await searchUseCase.execute(input);

			// Assert
			expect(mockReadingRepo.searchByToneMapped).toHaveBeenCalledWith(
				expect.objectContaining({ toneMapped: "4 0 3" })
			);
		});

		it("should generate correct cache keys for different parameters", async () => {
			// Arrange
			const inputs: SearchInput[] = [
				{ tonePattern: "403", isPrefix: false, limit: 50, offset: 0 },
				{
					tonePattern: "403",
					isPrefix: true,
					entryType: "vocab",
					limit: 100,
					offset: 10,
				},
			];

			vi.mocked(mockCache.get).mockResolvedValue(null);
			vi.mocked(mockReadingRepo.searchByToneMapped).mockResolvedValue([]);
			vi.mocked(mockReadingRepo.countByToneMapped).mockResolvedValue(0);

			// Act
			for (const input of inputs) {
				await searchUseCase.execute(input);
			}

			// Assert
			expect(mockCache.get).toHaveBeenCalledWith("search:403:exact:all:50:0");
			expect(mockCache.get).toHaveBeenCalledWith(
				"search:403:prefix:vocab:100:10"
			);
		});

		it("should measure processing time", async () => {
			// Arrange
			const input: SearchInput = { tonePattern: "403" };

			vi.mocked(mockCache.get).mockResolvedValue(null);
			vi.mocked(mockReadingRepo.searchByToneMapped).mockResolvedValue(
				sampleReadings
			);
			vi.mocked(mockReadingRepo.countByToneMapped).mockResolvedValue(2);

			// Act
			const result = await searchUseCase.execute(input);

			// Assert
			expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
			expect(typeof result.processingTimeMs).toBe("number");
		});
	});
});
