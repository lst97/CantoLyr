import { describe, it, expect } from "vitest";
import {
  normalizeCharlistData,
  entriesToJSONL,
  processCharlistToJSONL,
  type CharlistData,
} from "../../../../src/shared/utils/charlistNormalizer.js";

describe("charlistNormalizer", () => {
  const sampleCharlistData: CharlistData = {
    "0": { ling4: 7 },
    "1": { jat1: 5, sap1: 1 },
    "A": { ei1: 37 },
    "債": { zaai3: 41 },
    "權": { kyun4: 87 },
    "人": { jan4: 1030, jan2: 31 },
  };

  describe("normalizeCharlistData", () => {
    it("should normalize charlist data correctly", () => {
      const result = normalizeCharlistData(sampleCharlistData);

      expect(result).toHaveLength(6);

      // Check digit normalization
      const zeroEntry = result.find((e) => e.surface === "0");
      expect(zeroEntry).toEqual({
        surface: "0",
        type: "char",
        lang: "misc",
        readings: [
          {
            jyutping: "ling4",
            freq: 7,
            pos: "NUM",
            register: "neutral",
            gloss: "digit zero",
            source: "charfreq_v1",
          },
        ],
      });

      // Check letter normalization
      const aEntry = result.find((e) => e.surface === "A");
      expect(aEntry).toEqual({
        surface: "A",
        type: "char",
        lang: "misc",
        readings: [
          {
            jyutping: "ei1",
            freq: 37,
            pos: "LETTER",
            register: "neutral",
            gloss: "Latin letter A",
            source: "charfreq_v1",
          },
        ],
      });

      // Check Chinese character normalization
      const debtEntry = result.find((e) => e.surface === "債");
      expect(debtEntry).toEqual({
        surface: "債",
        type: "char",
        lang: "zh-HK",
        readings: [
          {
            jyutping: "zaai3",
            freq: 41,
            pos: "NOUN",
            register: "neutral",
            gloss: "Chinese character 債",
            source: "charfreq_v1",
          },
        ],
      });
    });

    it("should handle multiple readings and sort by frequency", () => {
      const result = normalizeCharlistData(sampleCharlistData);

      // Check entry with multiple readings
      const oneEntry = result.find((e) => e.surface === "1");
      if (!oneEntry) throw new Error("Expected to find entry for '1'");

      expect(oneEntry.readings).toHaveLength(2);
      if (oneEntry.readings.length < 2)
        throw new Error("Expected at least 2 readings");

      const [firstReading, secondReading] = oneEntry.readings;
      expect(firstReading?.freq).toBe(5); // jat1 (higher freq)
      expect(secondReading?.freq).toBe(1); // sap1 (lower freq)
      expect(firstReading?.jyutping).toBe("jat1");
      expect(secondReading?.jyutping).toBe("sap1");

      // Check person character with multiple readings
      const personEntry = result.find((e) => e.surface === "人");
      if (!personEntry) throw new Error("Expected to find entry for '人'");

      expect(personEntry.readings).toHaveLength(2);
      if (personEntry.readings.length < 2)
        throw new Error("Expected at least 2 readings");

      const [firstPersonReading, secondPersonReading] = personEntry.readings;
      expect(firstPersonReading?.freq).toBe(1030); // jan4 (higher freq)
      expect(secondPersonReading?.freq).toBe(31); // jan2 (lower freq)
    });

    it("should use custom source version", () => {
      const result = normalizeCharlistData(sampleCharlistData, "custom_v2");

      result.forEach((entry) => {
        entry.readings.forEach((reading) => {
          expect(reading.source).toBe("custom_v2");
        });
      });
    });

    it("should handle empty data", () => {
      const result = normalizeCharlistData({});
      expect(result).toEqual([]);
    });

    it("should classify entry types correctly", () => {
      const testData: CharlistData = {
        A: { ei1: 1 }, // single char -> char
        債權人: { "zaai3 kyun4 jan4": 1 }, // multi char -> vocab
      };

      const result = normalizeCharlistData(testData);

      expect(result.find((e) => e.surface === "A")?.type).toBe("char");
      expect(result.find((e) => e.surface === "債權人")?.type).toBe("vocab");
    });

    it("should determine languages correctly", () => {
      const testData: CharlistData = {
        A: { ei1: 1 }, // misc
        "5": { ng5: 1 }, // misc
        債: { zaai3: 1 }, // zh-HK
        "·": { dim2: 1 }, // misc (other)
      };

      const result = normalizeCharlistData(testData);

      expect(result.find((e) => e.surface === "A")?.lang).toBe("misc");
      expect(result.find((e) => e.surface === "5")?.lang).toBe("misc");
      expect(result.find((e) => e.surface === "債")?.lang).toBe("zh-HK");
      expect(result.find((e) => e.surface === "·")?.lang).toBe("misc");
    });

    it("should determine POS correctly", () => {
      const testData: CharlistData = {
        "7": { cat1: 1 }, // NUM
        B: { bi1: 1 }, // LETTER
        債: { zaai3: 1 }, // NOUN (Chinese char)
      };

      const result = normalizeCharlistData(testData);

      const sevenEntry = result.find((e) => e.surface === "7");
      const bEntry = result.find((e) => e.surface === "B");
      const debtEntry = result.find((e) => e.surface === "債");

      if (!sevenEntry) throw new Error("Expected to find entry for '7'");
      if (!bEntry) throw new Error("Expected to find entry for 'B'");
      if (!debtEntry) throw new Error("Expected to find entry for '債'");

      if (sevenEntry.readings.length === 0)
        throw new Error("Expected readings for '7'");
      if (bEntry.readings.length === 0)
        throw new Error("Expected readings for 'B'");
      if (debtEntry.readings.length === 0)
        throw new Error("Expected readings for '債'");

      const [sevenReading] = sevenEntry.readings;
      const [bReading] = bEntry.readings;
      const [debtReading] = debtEntry.readings;

      expect(sevenReading?.pos).toBe("NUM");
      expect(bReading?.pos).toBe("LETTER");
      expect(debtReading?.pos).toBe("NOUN");
    });
  });

  describe("entriesToJSONL", () => {
    it("should convert entries to JSONL format", () => {
      const entries = normalizeCharlistData({ A: { ei1: 37 } });
      const jsonl = entriesToJSONL(entries);

      const expectedLine = JSON.stringify({
        surface: "A",
        type: "char",
        lang: "misc",
        readings: [
          {
            jyutping: "ei1",
            freq: 37,
            pos: "LETTER",
            register: "neutral",
            gloss: "Latin letter A",
            source: "charfreq_v1",
          },
        ],
      });

      expect(jsonl).toBe(expectedLine);
    });

    it("should handle multiple entries with newlines", () => {
      const entries = normalizeCharlistData({
        A: { ei1: 37 },
        B: { bi1: 43 },
      });
      const jsonl = entriesToJSONL(entries);

      const lines = jsonl.split("\n");
      expect(lines).toHaveLength(2);

      // Each line should be valid JSON
      lines.forEach((line) => {
        expect(() => JSON.parse(line)).not.toThrow();
      });
    });

    it("should handle empty entries array", () => {
      const jsonl = entriesToJSONL([]);
      expect(jsonl).toBe("");
    });
  });

  describe("processCharlistToJSONL", () => {
    it("should process complete workflow", () => {
      const jsonl = processCharlistToJSONL(sampleCharlistData, "test_v1");

      const lines = jsonl.split("\n");
      expect(lines).toHaveLength(6);

      // Each line should be valid JSON
      lines.forEach((line) => {
        const parsed = JSON.parse(line);
        expect(parsed).toHaveProperty("surface");
        expect(parsed).toHaveProperty("type");
        expect(parsed).toHaveProperty("lang");
        expect(parsed).toHaveProperty("readings");
        expect(Array.isArray(parsed.readings)).toBe(true);

        // Check reading structure
        parsed.readings.forEach((reading: any) => {
          expect(reading).toHaveProperty("jyutping");
          expect(reading).toHaveProperty("freq");
          expect(reading).toHaveProperty("pos");
          expect(reading).toHaveProperty("register");
          expect(reading).toHaveProperty("gloss");
          expect(reading.source).toBe("test_v1");
        });
      });
    });

    it("should match expected output format for sample data", () => {
      const testData: CharlistData = {
        "4": { sei3: 10 },
        A: { ei1: 37 },
      };

      const jsonl = processCharlistToJSONL(testData);
      const lines = jsonl.split("\n");

      // Parse and verify structure matches expected format
      const digitEntry = JSON.parse(
        lines.find((line) => JSON.parse(line).surface === "4") || "{}"
      );

      expect(digitEntry).toEqual({
        surface: "4",
        type: "char",
        lang: "misc",
        readings: [
          {
            jyutping: "sei3",
            freq: 10,
            pos: "NUM",
            register: "neutral",
            gloss: "digit four",
            source: "charfreq_v1",
          },
        ],
      });
    });
  });

  describe("integration with domain models", () => {
    it("should produce data compatible with Entry.fromRawData", () => {
      const entries = normalizeCharlistData(sampleCharlistData);

      // Test that the normalized data structure matches what Entry expects
      entries.forEach((entry) => {
        expect(entry).toHaveProperty("surface");
        expect(entry).toHaveProperty("type");
        expect(entry).toHaveProperty("lang");
        expect(entry).toHaveProperty("readings");

        expect(["char", "vocab"]).toContain(entry.type);
        expect(typeof entry.surface).toBe("string");
        expect(typeof entry.lang).toBe("string");
        expect(Array.isArray(entry.readings)).toBe(true);

        entry.readings.forEach((reading) => {
          expect(reading).toHaveProperty("jyutping");
          expect(reading).toHaveProperty("freq");
          expect(reading).toHaveProperty("pos");
          expect(reading).toHaveProperty("register");
          expect(reading).toHaveProperty("gloss");
          expect(reading).toHaveProperty("source");

          expect(typeof reading.jyutping).toBe("string");
          expect(typeof reading.freq).toBe("number");
          expect(typeof reading.pos).toBe("string");
          expect(typeof reading.register).toBe("string");
          expect(typeof reading.gloss).toBe("string");
          expect(typeof reading.source).toBe("string");
        });
      });
    });
  });
});
