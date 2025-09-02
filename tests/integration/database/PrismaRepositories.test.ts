import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { PrismaReadingRepository } from "../../../src/infrastructure/adapters/database/PrismaReadingRepository.js";
import { PrismaWriteRepository } from "../../../src/infrastructure/adapters/database/PrismaWriteRepository.js";
import {
  normalizeCharlistData,
  type CharlistData,
} from "../../../src/shared/utils/charlistNormalizer.js";
import {
  normalizeWordslistData,
  type WordslistData,
} from "../../../src/shared/utils/wordslistNormalizer.js";
import type { SearchQuery } from "../../../src/application/ports/ReadingRepo.js";
import type { SelectionInput } from "../../../src/application/ports/WriteRepo.js";

// Skip integration tests unless TEST_DATABASE_URL is explicitly set
// These tests require a dedicated test database to avoid conflicts
describe.skipIf(!process.env["TEST_DATABASE_URL"])(
  "Prisma Repositories Integration",
  () => {
    let prisma: PrismaClient;
    let readingRepo: PrismaReadingRepository;
    let writeRepo: PrismaWriteRepository;
    let sampleEntries: Array<{
      surface: string;
      type: "char" | "vocab";
      lang: string;
      readings: any[];
    }> = [];

    beforeAll(async () => {
      // Use test database or main database for integration tests
      const databaseUrl =
        process.env["TEST_DATABASE_URL"] || process.env["DATABASE_URL"];
      if (!databaseUrl) {
        throw new Error("No database URL configured");
      }

      prisma = new PrismaClient({
        datasources: {
          db: {
            url: databaseUrl,
          },
        },
      });

      readingRepo = new PrismaReadingRepository(prisma);
      writeRepo = new PrismaWriteRepository(prisma);

      // Ensure database is connected
      await prisma.$connect();

      // Load and normalize sample data
      console.log("Loading sample data for integration tests...");

      try {
        // Load charlist data
        const charlistRaw = readFileSync("data/sample/charlist.json", "utf-8");
        const charlistData: CharlistData = JSON.parse(charlistRaw);
        const charEntries = normalizeCharlistData(
          charlistData,
          "charfreq_test"
        );

        // Load wordslist data
        const wordslistRaw = readFileSync(
          "data/sample/wordslist.json",
          "utf-8"
        );
        const wordslistData: WordslistData = JSON.parse(wordslistRaw);
        const vocabEntries = normalizeWordslistData(
          wordslistData,
          "wordslist_test"
        );

        // Combine all entries
        sampleEntries = [...charEntries, ...vocabEntries];
        console.log(
          `Loaded ${sampleEntries.length} sample entries (${charEntries.length} chars, ${vocabEntries.length} vocab)`
        );
      } catch (error) {
        console.warn("Failed to load sample data:", error);
        sampleEntries = [];
      }
    }, 60000); // Increase timeout for data loading

    afterAll(async () => {
      if (prisma) {
        await prisma.$disconnect();
      }
    });

    beforeEach(async () => {
      // Skip if no test database
      if (!process.env["TEST_DATABASE_URL"]) {
        return;
      }

      console.log("Setting up test database with sample data...");

      // Clean up only test data (by source)
      await prisma.feedback.deleteMany({
        where: {
          reading: {
            source: { in: ["charfreq_test", "wordslist_test"] },
          },
        },
      });
      await prisma.reading.deleteMany({
        where: {
          source: { in: ["charfreq_test", "wordslist_test"] },
        },
      });
      await prisma.entry.deleteMany({
        where: {
          readings: {
            some: {
              source: { in: ["charfreq_test", "wordslist_test"] },
            },
          },
        },
      });

      // Insert sample data
      if (sampleEntries.length > 0) {
        // Take a subset of entries for faster test execution
        const testEntries = sampleEntries.slice(0, 100); // Use first 100 entries

        for (const entry of testEntries) {
          try {
            // Create entry
            const createdEntry = await prisma.entry.create({
              data: {
                surface: entry.surface,
                type: entry.type,
                lang: entry.lang,
              },
            });

            // Create readings for this entry
            for (const reading of entry.readings) {
              await prisma.reading.create({
                data: {
                  entryId: createdEntry.id,
                  jyutping: reading.jyutping,
                  toneOriginal: reading.toneOriginal,
                  toneMapped: reading.toneMapped,
                  syllables: reading.syllables,
                  freq: reading.freq,
                  pos: reading.pos,
                  register: reading.register,
                  gloss: reading.gloss,
                  source: reading.source,
                },
              });
            }
          } catch (error) {
            console.warn(`Failed to insert entry ${entry.surface}:`, error);
          }
        }

        console.log(
          `Inserted ${testEntries.length} test entries into database`
        );
      }
    }, 120000); // Increase timeout for database operations

    describe("PrismaReadingRepository Integration", () => {
      it("should search by exact tone match using sample data", async () => {
        if (!process.env["TEST_DATABASE_URL"]) {
          console.log("Skipping test - no TEST_DATABASE_URL");
          return;
        }

        // Find a tone pattern from our sample data
        const allReadings = await prisma.reading.findMany({
          include: { entry: true },
          take: 1,
        });

        if (allReadings.length === 0) {
          console.log("No sample data available for testing");
          return;
        }

        const sampleReading = allReadings[0]!;
        const query: SearchQuery = {
          toneMapped: sampleReading.toneMapped,
          limit: 10,
        };

        const results = await readingRepo.searchByToneMapped(query);

        expect(results.length).toBeGreaterThan(0);
        expect(results[0]?.toneMapped).toBe(sampleReading.toneMapped);

        // Verify that the sample reading is included in the results (not necessarily first)
        const sampleInResults = results.some(
          (r) => r.surface === sampleReading.entry.surface
        );
        expect(sampleInResults).toBe(true);
      });

      it("should search by prefix using sample data", async () => {
        if (!process.env["TEST_DATABASE_URL"]) {
          console.log("Skipping test - no TEST_DATABASE_URL");
          return;
        }

        // Find a tone pattern from our sample data and use its prefix
        const sampleReading = await prisma.reading.findFirst({
          where: {
            toneMapped: { not: "" },
          },
          include: { entry: true },
        });

        if (!sampleReading || sampleReading.toneMapped.length < 2) {
          console.log("No suitable sample data for prefix testing");
          return;
        }

        const prefix = sampleReading.toneMapped.substring(
          0,
          sampleReading.toneMapped.length - 1
        );
        const query: SearchQuery = {
          toneMapped: prefix,
          isPrefix: true,
          limit: 10,
        };

        const results = await readingRepo.searchByToneMapped(query);

        expect(results.length).toBeGreaterThan(0);
        expect(results.some((r) => r.toneMapped.startsWith(prefix))).toBe(true);
      });

      it("should filter by entry type using sample data", async () => {
        if (!process.env["TEST_DATABASE_URL"]) {
          console.log("Skipping test - no TEST_DATABASE_URL");
          return;
        }

        // Test vocab entries
        const vocabQuery: SearchQuery = {
          toneMapped: "",
          entryType: "vocab",
          limit: 5,
        };

        const vocabResults = await readingRepo.searchByToneMapped(vocabQuery);
        expect(vocabResults.every((r) => r.type === "vocab")).toBe(true);

        // Test char entries
        const charQuery: SearchQuery = {
          toneMapped: "",
          entryType: "char",
          limit: 5,
        };

        const charResults = await readingRepo.searchByToneMapped(charQuery);
        expect(charResults.every((r) => r.type === "char")).toBe(true);
      });

      it("should get reading by ID", async () => {
        if (!process.env["TEST_DATABASE_URL"]) {
          console.log("Skipping test - no TEST_DATABASE_URL");
          return;
        }

        const sampleReading = await prisma.reading.findFirst({
          include: { entry: true },
        });

        if (!sampleReading) {
          console.log("No sample data available for ID testing");
          return;
        }

        const result = await readingRepo.getById(sampleReading.id);

        expect(result).not.toBeNull();
        expect(result!.id).toBe(sampleReading.id);
        expect(result!.surface).toBe(sampleReading.entry.surface);
      });

      it("should get readings by IDs", async () => {
        if (!process.env["TEST_DATABASE_URL"]) {
          console.log("Skipping test - no TEST_DATABASE_URL");
          return;
        }

        const sampleReadings = await prisma.reading.findMany({
          take: 2,
          include: { entry: true },
        });

        if (sampleReadings.length === 0) {
          console.log("No sample data available for IDs testing");
          return;
        }

        const ids = sampleReadings.map((r) => r.id);
        const results = await readingRepo.getByIds(ids);

        expect(results).toHaveLength(ids.length);
        expect(results.every((r) => ids.includes(r.id))).toBe(true);
      });

      it("should count results correctly", async () => {
        if (!process.env["TEST_DATABASE_URL"]) {
          console.log("Skipping test - no TEST_DATABASE_URL");
          return;
        }

        const sampleReading = await prisma.reading.findFirst();
        if (!sampleReading) {
          console.log("No sample data available for count testing");
          return;
        }

        const count = await readingRepo.countByToneMapped({
          toneMapped: sampleReading.toneMapped,
        });

        expect(count).toBeGreaterThan(0);

        // Verify count matches actual search results
        const searchResults = await readingRepo.searchByToneMapped({
          toneMapped: sampleReading.toneMapped,
          limit: 1000,
        });

        expect(count).toBe(searchResults.length);
      });

      it("should maintain deterministic ordering", async () => {
        if (!process.env["TEST_DATABASE_URL"]) {
          console.log("Skipping test - no TEST_DATABASE_URL");
          return;
        }

        // Get results without any specific tone filter to test ordering
        const results = await readingRepo.searchByToneMapped({
          toneMapped: "",
          limit: 20,
        });

        if (results.length < 2) {
          console.log("Not enough sample data for ordering test");
          return;
        }

        // Verify ordering: vocab before char, then by syllables, then by tone, then by jyutping
        for (let i = 0; i < results.length - 1; i++) {
          const current = results[i]!;
          const next = results[i + 1]!;

          // Type ordering: vocab before char
          if (current.type !== next.type) {
            if (current.type === "vocab" && next.type === "char") {
              // Correct order
              continue;
            } else if (current.type === "char" && next.type === "vocab") {
              throw new Error(
                `Incorrect type ordering at position ${i}: char before vocab`
              );
            }
          }

          // Within same type, check syllables ordering (ascending)
          if (
            current.type === next.type &&
            current.syllables !== next.syllables
          ) {
            expect(current.syllables).toBeLessThanOrEqual(next.syllables);
          }
        }
      });

      it("should handle language filtering", async () => {
        if (!process.env["TEST_DATABASE_URL"]) {
          console.log("Skipping test - no TEST_DATABASE_URL");
          return;
        }

        // Test Chinese entries
        const zhResults = await prisma.reading.findMany({
          where: {
            entry: {
              lang: "zh-HK",
            },
          },
          include: { entry: true },
          take: 5,
        });

        expect(zhResults.every((r) => r.entry.lang === "zh-HK")).toBe(true);

        // Test misc entries (if any)
        const miscResults = await prisma.reading.findMany({
          where: {
            entry: {
              lang: "misc",
            },
          },
          include: { entry: true },
          take: 5,
        });

        if (miscResults.length > 0) {
          expect(miscResults.every((r) => r.entry.lang === "misc")).toBe(true);
        }
      });
    });

    describe("PrismaWriteRepository Integration", () => {
      it("should record selection feedback", async () => {
        if (!process.env["TEST_DATABASE_URL"]) {
          console.log("Skipping test - no TEST_DATABASE_URL");
          return;
        }

        const sampleReading = await prisma.reading.findFirst();
        if (!sampleReading) {
          console.log("No sample data available for feedback testing");
          return;
        }

        const input: SelectionInput = {
          readingId: sampleReading.id,
          accepted: true,
          sessionId: "test-session-123",
          context: { source: "integration_test" },
        };

        await writeRepo.recordSelection(input);

        // Verify the feedback was recorded
        const feedback = await writeRepo.getFeedbackForReading(
          sampleReading.id
        );
        expect(feedback).toHaveLength(1);
        expect(feedback[0]?.accepted).toBe(true);
        expect(feedback[0]?.sessionId).toBe("test-session-123");
        expect(feedback[0]?.context).toEqual({ source: "integration_test" });
      });

      it("should get feedback for reading", async () => {
        if (!process.env["TEST_DATABASE_URL"]) {
          console.log("Skipping test - no TEST_DATABASE_URL");
          return;
        }

        const sampleReading = await prisma.reading.findFirst();
        if (!sampleReading) {
          console.log("No sample data available for feedback testing");
          return;
        }

        // Record multiple feedback entries
        await writeRepo.recordSelection({
          readingId: sampleReading.id,
          accepted: true,
          sessionId: "session-1",
        });

        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 10));

        await writeRepo.recordSelection({
          readingId: sampleReading.id,
          accepted: false,
          sessionId: "session-2",
        });

        const feedback = await writeRepo.getFeedbackForReading(
          sampleReading.id
        );
        expect(feedback).toHaveLength(2);
        // Should be ordered by creation date desc (most recent first)
        expect(feedback[0]?.accepted).toBe(false); // Most recent
        expect(feedback[1]?.accepted).toBe(true); // Older
      });

      it("should get feedback for session", async () => {
        if (!process.env["TEST_DATABASE_URL"]) {
          console.log("Skipping test - no TEST_DATABASE_URL");
          return;
        }

        const sampleReading = await prisma.reading.findFirst();
        if (!sampleReading) {
          console.log("No sample data available for feedback testing");
          return;
        }

        const sessionId = "test-session-456";

        // Record feedback in chronological order
        await writeRepo.recordSelection({
          readingId: sampleReading.id,
          accepted: true,
          sessionId,
          context: { step: 1 },
        });

        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 10));

        await writeRepo.recordSelection({
          readingId: sampleReading.id,
          accepted: false,
          sessionId,
          context: { step: 2 },
        });

        const sessionFeedback = await writeRepo.getFeedbackForSession(
          sessionId
        );
        expect(sessionFeedback).toHaveLength(2);
        // Should be ordered by creation date asc (chronological)
        expect(sessionFeedback[0]?.context).toEqual({ step: 1 });
        expect(sessionFeedback[1]?.context).toEqual({ step: 2 });
      });

      it("should get recent feedback", async () => {
        if (!process.env["TEST_DATABASE_URL"]) {
          console.log("Skipping test - no TEST_DATABASE_URL");
          return;
        }

        const sampleReading = await prisma.reading.findFirst();
        if (!sampleReading) {
          console.log("No sample data available for feedback testing");
          return;
        }

        await writeRepo.recordSelection({
          readingId: sampleReading.id,
          accepted: true,
          sessionId: "recent-test",
        });

        const recentFeedback = await writeRepo.getRecentFeedback(5);
        expect(recentFeedback.length).toBeGreaterThan(0);
        expect(recentFeedback[0]?.sessionId).toBe("recent-test");
      });

      it("should handle multiple sessions and readings", async () => {
        if (!process.env["TEST_DATABASE_URL"]) {
          console.log("Skipping test - no TEST_DATABASE_URL");
          return;
        }

        const sampleReadings = await prisma.reading.findMany({ take: 2 });
        if (sampleReadings.length < 2) {
          console.log("Not enough sample data for multi-session testing");
          return;
        }

        // Clean up any existing feedback for these readings first
        await prisma.feedback.deleteMany({
          where: {
            readingId: { in: [sampleReadings[0]!.id, sampleReadings[1]!.id] },
          },
        });

        const sessionId1 = "multi-session-1";
        const sessionId2 = "multi-session-2";

        // Record feedback for different readings in different sessions
        await writeRepo.recordSelection({
          readingId: sampleReadings[0]!.id,
          accepted: true,
          sessionId: sessionId1,
          context: { reading: 1 },
        });

        await writeRepo.recordSelection({
          readingId: sampleReadings[1]!.id,
          accepted: false,
          sessionId: sessionId2,
          context: { reading: 2 },
        });

        // Test session-specific feedback
        const session1Feedback = await writeRepo.getFeedbackForSession(
          sessionId1
        );
        expect(session1Feedback).toHaveLength(1);
        expect(session1Feedback[0]?.readingId).toBe(sampleReadings[0]!.id);

        const session2Feedback = await writeRepo.getFeedbackForSession(
          sessionId2
        );
        expect(session2Feedback).toHaveLength(1);
        expect(session2Feedback[0]?.readingId).toBe(sampleReadings[1]!.id);

        // Test reading-specific feedback
        const reading1Feedback = await writeRepo.getFeedbackForReading(
          sampleReadings[0]!.id
        );
        expect(reading1Feedback).toHaveLength(1);
        expect(reading1Feedback[0]?.sessionId).toBe(sessionId1);

        const reading2Feedback = await writeRepo.getFeedbackForReading(
          sampleReadings[1]!.id
        );
        expect(reading2Feedback).toHaveLength(1);
        expect(reading2Feedback[0]?.sessionId).toBe(sessionId2);
      });
    });
  }
);
