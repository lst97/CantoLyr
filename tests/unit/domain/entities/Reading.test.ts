import { describe, it, expect } from "vitest";
import { Reading } from "../../../../src/domain/entities/Reading.js";

describe("Reading", () => {
	const validReadingParams = {
		id: 1n,
		entryId: 100n,
		jyutping: "zaai3 kyun4 jan1",
		freq: 0.8,
		pos: "NOUN" as const,
		register: "formal" as const,
		gloss: "creditor",
		source: "lexicon_v1",
	};

	// Sample data from normalized charlist format
	const sampleNormalizedData = {
		charData: {
			id: 2n,
			entryId: 200n,
			jyutping: "sei3",
			freq: 10,
			pos: "NUM" as const,
			register: "neutral" as const,
			gloss: "digit four",
			source: "words_hk_v28042025",
		},
		letterData: {
			id: 3n,
			entryId: 300n,
			jyutping: "ei1",
			freq: 37,
			pos: "LETTER" as const,
			register: "neutral" as const,
			gloss: "Latin letter A",
			source: "words_hk_v28042025",
		},
	};

	describe("constructor", () => {
		it("should create a valid Reading with correct tone mapping", () => {
			const reading = new Reading(validReadingParams);

			expect(reading.id).toBe(1n);
			expect(reading.entryId).toBe(100n);
			expect(reading.jyutping).toBe("zaai3 kyun4 jan1");
			expect(reading.toneOriginal).toBe("341");
			expect(reading.toneMapped.value).toBe("403"); // 3→4, 4→0, 1→3
			expect(reading.syllables).toBe(3);
			expect(reading.freq).toBe(0.8);
			expect(reading.pos).toBe("NOUN");
			expect(reading.register).toBe("formal");
			expect(reading.gloss).toBe("creditor");
			expect(reading.source).toBe("lexicon_v1");
		});

		it("should normalize jyutping input", () => {
			const reading = new Reading({
				...validReadingParams,
				jyutping: "  ZAAI3 KYUN4 JAN1  ",
			});

			expect(reading.jyutping).toBe("zaai3 kyun4 jan1");
		});

		it("should handle single syllable jyutping", () => {
			const reading = new Reading({
				...validReadingParams,
				jyutping: "mong4",
			});

			expect(reading.jyutping).toBe("mong4");
			expect(reading.toneOriginal).toBe("4");
			expect(reading.toneMapped.value).toBe("0"); // 4→0
			expect(reading.syllables).toBe(1);
		});

		it("should set default timestamps if not provided", () => {
			const reading = new Reading(validReadingParams);

			expect(reading.createdAt).toBeInstanceOf(Date);
			expect(reading.updatedAt).toBeInstanceOf(Date);
		});

		it("should use provided timestamps", () => {
			const createdAt = new Date("2023-01-01");
			const updatedAt = new Date("2023-01-02");

			const reading = new Reading({
				...validReadingParams,
				createdAt,
				updatedAt,
			});

			expect(reading.createdAt).toBe(createdAt);
			expect(reading.updatedAt).toBe(updatedAt);
		});

		it("should throw error for negative frequency", () => {
			expect(
				() =>
					new Reading({
						...validReadingParams,
						freq: -1,
					})
			).toThrow("Frequency must be non-negative");
		});

		it("should throw error for empty gloss", () => {
			expect(
				() =>
					new Reading({
						...validReadingParams,
						gloss: "",
					})
			).toThrow("Gloss cannot be empty");

			expect(
				() =>
					new Reading({
						...validReadingParams,
						gloss: "   ",
					})
			).toThrow("Gloss cannot be empty");
		});

		it("should throw error for empty source", () => {
			expect(
				() =>
					new Reading({
						...validReadingParams,
						source: "",
					})
			).toThrow("Source cannot be empty");

			expect(
				() =>
					new Reading({
						...validReadingParams,
						source: "   ",
					})
			).toThrow("Source cannot be empty");
		});

		it("should trim gloss and source", () => {
			const reading = new Reading({
				...validReadingParams,
				gloss: "  creditor  ",
				source: "  lexicon_v1  ",
			});

			expect(reading.gloss).toBe("creditor");
			expect(reading.source).toBe("lexicon_v1");
		});
	});

	describe("matchesTonePattern", () => {
		const reading = new Reading(validReadingParams); // toneMapped = '403'

		it("should match exact tone pattern", () => {
			expect(reading.matchesTonePattern("403")).toBe(true);
			expect(reading.matchesTonePattern("404")).toBe(false);
		});

		it("should match prefix when isPrefix is true", () => {
			expect(reading.matchesTonePattern("4", true)).toBe(true);
			expect(reading.matchesTonePattern("40", true)).toBe(true);
			expect(reading.matchesTonePattern("403", true)).toBe(true);
			expect(reading.matchesTonePattern("5", true)).toBe(false);
			expect(reading.matchesTonePattern("04", true)).toBe(false);
		});

		it("should not match prefix when isPrefix is false", () => {
			expect(reading.matchesTonePattern("4", false)).toBe(false);
			expect(reading.matchesTonePattern("40", false)).toBe(false);
			expect(reading.matchesTonePattern("403", false)).toBe(true);
		});
	});

	describe("getDisplayInfo", () => {
		it("should return display information", () => {
			const reading = new Reading(validReadingParams);
			const displayInfo = reading.getDisplayInfo();

			expect(displayInfo).toEqual({
				surface: "", // Will be filled by Entry
				jyutping: "zaai3 kyun4 jan1",
				tones: "403",
				syllables: 3,
				pos: "NOUN",
				gloss: "creditor",
			});
		});
	});

	describe("fromRawData", () => {
		const rawData = {
			id: 1n,
			entryId: 100n,
			jyutping: "zaai3 kyun4 jan4",
			freq: 0.8,
			pos: "noun",
			register: "FORMAL",
			gloss: "creditor",
			source: "lexicon_v1",
		};

		it("should create Reading from raw data with normalization", () => {
			const reading = Reading.fromRawData(rawData);

			expect(reading.pos).toBe("NOUN");
			expect(reading.register).toBe("formal");
		});

		it("should handle unknown POS", () => {
			const reading = Reading.fromRawData({
				...rawData,
				pos: "INVALID_POS",
			});

			expect(reading.pos).toBe("UNKNOWN");
		});

		it("should handle invalid register", () => {
			const reading = Reading.fromRawData({
				...rawData,
				register: "INVALID_REGISTER",
			});

			expect(reading.register).toBe("neutral");
		});

		it("should handle all valid POS values", () => {
			const validPosValues = [
				"NOUN",
				"ADJ",
				"NUM",
				"LETTER",
				"VERB",
				"ADV",
				"PREP",
				"CONJ",
				"INTJ",
				"PRON",
				"DET",
				"PART",
			];

			validPosValues.forEach((pos) => {
				const reading = Reading.fromRawData({
					...rawData,
					pos: pos.toLowerCase(),
				});
				expect(reading.pos).toBe(pos);
			});
		});

		it("should work with normalized charlist data", () => {
			const charReading = Reading.fromRawData({
				...sampleNormalizedData.charData,
				pos: sampleNormalizedData.charData.pos.toLowerCase(),
				register: sampleNormalizedData.charData.register.toUpperCase(),
			});

			expect(charReading.pos).toBe("NUM");
			expect(charReading.register).toBe("neutral");
			expect(charReading.jyutping).toBe("sei3");
			expect(charReading.toneOriginal).toBe("3");
			expect(charReading.toneMapped.value).toBe("4"); // 3→4
			expect(charReading.gloss).toBe("digit four");
			expect(charReading.source).toBe("words_hk_v28042025");

			const letterReading = Reading.fromRawData({
				...sampleNormalizedData.letterData,
				pos: sampleNormalizedData.letterData.pos.toLowerCase(),
				register: sampleNormalizedData.letterData.register.toUpperCase(),
			});

			expect(letterReading.pos).toBe("LETTER");
			expect(letterReading.register).toBe("neutral");
			expect(letterReading.jyutping).toBe("ei1");
			expect(letterReading.toneOriginal).toBe("1");
			expect(letterReading.toneMapped.value).toBe("3"); // 1→3
			expect(letterReading.gloss).toBe("Latin letter A");
		});

		it("should handle all valid register values", () => {
			const validRegisters = ["formal", "neutral", "colloquial"];

			validRegisters.forEach((register) => {
				const reading = Reading.fromRawData({
					...rawData,
					register: register.toUpperCase(),
				});
				expect(reading.register).toBe(register);
			});
		});
	});
});
