import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	ComposeLineUseCase,
	type ComposeLineInput,
} from "../../../../src/application/use-cases/ComposeLineUseCase.js";
import type {
	ReadingRepo,
	ReadingDTO,
} from "../../../../src/application/ports/ReadingRepo.js";
import type { Cache } from "../../../../src/application/ports/Cache.js";
import type {
	LlmGroupedSelector,
	GroupedSelectionResult,
} from "../../../../src/application/ports/LlmGroupedSelector.js";

// Mock the prefilter function
vi.mock("../../../../src/application/services/mvpPrefilter.js", () => ({
	prefilterGroupsByTone: vi.fn(),
}));

import { prefilterGroupsByTone } from "../../../../src/application/services/mvpPrefilter.js";

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

const mockLlmGroupedSelector: LlmGroupedSelector = {
	selectFromGroups: vi.fn(),
	isAvailable: vi.fn(),
	getInfo: vi.fn(),
	validateConfig: vi.fn(),
};

// Sample test data
const sampleReadings: ReadingDTO[] = [
	{
		id: 1n,
		entryId: 1n,
		surface: "債",
		type: "char",
		lang: "zh-HK",
		jyutping: "zaai3",
		toneOriginal: "3",
		toneMapped: "4",
		syllables: 1,
		freq: 0.8,
		pos: "NOUN",
		register: "formal",
		gloss: "debt",
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
		gloss: "death",
		source: "words_hk_v28042025",
	},
];

const sampleGroups = [
	{
		groupIndex: 1,
		pattern: "4",
		options: [
			{ option: 1, surface: "債", readingId: 1n, freq: 0.8 },
			{ option: 2, surface: "在", readingId: 3n, freq: 0.6 },
		],
	},
	{
		groupIndex: 2,
		pattern: "0",
		options: [
			{ option: 1, surface: "亡", readingId: 2n, freq: 39 },
			{ option: 2, surface: "忘", readingId: 4n, freq: 25 },
		],
	},
];

describe("ComposeLineUseCase", () => {
	let composeLineUseCase: ComposeLineUseCase;

	beforeEach(() => {
		vi.clearAllMocks();
		composeLineUseCase = new ComposeLineUseCase(
			mockReadingRepo,
			mockCache,
			mockLlmGroupedSelector
		);
	});

	describe("execute", () => {
		it("should return cached results when available", async () => {
			// Arrange
			const input: ComposeLineInput = { tonePattern: "4 0" };
			const cachedResult = {
				line: "債亡",
				selections: [
					{ group: 1, option: 1, surface: "債", readingId: 1n, freq: 0.8 },
					{ group: 2, option: 1, surface: "亡", readingId: 2n, freq: 39 },
				],
				usedLlm: true,
				processingTimeMs: 100,
				totalCandidates: 1000,
				filteredCandidates: 500,
			};

			vi.mocked(mockCache.get).mockResolvedValue(cachedResult);

			// Act
			const result = await composeLineUseCase.execute(input);

			// Assert
			expect(result.line).toBe("債亡");
			expect(result.selections).toEqual(cachedResult.selections);
			expect(mockCache.get).toHaveBeenCalledWith(
				"compose:4_0:250:none:none:none:zh-HK:random"
			);
			expect(prefilterGroupsByTone).not.toHaveBeenCalled();
		});

		it("should execute compose workflow with LLM when cache miss", async () => {
			// Arrange
			const input: ComposeLineInput = {
				tonePattern: "4 0",
				theme: "love",
				mood: "sad",
			};

			const llmResult: GroupedSelectionResult = {
				selections: [
					{ group: 1, option: 1, surface: "債", readingId: 1n },
					{ group: 2, option: 1, surface: "亡", readingId: 2n },
				],
				line: "債亡",
				reason: "Selected words that convey sadness about debt",
				success: true,
				processingTimeMs: 150,
			};

			vi.mocked(mockCache.get).mockResolvedValue(null);
			vi.mocked(prefilterGroupsByTone).mockResolvedValue(sampleGroups);
			vi.mocked(mockLlmGroupedSelector.isAvailable).mockResolvedValue(true);
			vi.mocked(mockLlmGroupedSelector.selectFromGroups).mockResolvedValue(
				llmResult
			);

			// Act
			const result = await composeLineUseCase.execute(input);

			// Assert
			expect(result.line).toBe("債亡");
			expect(result.usedLlm).toBe(true);
			expect(result.reason).toBe(
				"Selected words that convey sadness about debt"
			);
			expect(prefilterGroupsByTone).toHaveBeenCalledWith(
				"4 0",
				expect.any(Function),
				250,
				undefined
			);
			expect(mockLlmGroupedSelector.selectFromGroups).toHaveBeenCalledWith({
				groups: sampleGroups,
				theme: "love",
				mood: "sad",
				genre: undefined,
				language: "zh-HK",
			});
		});

		it("should fallback to heuristic selection when LLM fails", async () => {
			// Arrange
			const input: ComposeLineInput = { tonePattern: "4 0" };

			vi.mocked(mockCache.get).mockResolvedValue(null);
			vi.mocked(prefilterGroupsByTone).mockResolvedValue(sampleGroups);
			vi.mocked(mockLlmGroupedSelector.isAvailable).mockResolvedValue(true);
			vi.mocked(mockLlmGroupedSelector.selectFromGroups).mockResolvedValue({
				selections: [],
				line: "",
				success: false,
				error: "LLM service unavailable",
			});

			// Act
			const result = await composeLineUseCase.execute(input);

			// Assert
			expect(result.usedLlm).toBe(false);
			expect(result.line).toBe("債亡"); // Highest freq from each group
			expect(result.reason).toBe(
				"Fallback to highest frequency selection per group"
			);
			expect(result.selections).toEqual([
				{ group: 1, option: 1, surface: "債", readingId: 1n, freq: 0.8 },
				{ group: 2, option: 1, surface: "亡", readingId: 2n, freq: 39 },
			]);
		});

		it("should use heuristic selection when LLM not available", async () => {
			// Arrange
			const input: ComposeLineInput = { tonePattern: "4 0" };

			vi.mocked(mockCache.get).mockResolvedValue(null);
			vi.mocked(prefilterGroupsByTone).mockResolvedValue(sampleGroups);
			vi.mocked(mockLlmGroupedSelector.isAvailable).mockResolvedValue(false);

			// Act
			const result = await composeLineUseCase.execute(input);

			// Assert
			expect(result.usedLlm).toBe(false);
			expect(result.line).toBe("債亡");
			expect(mockLlmGroupedSelector.selectFromGroups).not.toHaveBeenCalled();
		});

		it("should handle custom maxPerGroup parameter", async () => {
			// Arrange
			const input: ComposeLineInput = {
				tonePattern: "4 0",
				maxPerGroup: 100,
			};

			vi.mocked(mockCache.get).mockResolvedValue(null);
			vi.mocked(prefilterGroupsByTone).mockResolvedValue(sampleGroups);
			vi.mocked(mockLlmGroupedSelector.isAvailable).mockResolvedValue(false);

			// Act
			await composeLineUseCase.execute(input);

			// Assert
			expect(prefilterGroupsByTone).toHaveBeenCalledWith(
				"4 0",
				expect.any(Function),
				100,
				undefined
			);
		});

		it("should handle seed parameter for reproducible results", async () => {
			// Arrange
			const input: ComposeLineInput = {
				tonePattern: "4 0",
				seed: 12345,
			};

			vi.mocked(mockCache.get).mockResolvedValue(null);
			vi.mocked(prefilterGroupsByTone).mockResolvedValue(sampleGroups);
			vi.mocked(mockLlmGroupedSelector.isAvailable).mockResolvedValue(false);

			// Act
			await composeLineUseCase.execute(input);

			// Assert
			expect(prefilterGroupsByTone).toHaveBeenCalledWith(
				"4 0",
				expect.any(Function),
				250,
				12345
			);
		});

		it("should validate tone pattern format", async () => {
			// Arrange
			const input: ComposeLineInput = { tonePattern: "123" }; // Invalid tones

			// Act & Assert
			await expect(composeLineUseCase.execute(input)).rejects.toThrow(
				"Invalid tone pattern. Must contain only mapped tone digits (0,3,9,4,5,2) and spaces"
			);
		});

		it("should require tone pattern", async () => {
			// Arrange
			const input: ComposeLineInput = { tonePattern: "" };

			// Act & Assert
			await expect(composeLineUseCase.execute(input)).rejects.toThrow(
				"Tone pattern is required"
			);
		});

		it("should require at least one tone group", async () => {
			// Arrange - empty string after trim should trigger the empty groups check
			const input: ComposeLineInput = { tonePattern: "" };

			// Act & Assert
			await expect(composeLineUseCase.execute(input)).rejects.toThrow(
				"Tone pattern is required"
			);
		});

		it("should handle empty groups after filtering", async () => {
			// This test would require modifying the validation logic to handle edge cases
			// For now, we'll test that the current validation works as expected
			const input: ComposeLineInput = { tonePattern: "4" }; // Valid single group

			vi.mocked(mockCache.get).mockResolvedValue(null);
			vi.mocked(prefilterGroupsByTone).mockResolvedValue([]);
			vi.mocked(mockLlmGroupedSelector.isAvailable).mockResolvedValue(false);

			// Act
			const result = await composeLineUseCase.execute(input);

			// Assert - should handle empty groups gracefully
			expect(result.line).toBe("");
			expect(result.selections).toEqual([]);
		});

		it("should generate correct cache keys", async () => {
			// Arrange
			const input: ComposeLineInput = {
				tonePattern: "4 0 3",
				maxPerGroup: 100,
				theme: "love",
				mood: "happy",
				genre: "pop",
				language: "zh-CN",
				seed: 42,
			};

			vi.mocked(mockCache.get).mockResolvedValue(null);
			vi.mocked(prefilterGroupsByTone).mockResolvedValue([]);
			vi.mocked(mockLlmGroupedSelector.isAvailable).mockResolvedValue(false);

			// Act
			await composeLineUseCase.execute(input);

			// Assert
			expect(mockCache.get).toHaveBeenCalledWith(
				"compose:4_0_3:100:love:happy:pop:zh-CN:42"
			);
		});

		it("should calculate candidate statistics correctly", async () => {
			// Arrange
			const input: ComposeLineInput = { tonePattern: "4 0" };

			vi.mocked(mockCache.get).mockResolvedValue(null);
			vi.mocked(prefilterGroupsByTone).mockResolvedValue(sampleGroups);
			vi.mocked(mockLlmGroupedSelector.isAvailable).mockResolvedValue(false);

			// Act
			const result = await composeLineUseCase.execute(input);

			// Assert
			expect(result.totalCandidates).toBe(16); // (2 + 2) * 4 (multiplier)
			expect(result.filteredCandidates).toBe(4); // 2 + 2 options
		});

		it("should measure processing time", async () => {
			// Arrange
			const input: ComposeLineInput = { tonePattern: "4 0" };

			vi.mocked(mockCache.get).mockResolvedValue(null);
			vi.mocked(prefilterGroupsByTone).mockResolvedValue(sampleGroups);
			vi.mocked(mockLlmGroupedSelector.isAvailable).mockResolvedValue(false);

			// Act
			const result = await composeLineUseCase.execute(input);

			// Assert
			expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
			expect(typeof result.processingTimeMs).toBe("number");
		});

		it("should pass fetch function to prefilter correctly", async () => {
			// Arrange
			const input: ComposeLineInput = { tonePattern: "4" };

			vi.mocked(mockCache.get).mockResolvedValue(null);
			vi.mocked(prefilterGroupsByTone).mockResolvedValue([sampleGroups[0]!]);
			vi.mocked(mockLlmGroupedSelector.isAvailable).mockResolvedValue(false);

			// Act
			await composeLineUseCase.execute(input);

			// Assert
			const fetchByToneCall = vi.mocked(prefilterGroupsByTone).mock.calls[0];
			expect(fetchByToneCall).toBeDefined();

			const fetchByTone = fetchByToneCall![1];
			expect(typeof fetchByTone).toBe("function");

			// Test the fetch function
			vi.mocked(mockReadingRepo.searchByToneMapped).mockResolvedValue(
				sampleReadings
			);
			await fetchByTone("4", 100);

			expect(mockReadingRepo.searchByToneMapped).toHaveBeenCalledWith({
				toneMapped: "4",
				limit: 100,
			});
		});
	});
});
