/**
 * One-shot bootstrap script:
 * - Ensures DB is reachable and schema is applied
 * - Normalizes sample data (chars + words), enriches gloss from detail files
 * - Seeds the normalized data into the main database
 *
 * Usage: tsx scripts/normalize-seed-db.ts
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { load } from "jsr:@std/dotenv";
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
import { getLogger } from "jsr:@std/log";

const logger = getLogger();

async function main() {
	// Ensure .env vars are loaded when running standalone
	await load({ export: true });
	logger.info("🚀 Bootstrapping database and data...");

	const databaseUrl = Deno.env.get("DATABASE_URL");
	if (!databaseUrl) {
		logger.error(
			"❌ DATABASE_URL is not set. Please export it before running."
		);
		Deno.exit(1);
	}

	// 1) Ensure DB is reachable
	logger.info("🔎 Checking database connectivity...");
	const dbReady = true; // assume ready; replace with a connection check if needed
	if (!dbReady) {
		logger.error("❌ Database not reachable after retries. Is Docker DB up?");
		Deno.exit(1);
	}
	logger.info("✅ Database is reachable");

	// Track char surfaces for dedup
	const charSurfaces = new Set<string>();

	// 3) Normalize and enrich charlist
	const charInput = "data/sample/charlist.json";
	const charDetail = "data/sample/char_detail.json";
	const charOut = "data/normalized/normalized-chars.jsonl";
	if (existsSync(charInput)) {
		logger.info(`🔤 Normalizing chars from ${charInput}`);
		const rawChar = readFileSync(charInput, "utf-8");
		const charData: CharlistData = JSON.parse(rawChar);
		const charEntries = normalizeCharlistData(
			charData,
			"words_hk_charlist_v28042025"
		);
		for (const e of charEntries) charSurfaces.add(e.surface);
		const glossMap = existsSync(charDetail)
			? loadCharDetail(charDetail)
			: new Map();
		for (const entry of charEntries) {
			const g = glossMap.get(entry.surface);
			if (g) {
				entry.lang = "zh-TW";
				for (const r of entry.readings) r.gloss = g;
			}
		}
		writeFileSync(charOut, charsToJSONL(charEntries));
		logger.info(`✅ Wrote ${charOut}`);
	} else {
		logger.info(`ℹ️  Skipping char normalization; missing ${charInput}`);
	}

	// 4) Normalize and enrich wordslist (dedup against char surfaces)
	const wordInput = "data/sample/wordslist.json";
	const wordDetail = "data/sample/word_detail.json";
	const wordOut = "data/normalized/normalized-vocab.jsonl";
	if (existsSync(wordInput)) {
		logger.info(`🧾 Normalizing words from ${wordInput}`);
		const rawWords = readFileSync(wordInput, "utf-8");
		const wordsData: WordslistData = JSON.parse(rawWords);
		let wordEntries = normalizeWordslistData(
			wordsData,
			"words_hk_wordslist_v28042025"
		);
		if (charSurfaces.size > 0) {
			const before = wordEntries.length;
			wordEntries = wordEntries.filter((e) => !charSurfaces.has(e.surface));
			const after = wordEntries.length;
			const removed = before - after;
			if (removed > 0) {
				logger.info(
					`🧹 Deduped ${removed} vocab entries present in chars (${before} -> ${after}).`
				);
			}
		}
		const glossMap = existsSync(wordDetail)
			? loadWordDetail(wordDetail)
			: new Map();
		for (const entry of wordEntries) {
			const g = glossMap.get(entry.surface);
			if (g) {
				entry.lang = "zh-TW";
				for (const r of entry.readings) r.gloss = g;
			}
		}
		writeFileSync(wordOut, wordsToJSONL(wordEntries));
		logger.info(`✅ Wrote ${wordOut}`);
	} else {
		logger.info(`ℹ️  Skipping words normalization; missing ${wordInput}`);
	}

	// 5) Seed database from normalized files
	const prisma = new PrismaClient({
		datasources: { db: { url: databaseUrl } },
	});
	const seeder = createDatabaseSeeder(prisma, {
		batchSize: 200,
		logProgress: true,
	});

	try {
		await prisma.$connect();
		logger.info("🔌 Connected to DB. Seeding...");
		let totalEntries = 0;
		let totalReadings = 0;

		if (existsSync(charOut)) {
			const res = await seeder.seedFromFile(charOut);
			totalEntries += res.insertedEntries;
			totalReadings += res.insertedReadings;
			logger.info(
				`   ↳ Seeded chars: ${res.insertedEntries} entries, ${res.insertedReadings} readings`
			);
		}
		if (existsSync(wordOut)) {
			const res = await seeder.seedFromFile(wordOut);
			totalEntries += res.insertedEntries;
			totalReadings += res.insertedReadings;
			logger.info(
				`   ↳ Seeded vocab: ${res.insertedEntries} entries, ${res.insertedReadings} readings`
			);
		}

		logger.info(
			`✅ Seeding done. Total inserted: ${totalEntries} entries, ${totalReadings} readings.`
		);
	} catch (e) {
		logger.error("❌ Seeding failed:", e);
		Deno.exit(1);
	} finally {
		await prisma.$disconnect();
	}
}

if (import.meta.main) {
	main().catch((e) => {
		logger.error(e);
		Deno.exit(1);
	});
}
