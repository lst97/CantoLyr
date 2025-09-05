#!/usr/bin/env tsx
import { PrismaClient } from "@prisma/client";
import { existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { spawnSync } from "child_process";
import { createDatabaseSeeder } from "../src/shared/utils/databaseSeeder.js";

function runNormalizer(script: string, args: string[]) {
  const tsxBin = resolve("node_modules/.bin/tsx");
  const cmd = existsSync(tsxBin) ? tsxBin : "tsx";
  const res = spawnSync(cmd, [script, ...args], { stdio: "inherit" });
  if (res.error || res.status !== 0) {
    throw new Error(`Normalizer failed: ${script} (exit ${res.status})`);
  }
}

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

		// Normalize via dedicated normalizer scripts to keep logic in sync
		console.log("📖 Normalizing input data via scripts...");
		const charsOut = "data/normalized/chars.jsonl";
		const vocabOut = "data/normalized/vocab.jsonl";
		mkdirSync(dirname(charsOut), { recursive: true });
		// Run char normalizer
		runNormalizer(
			"scripts/normalize-charlist.ts",
			["data/sample/charlist.json", charsOut, "data/sample/char_detail.json", "data/sample/char_freq.json"]
		);
		// Run words normalizer (uses charlist for dedup and optional extras)
		runNormalizer(
			"scripts/normalize-wordslist.ts",
			["data/sample/wordslist.json", vocabOut, "data/sample/word_detail.json", "data/sample/charlist.json", "data/sample/book_word_freq.js"]
		);

		// Seed using JSONL files
		console.log("💾 Inserting data into main database from JSONL...");
		const seeder = createDatabaseSeeder(prisma, { batchSize: 1000, logProgress: true });
		let totalEntries = 0;
		let totalReadings = 0;
		if (existsSync(charsOut)) {
			const res = await seeder.seedFromFile(charsOut);
			totalEntries += res.insertedEntries;
			totalReadings += res.insertedReadings;
			console.log(`   ↳ Seeded chars: ${res.insertedEntries} entries, ${res.insertedReadings} readings`);
		}
		if (existsSync(vocabOut)) {
			const res = await seeder.seedFromFile(vocabOut);
			totalEntries += res.insertedEntries;
			totalReadings += res.insertedReadings;
			console.log(`   ↳ Seeded vocab: ${res.insertedEntries} entries, ${res.insertedReadings} readings`);
		}
		console.log(`✅ Database population completed! Inserted: ${totalEntries} entries, ${totalReadings} readings.`);

		// Verify final counts
		const finalEntryCount = await prisma.entry.count();
		const finalReadingCount = await prisma.reading.count();
		console.log(`   🔍 Final counts: ${finalEntryCount} entries, ${finalReadingCount} readings`);
	} catch (error) {
		console.error("❌ Error populating database:", error);
		process.exit(1);
	} finally {
		await prisma.$disconnect();
	}
}

// Run the script
populateMainDatabase().catch(console.error);
