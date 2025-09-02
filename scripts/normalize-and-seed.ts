#!/usr/bin/env tsx
/**
 * Script to normalize sample data and seed the database
 *
 * This script:
 * 1. Reads the unstructured sample data from data/sample/
 * 2. Normalizes it using the existing normalizers
 * 3. Outputs normalized JSONL files
 * 4. Seeds the database with the normalized data
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import {
  normalizeCharlistData,
  entriesToJSONL as charEntriesToJSONL,
  type CharlistData,
} from "../src/shared/utils/charlistNormalizer.js";
import {
  normalizeWordslistData,
  entriesToJSONL as wordsEntriesToJSONL,
  type WordslistData,
} from "../src/shared/utils/wordslistNormalizer.js";
import { createDatabaseSeeder } from "../src/shared/utils/databaseSeeder.js";

// Configuration
const SAMPLE_DATA_DIR = "data/sample";
const OUTPUT_DIR = "data/normalized";
const CHARLIST_FILE = "charlist.json";
const WORDSLIST_FILE = "wordslist.json";

/**
 * Main execution function
 */
async function main() {
  console.log("🚀 Starting data normalization and database seeding...\n");

  try {
    // Ensure output directory exists
    await mkdir(OUTPUT_DIR, { recursive: true });

    // Step 1: Normalize charlist data
    console.log("📝 Step 1: Normalizing character data...");
    await normalizeCharlistFile();

    // Step 2: Normalize wordslist data
    console.log("📝 Step 2: Normalizing words data...");
    await normalizeWordslistFile();

    // Step 3: Seed database
    console.log("🌱 Step 3: Seeding database...");
    await seedDatabase();

    console.log("\n✅ All operations completed successfully!");
  } catch (error) {
    console.error("\n❌ Error during execution:", error);
    process.exit(1);
  }
}

/**
 * Normalize charlist.json and output to JSONL
 */
async function normalizeCharlistFile(): Promise<void> {
  const inputPath = join(SAMPLE_DATA_DIR, CHARLIST_FILE);
  const outputPath = join(OUTPUT_DIR, "chars.jsonl");

  try {
    // Read raw data
    const rawData = await readFile(inputPath, "utf-8");
    const charlistData: CharlistData = JSON.parse(rawData);

    console.log(
      `  📖 Read ${
        Object.keys(charlistData).length
      } characters from ${inputPath}`
    );

    // Normalize data
    const normalizedEntries = normalizeCharlistData(
      charlistData,
      "words_hk_charlist_v28042025"
    );

    // Convert to JSONL
    const jsonlContent = charEntriesToJSONL(normalizedEntries);

    // Write output
    await writeFile(outputPath, jsonlContent, "utf-8");

    console.log(
      `  ✅ Normalized ${normalizedEntries.length} character entries to ${outputPath}`
    );

    // Log sample entry for verification
    if (normalizedEntries.length > 0) {
      console.log(
        `  📋 Sample entry:`,
        JSON.stringify(normalizedEntries[0], null, 2)
      );
    }
  } catch (error) {
    throw new Error(
      `Failed to normalize charlist: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Normalize wordslist.json and output to JSONL
 */
async function normalizeWordslistFile(): Promise<void> {
  const inputPath = join(SAMPLE_DATA_DIR, WORDSLIST_FILE);
  const outputPath = join(OUTPUT_DIR, "vocab.jsonl");

  try {
    // Read raw data
    const rawData = await readFile(inputPath, "utf-8");
    const wordslistData: WordslistData = JSON.parse(rawData);

    console.log(
      `  📖 Read ${Object.keys(wordslistData).length} words from ${inputPath}`
    );

    // Normalize data
    const normalizedEntries = normalizeWordslistData(
      wordslistData,
      "words_hk_wordslist_v28042025"
    );

    // Convert to JSONL
    const jsonlContent = wordsEntriesToJSONL(normalizedEntries);

    // Write output
    await writeFile(outputPath, jsonlContent, "utf-8");

    console.log(
      `  ✅ Normalized ${normalizedEntries.length} vocabulary entries to ${outputPath}`
    );

    // Log sample entry for verification
    if (normalizedEntries.length > 0) {
      console.log(
        `  📋 Sample entry:`,
        JSON.stringify(normalizedEntries[0], null, 2)
      );
    }
  } catch (error) {
    throw new Error(
      `Failed to normalize wordslist: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Seed database with normalized JSONL files
 */
async function seedDatabase(): Promise<void> {
  const prisma = new PrismaClient();
  const seeder = createDatabaseSeeder(prisma, {
    batchSize: 500,
    logProgress: true,
  });

  try {
    // Clear existing data
    console.log("  🧹 Clearing existing database data...");
    const cleared = await seeder.clearDatabase();
    console.log(
      `  ✅ Cleared ${cleared.entries} entries and ${cleared.readings} readings`
    );

    // Seed character data
    const charsPath = join(OUTPUT_DIR, "chars.jsonl");
    console.log(`  🌱 Seeding character data from ${charsPath}...`);
    const charResult = await seeder.seedFromFile(charsPath);

    if (charResult.errors.length > 0) {
      console.warn(
        `  ⚠️  Character seeding had ${charResult.errors.length} errors:`
      );
      charResult.errors
        .slice(0, 5)
        .forEach((error) => console.warn(`    - ${error}`));
      if (charResult.errors.length > 5) {
        console.warn(`    ... and ${charResult.errors.length - 5} more errors`);
      }
    }

    console.log(
      `  ✅ Seeded ${charResult.insertedEntries} character entries with ${charResult.insertedReadings} readings`
    );

    // Seed vocabulary data
    const vocabPath = join(OUTPUT_DIR, "vocab.jsonl");
    console.log(`  🌱 Seeding vocabulary data from ${vocabPath}...`);
    const vocabResult = await seeder.seedFromFile(vocabPath);

    if (vocabResult.errors.length > 0) {
      console.warn(
        `  ⚠️  Vocabulary seeding had ${vocabResult.errors.length} errors:`
      );
      vocabResult.errors
        .slice(0, 5)
        .forEach((error) => console.warn(`    - ${error}`));
      if (vocabResult.errors.length > 5) {
        console.warn(
          `    ... and ${vocabResult.errors.length - 5} more errors`
        );
      }
    }

    console.log(
      `  ✅ Seeded ${vocabResult.insertedEntries} vocabulary entries with ${vocabResult.insertedReadings} readings`
    );

    // Show final database stats
    const finalStats = await seeder.getDatabaseStats();
    console.log(
      `  📊 Final database stats: ${finalStats.entries} entries, ${finalStats.readings} readings`
    );
  } catch (error) {
    throw new Error(
      `Failed to seed database: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
