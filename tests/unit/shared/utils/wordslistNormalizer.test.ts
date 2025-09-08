import { describe, it, expect } from "vitest";
import {
	normalizeWordslistData,
	entriesToJSONL,
	processWordslistToJSONL,
	type WordslistData,
} from "../../../../src/shared/utils/wordslistNormalizer.js";

describe("wordslistNormalizer (updated)", () => {
	const sampleWordslistData: WordslistData = {
		"%": ["pat6 sen1", "poe6 sen1", "pe6 sen1"],
		"0": ["ling4"],
		A: ["ei1"],
		債: ["zaai3"],
		權人: ["kyun4 jan4"],
		hello: ["haa1 lou3", "haa1 lou2"],
		BB: ["bi1 bi1", "bit1 bit1", "bi4 bi1"],
		OK: ["ou1 kei1"],
		人工智能: ["jan4 gung1 zi3 nang4"],
	};

	describe("normalizeWordslistData", () => {
		it("produces jyutping arrays and tone/pronunciation with decomposition", () => {
			const result = normalizeWordslistData(sampleWordslistData);

			// 0 -> single token surface
			const zero = result.find((e) => e.surface === "0");
			expect(zero).toBeTruthy();
			const zr = zero!.readings[0];
			expect(zr?.jyutping).toEqual(["ling4"]);
			expect(zr?.tone).toBe("4");
			expect(zr?.pronunciation).toBe("0");
			expect(zr?.consonants.length).toBe(1);
			expect(zr?.rhymes.length).toBe(1);
			expect(zr?.syllables).toBe(1);
			expect(zero!.type).toBe("char");
			expect(zero!.lang).toBe("misc");

			// A -> single token surface (English)
			const a = result.find((e) => e.surface === "A");
			expect(a).toBeTruthy();
			const ar = a!.readings[0];
			expect(ar?.jyutping).toEqual(["ei1"]);
			expect(a!.type).toBe("char");
			expect(a!.lang).toBe("en");

			// 債 -> one token, decomposition present
			const debt = result.find((e) => e.surface === "債");
			expect(debt).toBeTruthy();
			const dr = debt!.readings[0];
			expect(Array.isArray(dr?.consonants)).toBe(true);
			expect(Array.isArray(dr?.rhymes)).toBe(true);
			expect(typeof dr?.tone).toBe("string");
			expect(typeof dr?.pronunciation).toBe("string");

			// hello has two readings; jyutping arrays should reflect surface tokens (1 token)
			const hello = result.find((e) => e.surface === "hello");
			expect(hello).toBeTruthy();
			expect(hello!.readings.length).toBeGreaterThanOrEqual(2);
			hello!.readings.forEach((r) => {
				expect(Array.isArray(r.jyutping)).toBe(true);
				expect(r.jyutping.length).toBe(1);
			});
		});

		it("groups jyutping by surface tokens", () => {
			const data: WordslistData = { "A math": ["ei1 met1"] };
			const [entry] = normalizeWordslistData(data);
			expect(entry?.surface).toBe("A math");
			expect(entry?.readings[0]?.jyutping).toEqual(["ei1", "met1"]);
			expect(entry?.lang).toBe("en");
			expect(entry?.type).toBe("vocab");
		});

		it("handles empty data and sets custom source", () => {
			expect(normalizeWordslistData([] as unknown as WordslistData)).toEqual(
				[]
			);
			const res = normalizeWordslistData({ A: ["ei1"] }, "custom_v2");
			expect(res[0]?.readings[0]?.source).toBe("words_hk_vcustom_v2");
		});
	});

	describe("entriesToJSONL", () => {
		it("serializes entries as JSONL", () => {
			const entries = normalizeWordslistData({ A: ["ei1"] });
			const jsonl = entriesToJSONL(entries);
			const parsed = JSON.parse(jsonl);
			expect(parsed.surface).toBe("A");
			expect(parsed.readings[0].jyutping).toEqual(["ei1"]);
		});

		it("handles multiple entries", () => {
			const entries = normalizeWordslistData({ A: ["ei1"], B: ["bi1"] });
			const jsonl = entriesToJSONL(entries);
			const lines = jsonl.split("\n");
			expect(lines).toHaveLength(2);
			lines.forEach((line) => expect(() => JSON.parse(line)).not.toThrow());
		});
	});

	describe("processWordslistToJSONL", () => {
		it("produces consistent JSONL with required fields", () => {
			const jsonl = processWordslistToJSONL(sampleWordslistData, "test_v1");
			const lines = jsonl.split("\n");
			expect(lines.length).toBeGreaterThan(0);
			lines.forEach((line) => {
				const obj = JSON.parse(line);
				expect(obj).toHaveProperty("surface");
				expect(obj).toHaveProperty("type");
				expect(obj).toHaveProperty("lang");
				expect(Array.isArray(obj.readings)).toBe(true);
				obj.readings.forEach((r: any) => {
					expect(Array.isArray(r.jyutping)).toBe(true);
					expect(typeof r.tone).toBe("string");
					expect(typeof r.pronunciation).toBe("string");
					expect(Array.isArray(r.consonants)).toBe(true);
					expect(Array.isArray(r.rhymes)).toBe(true);
					expect(typeof r.source).toBe("string");
				});
			});
		});
	});
});
