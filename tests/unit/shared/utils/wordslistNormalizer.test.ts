import { describe, it, expect } from "vitest";
import {
  normalizeWordslistData,
  entriesToJSONL,
  processWordslistToJSONL,
  type WordslistData,
} from "../../../../src/shared/utils/wordslistNormalizer.js";

describe("wordslistNormalizer", () => {
  const sampleWordslistData: WordslistData = {
    "%": ["pat6 sen1", "poe6 sen1", "pe6 sen1"],
    "0": ["ling4"],
    "A": ["ei1"],
    "債": ["zaai3"],
    "權人": ["kyun4 jan4"],
    "hello": ["haa1 lou3", "haa1 lou2"],
    "BB": ["bi1 bi1", "bit1 bit1", "bi4 bi1"],
    "OK": ["ou1 kei1"],
    "人工智能": ["jan4 gung1 zi3 nang4"],
  };

  describe("normalizeWordslistData", () => {
    it("should normalize wordslist data correctly", () => {
      const result = normalizeWordslistData(sampleWordslistData);

      expect(result).toHaveLength(9);

      // Check single character normalization
      const zeroEntry = result.find((e) => e.surface === "0");
      if (!zeroEntry) throw new Error("Expected to find entry for '0'");

      expect(zeroEntry).toEqual({
        surface: "0",
        type: "char",
        lang: "misc",
        readings: [
          {
            jyutping: "ling4",
            freq: 1,
            pos: "NUM",
            register: "neutral",
            gloss: "digit zero",
            source: "words_hk_v28042025",
          },
        ],
      });

      // Check English letter normalization
      const aEntry = result.find((e) => e.surface === "A");
      if (!aEntry) throw new Error("Expected to find entry for 'A'");

      expect(aEntry).toEqual({
        surface: "A",
        type: "char",
        lang: "en",
        readings: [
          {
            jyutping: "ei1",
            freq: 1,
            pos: "LETTER",
            register: "neutral",
            gloss: "Latin letter A",
            source: "words_hk_v28042025",
          },
        ],
      });

      // Check Chinese character normalization
      const debtEntry = result.find((e) => e.surface === "債");
      if (!debtEntry) throw new Error("Expected to find entry for '債'");

      expect(debtEntry).toEqual({
        surface: "債",
        type: "char",
        lang: "zh-HK",
        readings: [
          {
            jyutping: "zaai3",
            freq: 1,
            pos: "NOUN",
            register: "neutral",
            gloss: "Chinese character 債",
            source: "words_hk_v28042025",
          },
        ],
      });
    });

    it("should handle multiple readings and sort by frequency", () => {
      const result = normalizeWordslistData(sampleWordslistData);

      // Check entry with multiple readings (% symbol)
      const percentEntry = result.find((e) => e.surface === "%");
      if (!percentEntry) throw new Error("Expected to find entry for '%'");

      expect(percentEntry.readings).toHaveLength(3);
      if (percentEntry.readings.length < 3)
        throw new Error("Expected at least 3 readings");

      const [firstReading, secondReading, thirdReading] = percentEntry.readings;
      expect(firstReading?.freq).toBe(3); // First in array gets highest freq
      expect(secondReading?.freq).toBe(2);
      expect(thirdReading?.freq).toBe(1);
      expect(firstReading?.jyutping).toBe("pat6 sen1");
      expect(secondReading?.jyutping).toBe("poe6 sen1");
      expect(thirdReading?.jyutping).toBe("pe6 sen1");

      // Check BB entry with multiple readings
      const bbEntry = result.find((e) => e.surface === "BB");
      if (!bbEntry) throw new Error("Expected to find entry for 'BB'");

      expect(bbEntry.readings).toHaveLength(3);
      if (bbEntry.readings.length < 3)
        throw new Error("Expected at least 3 readings");

      const [bbFirst, bbSecond, bbThird] = bbEntry.readings;
      expect(bbFirst?.freq).toBe(3);
      expect(bbSecond?.freq).toBe(2);
      expect(bbThird?.freq).toBe(1);
    });

    it("should use custom source version", () => {
      const result = normalizeWordslistData(sampleWordslistData, "custom_v2");

      result.forEach((entry) => {
        entry.readings.forEach((reading) => {
          expect(reading.source).toBe("words_hk_vcustom_v2");
        });
      });
    });

    it("should handle empty data", () => {
      const result = normalizeWordslistData({});
      expect(result).toEqual([]);
    });

    it("should classify entry types correctly", () => {
      const testData: WordslistData = {
        A: ["ei1"], // single char -> char
        hello: ["haa1 lou3"], // multi char -> vocab
        權人: ["kyun4 jan4"], // multi char -> vocab
      };

      const result = normalizeWordslistData(testData);

      const aEntry = result.find((e) => e.surface === "A");
      const helloEntry = result.find((e) => e.surface === "hello");
      const rightsEntry = result.find((e) => e.surface === "權人");

      if (!aEntry) throw new Error("Expected to find entry for 'A'");
      if (!helloEntry) throw new Error("Expected to find entry for 'hello'");
      if (!rightsEntry) throw new Error("Expected to find entry for '權人'");

      expect(aEntry.type).toBe("char");
      expect(helloEntry.type).toBe("vocab");
      expect(rightsEntry.type).toBe("vocab");
    });

    it("should determine languages correctly", () => {
      const testData: WordslistData = {
        A: ["ei1"], // en (ASCII letter)
        "5": ["ng5"], // misc (digit)
        債: ["zaai3"], // zh-HK (Chinese char)
        hello: ["haa1 lou3"], // en (ASCII word)
        權人: ["kyun4 jan4"], // zh-HK (contains Chinese)
        BB: ["bi1 bi1"], // en (ASCII letters)
        "%": ["pat6 sen1"], // misc (symbol)
      };

      const result = normalizeWordslistData(testData);

      expect(result.find((e) => e.surface === "A")?.lang).toBe("en");
      expect(result.find((e) => e.surface === "5")?.lang).toBe("misc");
      expect(result.find((e) => e.surface === "債")?.lang).toBe("zh-HK");
      expect(result.find((e) => e.surface === "hello")?.lang).toBe("en");
      expect(result.find((e) => e.surface === "權人")?.lang).toBe("zh-HK");
      expect(result.find((e) => e.surface === "BB")?.lang).toBe("en");
      expect(result.find((e) => e.surface === "%")?.lang).toBe("misc");
    });

    it("should determine POS correctly", () => {
      const testData: WordslistData = {
        "7": ["cat1"], // NUM (single digit)
        B: ["bi1"], // LETTER (single letter)
        債: ["zaai3"], // NOUN (Chinese char)
        "123": ["jat1 ji6 saam1"], // NUM (multi digit)
        OK: ["ou1 kei1"], // ABBR (all caps)
        hello: ["haa1 lou3"], // NOUN (regular word)
        "%": ["pat6 sen1"], // SYMBOL (other single char)
      };

      const result = normalizeWordslistData(testData);

      const sevenEntry = result.find((e) => e.surface === "7");
      const bEntry = result.find((e) => e.surface === "B");
      const debtEntry = result.find((e) => e.surface === "債");
      const numberEntry = result.find((e) => e.surface === "123");
      const okEntry = result.find((e) => e.surface === "OK");
      const helloEntry = result.find((e) => e.surface === "hello");
      const percentEntry = result.find((e) => e.surface === "%");

      if (!sevenEntry) throw new Error("Expected to find entry for '7'");
      if (!bEntry) throw new Error("Expected to find entry for 'B'");
      if (!debtEntry) throw new Error("Expected to find entry for '債'");
      if (!numberEntry) throw new Error("Expected to find entry for '123'");
      if (!okEntry) throw new Error("Expected to find entry for 'OK'");
      if (!helloEntry) throw new Error("Expected to find entry for 'hello'");
      if (!percentEntry) throw new Error("Expected to find entry for '%'");

      if (sevenEntry.readings.length === 0)
        throw new Error("Expected readings for '7'");
      if (bEntry.readings.length === 0)
        throw new Error("Expected readings for 'B'");
      if (debtEntry.readings.length === 0)
        throw new Error("Expected readings for '債'");
      if (numberEntry.readings.length === 0)
        throw new Error("Expected readings for '123'");
      if (okEntry.readings.length === 0)
        throw new Error("Expected readings for 'OK'");
      if (helloEntry.readings.length === 0)
        throw new Error("Expected readings for 'hello'");
      if (percentEntry.readings.length === 0)
        throw new Error("Expected readings for '%'");

      const [sevenReading] = sevenEntry.readings;
      const [bReading] = bEntry.readings;
      const [debtReading] = debtEntry.readings;
      const [numberReading] = numberEntry.readings;
      const [okReading] = okEntry.readings;
      const [helloReading] = helloEntry.readings;
      const [percentReading] = percentEntry.readings;

      expect(sevenReading?.pos).toBe("NUM");
      expect(bReading?.pos).toBe("LETTER");
      expect(debtReading?.pos).toBe("NOUN");
      expect(numberReading?.pos).toBe("NUM");
      expect(okReading?.pos).toBe("ABBR");
      expect(helloReading?.pos).toBe("NOUN");
      expect(percentReading?.pos).toBe("SYMBOL");
    });

    it("should generate appropriate glosses", () => {
      const testData: WordslistData = {
        "7": ["cat1"],
        A: ["ei1"],
        債: ["zaai3"],
        hello: ["haa1 lou3"],
        權人: ["kyun4 jan4"],
        "%": ["pat6 sen1"],
      };

      const result = normalizeWordslistData(testData);

      expect(result.find((e) => e.surface === "7")?.readings[0]?.gloss).toBe(
        "digit seven"
      );
      expect(result.find((e) => e.surface === "A")?.readings[0]?.gloss).toBe(
        "Latin letter A"
      );
      expect(result.find((e) => e.surface === "債")?.readings[0]?.gloss).toBe(
        "Chinese character 債"
      );
      expect(result.find((e) => e.surface === "hello")?.readings[0]?.gloss).toBe(
        "English word hello"
      );
      expect(result.find((e) => e.surface === "權人")?.readings[0]?.gloss).toBe(
        "Chinese word 權人"
      );
      expect(result.find((e) => e.surface === "%")?.readings[0]?.gloss).toBe(
        "symbol %"
      );
    });
  });

  describe("entriesToJSONL", () => {
    it("should convert entries to JSONL format", () => {
      const entries = normalizeWordslistData({ A: ["ei1"] });
      const jsonl = entriesToJSONL(entries);

      const expectedLine = JSON.stringify({
        surface: "A",
        type: "char",
        lang: "en",
        readings: [
          {
            jyutping: "ei1",
            freq: 1,
            pos: "LETTER",
            register: "neutral",
            gloss: "Latin letter A",
            source: "words_hk_v28042025",
          },
        ],
      });

      expect(jsonl).toBe(expectedLine);
    });

    it("should handle multiple entries with newlines", () => {
      const entries = normalizeWordslistData({
        A: ["ei1"],
        B: ["bi1"],
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

  describe("processWordslistToJSONL", () => {
    it("should process complete workflow", () => {
      const jsonl = processWordslistToJSONL(sampleWordslistData, "test_v1");

      const lines = jsonl.split("\n");
      expect(lines).toHaveLength(9);

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
          expect(reading.source).toBe("words_hk_vtest_v1");
        });
      });
    });

    it("should match expected output format for sample data", () => {
      const testData: WordslistData = {
        "4": ["sei3"],
        hello: ["haa1 lou3", "haa1 lou2"],
      };

      const jsonl = processWordslistToJSONL(testData);
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
            freq: 1,
            pos: "NUM",
            register: "neutral",
            gloss: "digit four",
            source: "words_hk_v28042025",
          },
        ],
      });

      // Check multi-reading entry
      const helloEntry = JSON.parse(
        lines.find((line) => JSON.parse(line).surface === "hello") || "{}"
      );

      expect(helloEntry.readings).toHaveLength(2);
      expect(helloEntry.readings[0].freq).toBe(2); // Higher freq for first reading
      expect(helloEntry.readings[1].freq).toBe(1);
      expect(helloEntry.readings[0].jyutping).toBe("haa1 lou3");
      expect(helloEntry.readings[1].jyutping).toBe("haa1 lou2");
    });

    it("should use default version when not specified", () => {
      const jsonl = processWordslistToJSONL({ A: ["ei1"] });
      const parsed = JSON.parse(jsonl);

      expect(parsed.readings[0].source).toBe("words_hk_v28042025");
    });
  });

  describe("integration with domain models", () => {
    it("should produce data compatible with Entry.fromRawData", () => {
      const entries = normalizeWordslistData(sampleWordslistData);

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

    it("should handle real wordslist.json sample", () => {
      // Test with actual data structure from the file
      const realSample: WordslistData = {
        "%": ["pat6 sen1", "poe6 sen1", "pe6 sen1"],
        "0": ["ling4"],
        "133": ["jat1 saam1 saam1"],
        "A math": ["ei1 met1"],
        BB: ["bi1 bi1", "bit1 bit1", "bi4 bi1"],
        hello: ["haa1 lou3", "haa1 lou2"],
        人工智能: ["jan4 gung1 zi3 nang4"],
      };

      const result = normalizeWordslistData(realSample);

      expect(result).toHaveLength(7);

      // Verify mixed content handling
      const mathEntry = result.find((e) => e.surface === "A math");
      if (!mathEntry) throw new Error("Expected to find entry for 'A math'");

      expect(mathEntry.type).toBe("vocab");
      expect(mathEntry.lang).toBe("en");
      expect(mathEntry.readings[0]?.pos).toBe("NOUN");
      expect(mathEntry.readings[0]?.gloss).toBe("English word A math");

      // Verify Chinese vocabulary
      const aiEntry = result.find((e) => e.surface === "人工智能");
      if (!aiEntry) throw new Error("Expected to find entry for '人工智能'");

      expect(aiEntry.type).toBe("vocab");
      expect(aiEntry.lang).toBe("zh-HK");
      expect(aiEntry.readings[0]?.pos).toBe("NOUN");
      expect(aiEntry.readings[0]?.gloss).toBe("Chinese word 人工智能");
    });
  });
});
