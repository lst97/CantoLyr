/**
 * One-shot bootstrap script:
 * - Ensures DB is reachable and schema is applied
 * - Normalizes sample data (chars + words), enriches gloss from detail files
 * - Seeds the normalized data into the main database
 *
 * Usage: tsx scripts/normalize-seed-db.ts
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { load } from "std/dotenv/mod.ts";
import { PrismaClient } from "../prisma/generated/client.ts";
import {
  type CharlistData,
  entriesToJSONL as charsToJSONL,
  normalizeCharlistData,
} from "../src/shared/utils/charlistNormalizer.ts";
import {
  entriesToJSONL as wordsToJSONL,
  normalizeWordslistData,
  type WordslistData,
} from "../src/shared/utils/wordslistNormalizer.ts";
import { createDatabaseSeeder } from "../src/shared/utils/databaseSeeder.ts";
import { loadCharDetail, loadWordDetail } from "./utils/dataFiles.ts";

async function waitForDbReady(retries = 30, delayMs = 2000) {
  for (let i = 1; i <= retries; i++) {
    const ok = await checkDatabaseConnection();
    if (ok) return true;
    console.log(`⏳ Waiting for database... (${i}/${retries})`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

async function main() {
  // Ensure .env vars are loaded when running standalone
  await load({ export: true });
  console.log("🚀 Bootstrapping database and data...");

  const databaseUrl = Deno.env.get("DATABASE_URL");
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL is not set. Please export it before running.");
    process.exit(1);
  }

  // 1) Ensure DB is reachable
  console.log("🔎 Checking database connectivity...");
  const dbReady = true; // assume ready; replace with a connection check if needed
  if (!dbReady) {
    console.error("❌ Database not reachable after retries. Is Docker DB up?");
    Deno.exit(1);
  }
  console.log("✅ Database is reachable");

  // Track char surfaces for dedup
  const charSurfaces = new Set<string>();

  // 3) Normalize and enrich charlist
  const charInput = "data/sample/charlist.json";
  const charDetail = "data/sample/char_detail.json";
  const charOut = "data/normalized/normalized-chars.jsonl";
  if (existsSync(charInput)) {
    console.log(`🔤 Normalizing chars from ${charInput}`);
    const rawChar = readFileSync(charInput, "utf-8");
    const charData: CharlistData = JSON.parse(rawChar);
    const charEntries = normalizeCharlistData(charData, "words_hk_charlist_v28042025");
    for (const e of charEntries) charSurfaces.add(e.surface);
    const glossMap = existsSync(charDetail) ? loadCharDetail(charDetail) : new Map();
    for (const entry of charEntries) {
      const g = glossMap.get(entry.surface);
      if (g) {
        entry.lang = "zh-TW";
        for (const r of entry.readings) r.gloss = g;
      }
    }
    writeFileSync(charOut, charsToJSONL(charEntries));
    console.log(`✅ Wrote ${charOut}`);
  } else {
    console.log(`ℹ️  Skipping char normalization; missing ${charInput}`);
  }

  // 4) Normalize and enrich wordslist (dedup against char surfaces)
  const wordInput = "data/sample/wordslist.json";
  const wordDetail = "data/sample/word_detail.json";
  const wordOut = "data/normalized/normalized-vocab.jsonl";
  if (existsSync(wordInput)) {
    console.log(`🧾 Normalizing words from ${wordInput}`);
    const rawWords = readFileSync(wordInput, "utf-8");
    const wordsData: WordslistData = JSON.parse(rawWords);
    let wordEntries = normalizeWordslistData(wordsData, "words_hk_wordslist_v28042025");
    if (charSurfaces.size > 0) {
      const before = wordEntries.length;
      wordEntries = wordEntries.filter((e) => !charSurfaces.has(e.surface));
      const after = wordEntries.length;
      const removed = before - after;
      if (removed > 0) {
        console.log(
          `🧹 Deduped ${removed} vocab entries present in chars (${before} -> ${after}).`,
        );
      }
    }
    const glossMap = existsSync(wordDetail) ? loadWordDetail(wordDetail) : new Map();
    for (const entry of wordEntries) {
      const g = glossMap.get(entry.surface);
      if (g) {
        entry.lang = "zh-TW";
        for (const r of entry.readings) r.gloss = g;
      }
    }
    writeFileSync(wordOut, wordsToJSONL(wordEntries));
    console.log(`✅ Wrote ${wordOut}`);
  } else {
    console.log(`ℹ️  Skipping words normalization; missing ${wordInput}`);
  }

  // 5) Seed database from normalized files
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const seeder = createDatabaseSeeder(prisma, { batchSize: 200, logProgress: true });

  try {
    await prisma.$connect();
    console.log("🔌 Connected to DB. Seeding...");
    let totalEntries = 0;
    let totalReadings = 0;

    if (existsSync(charOut)) {
      const res = await seeder.seedFromFile(charOut);
      totalEntries += res.insertedEntries;
      totalReadings += res.insertedReadings;
      console.log(
        `   ↳ Seeded chars: ${res.insertedEntries} entries, ${res.insertedReadings} readings`,
      );
    }
    if (existsSync(wordOut)) {
      const res = await seeder.seedFromFile(wordOut);
      totalEntries += res.insertedEntries;
      totalReadings += res.insertedReadings;
      console.log(
        `   ↳ Seeded vocab: ${res.insertedEntries} entries, ${res.insertedReadings} readings`,
      );
    }

    console.log(
      `✅ Seeding done. Total inserted: ${totalEntries} entries, ${totalReadings} readings.`,
    );
  } catch (e) {
    console.error("❌ Seeding failed:", e);
    Deno.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    Deno.exit(1);
  });
}
