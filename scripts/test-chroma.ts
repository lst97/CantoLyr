/**
 * Test Chroma vector search queries using Qwen3-Embedding-0.6B-ONNX model.
 *
 * Usage:
 *   deno run -A scripts/test-chroma.ts [--query="your query"] [--collection=name] [--limit=10] [--pronunciation="pronunciation"] [--rhyme=1:a]...
 *
 * This script will:
 * 1. Download the ONNX version of Qwen3-Embedding-0.6B model to ./.cache
 * 2. Create a custom Chroma embedding function using Transformers.js
 * 3. Connect to Chroma and perform vector similarity search
 * 4. Display results with metadata
 * 5. Show collection statistics
 * 6. Display a summary of results at the end.
 */

import { load } from "jsr:@std/dotenv";
import { getLogger } from "jsr:@std/log";
import { ChromaClient } from "chromadb";
import { join } from "jsr:@std/path";
import { pipeline } from "npm:@huggingface/transformers";

const logger = getLogger();

function parseArgFlag(name: string): boolean {
  return Deno.args.some((a) => a === `--${name}`);
}

function parseArgKV(name: string): string | undefined {
  const found = Deno.args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split("=", 2)[1] : undefined;
}

function parseArgKVs(name: string): string[] {
  return Deno.args
    .filter((a) => a.startsWith(`--${name}=`))
    .map((a) => a.split("=", 2)[1]);
}

// Global embedding function instance
let embeddingFunction: any = null;

async function initializeEmbeddingFunction(): Promise<void> {
  logger.info("📥 Initializing Qwen3-Embedding-0.6B-ONNX model...");

  const cacheDir = join(Deno.cwd(), ".cache");

  // Ensure cache directory exists
  try {
    await Deno.mkdir(cacheDir, { recursive: true });
  } catch {
    // Directory might already exist
  }

  const modelId = Deno.env.get("EMBEDDING_MODEL");
  logger.info(`🧠 Using ONNX embedding model: ${modelId}`);
  logger.info(`📁 Cache directory: ${cacheDir}`);

  try {
    // Create feature extraction pipeline with ONNX model
    embeddingFunction = await pipeline("feature-extraction", modelId, {
      cache_dir: cacheDir,
      dtype: "fp32", // Options: "fp32", "fp16", "q8"
    });
    logger.info("✅ ONNX embedding model initialized successfully");
  } catch (error) {
    logger.error(`❌ Failed to initialize embedding model: ${error}`);
    Deno.exit(1);
  }
}

async function generateEmbedding(text: string): Promise<number[]> {
  if (!embeddingFunction) {
    throw new Error("Embedding function not initialized");
  }

  try {
    // For retrieval tasks, we don't need the instruction format
    // Just use the text directly
    const output = await embeddingFunction([text], {
      pooling: "last_token",
      normalize: true,
    });

    // Convert tensor to array
    const embedding = output.data;
    return Array.from(embedding);
  } catch (error) {
    logger.error(`❌ Failed to generate embedding: ${error}`);
    throw error;
  }
}

async function testChromaQuery(
  query: string,
  collectionName: string,
  chromaUrl: string,
  limit: number,
  pronunciation?: string,
  rhymes?: Record<number, string>,
): Promise<void> {
  logger.info(`🔍 Testing Chroma query: "${query}"`);
  const where: Record<string, any> = {};
  if (pronunciation) {
    where.pronunciation = pronunciation;
    logger.info(`🎤 Filtering by pronunciation: "${pronunciation}"`);
  }
  if (rhymes && Object.keys(rhymes).length > 0) {
    for (const position of Object.keys(rhymes)) {
      where[`rhyme${position}`] = rhymes[Number(position)];
    }
    logger.info(`🎤 Filtering by rhymes: ${JSON.stringify(rhymes)}`);
  }
  logger.info(`📚 Collection: ${collectionName}`);
  logger.info(`🔗 Chroma URL: ${chromaUrl}`);

  // Create Chroma client
  const url = new URL(chromaUrl);
  const client = new ChromaClient({
    ssl: url.protocol === "https:",
    host: url.hostname,
    port: Number(url.port || (url.protocol === "https:" ? 443 : 8000)),
  });

  try {
    // Check if Chroma is reachable
    await client.heartbeat();
    logger.info("✅ Chroma server is reachable");

    // List collections to verify our target exists
    const collections = await client.listCollections();
    const collectionExists = collections.some(
      (c: any) => c.name === collectionName,
    );

    if (!collectionExists) {
      logger.error(`❌ Collection '${collectionName}' not found`);
      logger.info("Available collections:");
      for (const c of collections) {
        logger.info(`  - ${(c as any).name}`);
      }
      Deno.exit(1);
    }

    logger.info(`✅ Collection '${collectionName}' exists`);

    // Get the collection
    const collection = await client.getCollection({
      name: collectionName,
    });

    // Generate embedding for the query
    logger.info("🧠 Generating embedding for query...");
    const queryEmbedding = await generateEmbedding(query);

    // Perform the query using custom embedding
    logger.info("🔍 Performing vector similarity search...");
    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: limit,
      include: ["documents", "metadatas", "distances"],
      where: Object.keys(where).length > 0 ? where : undefined,
    });

    // Display results
    logger.info(
      `\n📊 Query Results (${results.documents?.[0]?.length || 0} found):`,
    );
    logger.info("=".repeat(80));

    if (results.documents?.[0] && results.documents[0].length > 0) {
      // Summary of results
      logger.info("\n" + "=".repeat(80));
      logger.info("📝 Summary of Surfaces Found:");
      const surfaces = results.metadatas[0].map((m: any) => m.surface || "N/A");
      logger.info(surfaces.join(" | "));
      logger.info("=".repeat(80));
    } else {
      logger.info("No results found");
    }

    // Show collection stats
    const count = await collection.count();
    logger.info(`\n📈 Collection Statistics:`);
    logger.info(`   Total documents: ${count}`);
  } catch (error) {
    logger.error(`❌ Query failed: ${error}`);
    Deno.exit(1);
  }
}

async function main() {
  await load({ export: true });

  const query = parseArgKV("query") || "你好";
  const pronunciation = parseArgKV("pronunciation");
  const rhymeArgs = parseArgKVs("rhyme");
  const rhymes: Record<number, string> = {};
  if (rhymeArgs.length > 0) {
    for (const arg of rhymeArgs) {
      const [pos, rhyme] = arg.split(":", 2);
      if (pos && rhyme) {
        rhymes[Number(pos)] = rhyme;
      }
    }
  }

  const collectionName = parseArgKV("collection") ||
    Deno.env.get("CHROMA_COLLECTION") ||
    "cantolyr_lexicon_v1_1024";
  const chromaUrl = Deno.env.get("CHROMA_URL") || "http://localhost:8000";
  const limit = parseInt(parseArgKV("limit") || "10");

  logger.info("🚀 Starting Chroma query test...");
  logger.info(`Query: "${query}"`);
  if (pronunciation) {
    logger.info(`Pronunciation filter: "${pronunciation}"`);
  }
  if (Object.keys(rhymes).length > 0) {
    logger.info(`Rhyme filter: ${JSON.stringify(rhymes)}`);
  }
  logger.info(`Collection: ${collectionName}`);
  logger.info(`Chroma URL: ${chromaUrl}`);
  logger.info(`Limit: ${limit}`);

  const skipInit = parseArgFlag("skip-init");

  // Initialize ONNX embedding model
  if (!skipInit) {
    await initializeEmbeddingFunction();
  } else {
    logger.info("⏭️  Skipping model initialization (--skip-init flag)");
  }

  // Test the query
  await testChromaQuery(
    query,
    collectionName,
    chromaUrl,
    limit,
    pronunciation,
    rhymes,
  );

  logger.info("\n✅ Chroma query test completed successfully!");
}

if (import.meta.main) {
  main().catch((error) => {
    logger.error(`❌ Test failed: ${error}`);
    Deno.exit(1);
  });
}
