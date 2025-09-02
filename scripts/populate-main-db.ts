#!/usr/bin/env tsx
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import {
  normalizeCharlistData,
  type CharlistData,
} from "../src/shared/utils/charlistNormalizer.js";
import {
  normalizeWordslistData,
  type WordslistData,
} from "../src/shared/utils/wordslistNormalizer.js";

async function populateMainDatabase() {
  console.log("🚀 Starting main database population...");

  // Use main database
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

  try {
    await prisma.$connect();
    console.log("✅ Connected to main database");

    // Check if data already exists
    const existingCount = await prisma.entry.count();
    if (existingCount > 0) {
      console.log(
        `⚠️  Database already contains ${existingCount} entries. Skipping population.`
      );
      console.log("   To repopulate, first run: npm run db:reset");
      return;
    }

    // Load and normalize sample data
    console.log("📖 Loading sample data...");

    // Load charlist data
    const charlistRaw = readFileSync("data/sample/charlist.json", "utf-8");
    const charlistData: CharlistData = JSON.parse(charlistRaw);
    const charEntries = normalizeCharlistData(charlistData, "charfreq");

    // Load wordslist data
    const wordslistRaw = readFileSync("data/sample/wordslist.json", "utf-8");
    const wordslistData: WordslistData = JSON.parse(wordslistRaw);
    const vocabEntries = normalizeWordslistData(wordslistData, "wordslist");

    // Combine all entries
    const allEntries = [...charEntries, ...vocabEntries];
    console.log(
      `📊 Loaded ${allEntries.length} entries (${charEntries.length} chars, ${vocabEntries.length} vocab)`
    );

    // Insert data in batches
    console.log("💾 Inserting data into main database...");
    let insertedCount = 0;
    let skippedCount = 0;

    for (const entry of allEntries) {
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

        insertedCount++;
        if (insertedCount % 1000 === 0) {
          console.log(
            `   Inserted ${insertedCount}/${allEntries.length} entries...`
          );
        }
      } catch (error) {
        skippedCount++;
        if (skippedCount <= 10) {
          // Only log first 10 errors
          console.warn(
            `⚠️  Skipped entry ${entry.surface}:`,
            error instanceof Error ? error.message : error
          );
        }
      }
    }

    console.log(`✅ Database population completed!`);
    console.log(`   📊 Inserted: ${insertedCount} entries`);
    console.log(`   ⚠️  Skipped: ${skippedCount} entries`);

    // Verify final counts
    const finalEntryCount = await prisma.entry.count();
    const finalReadingCount = await prisma.reading.count();
    console.log(
      `   🔍 Final counts: ${finalEntryCount} entries, ${finalReadingCount} readings`
    );
  } catch (error) {
    console.error("❌ Error populating database:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
populateMainDatabase().catch(console.error);
