import { PrismaClient } from "../prisma/generated/client.ts";
import { exists } from "jsr:@std/fs/exists";
import { createDatabaseSeeder } from "../src/shared/utils/databaseSeeder.ts";
import { getLogger } from "jsr:@std/log";
import { load } from "jsr:@std/dotenv";

const logger = getLogger();

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
        `⚠️  Database already contains ${existingCount} entries. Skipping population.`,
      );
      logger.info("   To repopulate, first run: npm run db:reset");
      return;
    }

    // Check for preprocessed files
    logger.info("📖 Checking for preprocessed data files...");
    const charsFile = "data/preprocess/lexicon/chars.posr.jsonl";
    const vocabFile = "data/preprocess/lexicon/vocab.posr.jsonl";

    const charsExists = await exists(charsFile);
    const vocabExists = await exists(vocabFile);

    if (!charsExists || !vocabExists) {
      logger.error("❌ Required preprocessed files are missing:");
      if (!charsExists) {
        logger.error(`   ❌ Missing: ${charsFile}`);
      }
      if (!vocabExists) {
        logger.error(`   ❌ Missing: ${vocabFile}`);
      }
      logger.error("\n🔧 To generate these files, please run:");
      logger.error("   1. First run normalization scripts:");
      logger.error("      npm run normalize:chars");
      logger.error("      npm run normalize:vocab");
      logger.error("   2. Then run preprocessing scripts:");
      logger.error("      npm run preprocess:lexicon");
      logger.error("\n   Or run the complete preprocessing pipeline:");
      logger.error("      npm run preprocess:all");
      throw new Error(
        "Preprocessed files not found. Please run preprocessing scripts first.",
      );
    }

    logger.info("✅ Found preprocessed files:");

    logger.info(`   ✅ ${charsFile}`);
    logger.info(`   ✅ ${vocabFile}`);

    // Seed using preprocessed JSONL files
    logger.info(
      "💾 Inserting data into main database from preprocessed JSONL...",
    );
    const seeder = createDatabaseSeeder(prisma, {
      batchSize: 2048,
      logProgress: true,
    });
    let totalEntries = 0;
    let totalReadings = 0;

    // Seed characters
    const charsRes = await seeder.seedFromFile(charsFile);
    totalEntries += charsRes.insertedEntries;
    totalReadings += charsRes.insertedReadings;
    logger.info(
      `   ↳ Seeded chars: ${charsRes.insertedEntries} entries, ${charsRes.insertedReadings} readings`,
    );

    // Seed vocabulary
    const vocabRes = await seeder.seedFromFile(vocabFile);
    totalEntries += vocabRes.insertedEntries;
    totalReadings += vocabRes.insertedReadings;
    logger.info(
      `   ↳ Seeded vocab: ${vocabRes.insertedEntries} entries, ${vocabRes.insertedReadings} readings`,
    );
    logger.info(
      `✅ Database population completed! Inserted: ${totalEntries} entries, ${totalReadings} readings.`,
    );

    // Verify final counts
    const finalEntryCount = await prisma.entry.count();
    const finalReadingCount = await prisma.reading.count();
    logger.info(
      `   🔍 Final counts: ${finalEntryCount} entries, ${finalReadingCount} readings`,
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
