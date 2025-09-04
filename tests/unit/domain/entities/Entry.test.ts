import { describe, it, expect } from "vitest";
import { Entry } from "../../../../src/domain/entities/Entry.js";
import { Reading } from "../../../../src/domain/entities/Reading.js";

describe("Entry", () => {
	const validEntryParams = {
		id: 1n,
		surface: "債權人",
		type: "vocab" as const,
		lang: "zh-HK",
	};

	// Sample normalized data from charlist
	const sampleCharEntryParams = {
		id: 2n,
		surface: "4",
		type: "char" as const,
		lang: "misc",
	};

	const sampleLetterEntryParams = {
		id: 3n,
		surface: "A",
		type: "char" as const,
		lang: "misc",
	};

	const createSampleReading = (overrides: Partial<any> = {}) => {
		return new Reading({
			id: 1n,
			entryId: 1n,
			jyutping: "zaai3 kyun4 jan4",
			freq: 0.8,
			pos: "NOUN" as const,
			register: "formal" as const,
			gloss: "creditor",
			source: "lexicon_v1",
			...overrides,
		});
	};

	describe("constructor", () => {
		it("should create a valid Entry", () => {
			const entry = new Entry(validEntryParams);

			expect(entry.id).toBe(1n);
			expect(entry.surface).toBe("債權人");
			expect(entry.type).toBe("vocab");
			expect(entry.lang).toBe("zh-HK");
			expect(entry.readings).toEqual([]);
			expect(entry.createdAt).toBeInstanceOf(Date);
			expect(entry.updatedAt).toBeInstanceOf(Date);
		});

		it("should include provided readings", () => {
			const reading = createSampleReading();
			const entry = new Entry({
				...validEntryParams,
				readings: [reading],
			});

			expect(entry.readings).toHaveLength(1);
			expect(entry.readings[0]).toBe(reading);
		});

		it("should trim surface text", () => {
			const entry = new Entry({
				...validEntryParams,
				surface: "  債權人  ",
			});

			expect(entry.surface).toBe("債權人");
		});

		it("should trim language code", () => {
			const entry = new Entry({
				...validEntryParams,
				lang: "  zh-HK  ",
			});

			expect(entry.lang).toBe("zh-HK");
		});

		it("should set provided timestamps", () => {
			const createdAt = new Date("2023-01-01");
			const updatedAt = new Date("2023-01-02");

			const entry = new Entry({
				...validEntryParams,
				createdAt,
				updatedAt,
			});

			expect(entry.createdAt).toBe(createdAt);
			expect(entry.updatedAt).toBe(updatedAt);
		});

		it("should throw error for empty surface text", () => {
			expect(
				() =>
					new Entry({
						...validEntryParams,
						surface: "",
					})
			).toThrow("Surface text cannot be empty");

			expect(
				() =>
					new Entry({
						...validEntryParams,
						surface: "   ",
					})
			).toThrow("Surface text cannot be empty");
		});

		it("should throw error for empty language code", () => {
			expect(
				() =>
					new Entry({
						...validEntryParams,
						lang: "",
					})
			).toThrow("Language code cannot be empty");

			expect(
				() =>
					new Entry({
						...validEntryParams,
						lang: "   ",
					})
			).toThrow("Language code cannot be empty");
		});
	});

	describe("addReading", () => {
		it("should add a reading to the entry", () => {
			const entry = new Entry(validEntryParams);
			const reading = createSampleReading();

			const updatedEntry = entry.addReading(reading);

			expect(updatedEntry.readings).toHaveLength(1);
			expect(updatedEntry.readings[0]).toBe(reading);
			expect(updatedEntry.updatedAt).not.toBe(entry.updatedAt);
		});

		it("should preserve existing readings when adding new one", () => {
			const reading1 = createSampleReading({ id: 1n });
			const reading2 = createSampleReading({ id: 2n });

			const entry = new Entry({
				...validEntryParams,
				readings: [reading1],
			});

			const updatedEntry = entry.addReading(reading2);

			expect(updatedEntry.readings).toHaveLength(2);
			expect(updatedEntry.readings).toContain(reading1);
			expect(updatedEntry.readings).toContain(reading2);
		});

		it("should throw error if reading entryId does not match", () => {
			const entry = new Entry(validEntryParams);
			const reading = createSampleReading({ entryId: 999n });

			expect(() => entry.addReading(reading)).toThrow(
				"Reading entryId does not match this entry"
			);
		});
	});

	describe("getReadingsForTonePattern", () => {
		it("should return readings matching exact tone pattern", () => {
			const reading1 = createSampleReading({
				id: 1n,
				jyutping: "zaai3 kyun4 jan1", // toneMapped: '403'
			});
			const reading2 = createSampleReading({
				id: 2n,
				jyutping: "mong4", // toneMapped: '0'
			});

			const entry = new Entry({
				...validEntryParams,
				readings: [reading1, reading2],
			});

			const matches = entry.getReadingsForTonePattern("403");
			expect(matches).toHaveLength(1);
			expect(matches[0]).toBe(reading1);
		});

		it("should return readings matching prefix pattern", () => {
			const reading1 = createSampleReading({
				id: 1n,
				jyutping: "zaai3 kyun4 jan1", // toneMapped: '403'
			});
			const reading2 = createSampleReading({
				id: 2n,
				jyutping: "zaai3 kyun4", // toneMapped: '40'
			});

			const entry = new Entry({
				...validEntryParams,
				readings: [reading1, reading2],
			});

			const matches = entry.getReadingsForTonePattern("40", true);
			expect(matches).toHaveLength(2); // Both start with '40'
		});

		it("should return empty array if no matches", () => {
			const reading = createSampleReading();
			const entry = new Entry({
				...validEntryParams,
				readings: [reading],
			});

			const matches = entry.getReadingsForTonePattern("999");
			expect(matches).toHaveLength(0);
		});
	});

	describe("getPrimaryReading", () => {
		it("should return null for entry with no readings", () => {
			const entry = new Entry(validEntryParams);
			expect(entry.getPrimaryReading()).toBeNull();
		});

		it("should return the only reading if there is one", () => {
			const reading = createSampleReading();
			const entry = new Entry({
				...validEntryParams,
				readings: [reading],
			});

			expect(entry.getPrimaryReading()).toBe(reading);
		});

		it("should return reading with highest frequency", () => {
			const reading1 = createSampleReading({ id: 1n, freq: 0.5 });
			const reading2 = createSampleReading({ id: 2n, freq: 0.8 });
			const reading3 = createSampleReading({ id: 3n, freq: 0.3 });

			const entry = new Entry({
				...validEntryParams,
				readings: [reading1, reading2, reading3],
			});

			expect(entry.getPrimaryReading()).toBe(reading2);
		});
	});

	describe("getTonePatterns", () => {
		it("should return empty array for entry with no readings", () => {
			const entry = new Entry(validEntryParams);
			expect(entry.getTonePatterns()).toEqual([]);
		});

		it("should return unique tone patterns sorted", () => {
			const reading1 = createSampleReading({
				id: 1n,
				jyutping: "zaai3 kyun4 jan1", // toneMapped: '403'
			});
			const reading2 = createSampleReading({
				id: 2n,
				jyutping: "mong4", // toneMapped: '0'
			});
			const reading3 = createSampleReading({
				id: 3n,
				jyutping: "zaai3 kyun4 jan1", // toneMapped: '403' (duplicate)
			});

			const entry = new Entry({
				...validEntryParams,
				readings: [reading1, reading2, reading3],
			});

			const patterns = entry.getTonePatterns();
			expect(patterns).toEqual(["0", "403"]); // Sorted and unique
		});
	});

	describe("hasTonePattern", () => {
		it("should return true if entry has matching tone pattern", () => {
			const reading = createSampleReading({ jyutping: "zaai3 kyun4 jan1" }); // '403'
			const entry = new Entry({
				...validEntryParams,
				readings: [reading],
			});

			expect(entry.hasTonePattern("403")).toBe(true);
			expect(entry.hasTonePattern("404")).toBe(false);
		});

		it("should support prefix matching", () => {
			const reading = createSampleReading({ jyutping: "zaai3 kyun4 jan1" }); // '403'
			const entry = new Entry({
				...validEntryParams,
				readings: [reading],
			});

			expect(entry.hasTonePattern("4", true)).toBe(true);
			expect(entry.hasTonePattern("40", true)).toBe(true);
			expect(entry.hasTonePattern("5", true)).toBe(false);
		});
	});

	describe("getDisplayInfo", () => {
		it("should return display information", () => {
			const reading1 = createSampleReading({ freq: 0.5, jyutping: "aa1" }); // '3'
			const reading2 = createSampleReading({ freq: 0.8, jyutping: "bb2" }); // '9'

			const entry = new Entry({
				...validEntryParams,
				readings: [reading1, reading2],
			});

			const displayInfo = entry.getDisplayInfo();

			expect(displayInfo).toEqual({
				id: 1n,
				surface: "債權人",
				type: "vocab",
				lang: "zh-HK",
				readingCount: 2,
				tonePatterns: ["3", "9"],
				primaryReading: reading2, // Higher frequency
			});
		});
	});

	describe("fromRawData", () => {
		const rawData = {
			id: 1n,
			surface: "債權人",
			type: "VOCAB",
			lang: "zh-HK",
		};

		it("should create Entry from raw data with normalization", () => {
			const entry = Entry.fromRawData(rawData);

			expect(entry.type).toBe("vocab");
			expect(entry.readings).toEqual([]);
		});

		it("should handle char type", () => {
			const entry = Entry.fromRawData({
				...rawData,
				type: "CHAR",
			});

			expect(entry.type).toBe("char");
		});

		it("should throw error for invalid type", () => {
			expect(() =>
				Entry.fromRawData({
					...rawData,
					type: "INVALID",
				})
			).toThrow("Invalid entry type: INVALID. Must be 'vocab' or 'char'");
		});

		it("should work with normalized charlist data", () => {
			const charEntry = Entry.fromRawData({
				...sampleCharEntryParams,
				type: "CHAR", // Test case normalization
			});

			expect(charEntry.surface).toBe("4");
			expect(charEntry.type).toBe("char");
			expect(charEntry.lang).toBe("misc");
			expect(charEntry.readings).toEqual([]);

			const letterEntry = Entry.fromRawData({
				...sampleLetterEntryParams,
				type: "char",
			});

			expect(letterEntry.surface).toBe("A");
			expect(letterEntry.type).toBe("char");
			expect(letterEntry.lang).toBe("misc");
		});
	});

	describe("integration with normalized data", () => {
		it("should handle complete normalized entry with readings", () => {
			const charReading = new Reading({
				id: 1n,
				entryId: 2n,
				jyutping: "sei3",
				freq: 10,
				pos: "NUM",
				register: "neutral",
				gloss: "digit four",
				source: "words_hk_v28042025",
			});

			const charEntry = new Entry({
				...sampleCharEntryParams,
				readings: [charReading],
			});

			expect(charEntry.surface).toBe("4");
			expect(charEntry.type).toBe("char");
			expect(charEntry.lang).toBe("misc");
			expect(charEntry.readings).toHaveLength(1);
			expect(charEntry.getPrimaryReading()).toBe(charReading);
			expect(charEntry.getTonePatterns()).toEqual(["4"]); // 3→4 mapping
		});

		it("should handle multiple readings from normalized data", () => {
			const reading1 = new Reading({
				id: 1n,
				entryId: 1n,
				jyutping: "jat1",
				freq: 5,
				pos: "NUM",
				register: "neutral",
				gloss: "digit one",
				source: "words_hk_v28042025",
			});

			const reading2 = new Reading({
				id: 2n,
				entryId: 1n,
				jyutping: "sap1",
				freq: 1,
				pos: "NUM",
				register: "neutral",
				gloss: "digit one (alternative)",
				source: "words_hk_v28042025",
			});

			const entry = new Entry({
				id: 1n,
				surface: "1",
				type: "char",
				lang: "misc",
				readings: [reading1, reading2],
			});

			expect(entry.readings).toHaveLength(2);
			expect(entry.getPrimaryReading()).toBe(reading1); // Higher frequency
			expect(entry.getTonePatterns()).toEqual(["3"]); // Both jat1 and sap1 map to '3'
		});
	});
});
