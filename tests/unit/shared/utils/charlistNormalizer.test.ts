import { describe, it, expect } from "vitest";
import {
	processCharlistToJSONL,
	normalizeCharlistData,
	type CharlistData,
} from "../../../../src/shared/utils/charlistNormalizer.js";

describe("charlistNormalizer (updated)", () => {
	it("produces jyutping arrays and tone/pronunciation with decomposition", () => {
		const data: CharlistData = {
			債: { zaai3: 10 },
			"0": { ling4: 5 },
		};
		const entries = normalizeCharlistData(data);
		const debt = entries.find((e) => e.surface === "債");
		expect(debt).toBeTruthy();
		const dr = debt!.readings[0];
		expect(Array.isArray(dr?.jyutping)).toBe(true);
		expect(dr?.jyutping).toEqual(["zaai3"]);
		expect(typeof dr?.tone).toBe("string");
		expect(typeof dr?.pronunciation).toBe("string");
		expect(Array.isArray(dr?.consonants)).toBe(true);
		expect(Array.isArray(dr?.rhymes)).toBe(true);

		const zero = entries.find((e) => e.surface === "0");
		expect(zero).toBeTruthy();
		const zr = zero!.readings[0];
		expect(zr?.jyutping).toEqual(["ling4"]);
		expect(zero!.lang).toBe("misc");
	});

	it("JSONL output serializes updated fields", () => {
		const data: CharlistData = { 債: { zaai3: 1 } };
		const jsonl = processCharlistToJSONL(data);
		const obj = JSON.parse(jsonl);
		expect(Array.isArray(obj.readings[0].jyutping)).toBe(true);
		expect(typeof obj.readings[0].tone).toBe("string");
		expect(typeof obj.readings[0].pronunciation).toBe("string");
	});
});
