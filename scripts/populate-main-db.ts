import { PrismaClient } from "../prisma/generated/client.ts";
import { exists } from "jsr:@std/fs/exists";
import { dirname } from "jsr:@std/path";
import { createDatabaseSeeder } from "../src/shared/utils/databaseSeeder.ts";
import { getLogger } from "jsr:@std/log";
import { load } from "jsr:@std/dotenv";

const logger = getLogger();

async function runNormalizer(script: string, args: string[]) {
	const command = new Deno.Command(Deno.execPath(), {
		args: ["run", "-A", script, ...args],
		stdout: "inherit",
		stderr: "inherit",
	});
	const { code } = await command.output();
	if (code !== 0) {
		throw new Error(`Normalizer failed: ${script} (exit ${code})`);
	}
}

async function populateMainDatabase() {
	// Load environment variables from .env file
	await load({ export: true });

	logger.info("🚀 Starting main database population...");

	// Use main database
	const databaseUrl = Deno.env.get("DATABASE_URL");
	logger.info(databaseUrl);
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
		logger.info("✅ Connected to main database");

		// Check if data already exists
		const existingCount = await prisma.entry.count();

		if (typeof existingCount === "number" && existingCount > 0) {
			logger.info(
				`⚠️  Database already contains ${existingCount} entries. Skipping population.`
			);
			logger.info("   To repopulate, first run: npm run db:reset");
			return;
		}

		// Normalize via dedicated normalizer scripts to keep logic in sync
		logger.info("📖 Normalizing input data via scripts...");
		const charsOut = "data/normalized/chars.jsonl";
		const vocabOut = "data/normalized/vocab.jsonl";
		await Deno.mkdir(dirname(charsOut), { recursive: true });
		// Run char normalizer
		runNormalizer("scripts/normalize-charlist.ts", [
			"data/sample/charlist.json",
			charsOut,
			"data/sample/char_detail.json",
			"data/sample/char_freq.json",
		]);
		// Run words normalizer (uses charlist for dedup and optional extras)
		runNormalizer("scripts/normalize-wordslist.ts", [
			"data/sample/wordslist.json",
			vocabOut,
			"data/sample/word_detail.json",
			"data/sample/charlist.json",
			"data/sample/book_word_freq.ts",
		]);

		// Seed using JSONL files
		logger.info("💾 Inserting data into main database from JSONL...");
		const seeder = createDatabaseSeeder(prisma, {
			batchSize: 2048,
			logProgress: true,
		});
		let totalEntries = 0;
		let totalReadings = 0;
		if (await exists(charsOut)) {
			const res = await seeder.seedFromFile(charsOut);
			totalEntries += res.insertedEntries;
			totalReadings += res.insertedReadings;
			logger.info(
				`   ↳ Seeded chars: ${res.insertedEntries} entries, ${res.insertedReadings} readings`
			);
		}
		if (await exists(vocabOut)) {
			const res = await seeder.seedFromFile(vocabOut);
			totalEntries += res.insertedEntries;
			totalReadings += res.insertedReadings;
			logger.info(
				`   ↳ Seeded vocab: ${res.insertedEntries} entries, ${res.insertedReadings} readings`
			);
		}
		logger.info(
			`✅ Database population completed! Inserted: ${totalEntries} entries, ${totalReadings} readings.`
		);

		// Verify final counts
		const finalEntryCount = await prisma.entry.count();
		const finalReadingCount = await prisma.reading.count();
		logger.info(
			`   🔍 Final counts: ${finalEntryCount} entries, ${finalReadingCount} readings`
		);
	} catch (error) {
		logger.error("❌ Error populating database:", error);
		Deno.exit(1);
	} finally {
		await prisma.$disconnect();
	}
}

// Run the script
if (import.meta.main) {
	populateMainDatabase().catch((err) => {
		logger.error(`❌ An unexpected error occurred: ${(err as Error).message}`);
		Deno.exit(1);
	});
}
