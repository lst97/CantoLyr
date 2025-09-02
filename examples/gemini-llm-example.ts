/**
 * Example usage of GeminiLlmReranker with the official Google Gen AI SDK
 *
 * This example demonstrates how to use the GeminiLlmReranker to rerank
 * Cantonese readings for lyrical composition.
 */

import { GeminiLlmReranker } from "../src/infrastructure/adapters/llm/GeminiLlmReranker.js";
import type { RerankInput } from "../src/application/ports/LlmReranker.js";
import type { ReadingDTO } from "../src/application/ports/ReadingRepo.js";

async function main() {
  // Initialize the reranker with your Gemini API key
  const reranker = new GeminiLlmReranker({
    apiKey: process.env.GEMINI_API_KEY, // Set this environment variable
    model: "gemini-2.0-flash-001", // Optional: specify model
    timeoutMs: 30000, // Optional: set timeout
  });

  // Sample Cantonese readings for the tone pattern "43"
  const candidates: ReadingDTO[] = [
    {
      id: BigInt(1),
      entryId: BigInt(101),
      surface: "愛",
      type: "char",
      lang: "zh-HK",
      jyutping: "oi3",
      toneOriginal: "3",
      toneMapped: "4",
      syllables: 1,
      freq: 85.5,
      pos: "VERB",
      register: "neutral",
      gloss: "love",
      source: "example",
    },
    {
      id: BigInt(2),
      entryId: BigInt(102),
      surface: "心",
      type: "char",
      lang: "zh-HK",
      jyutping: "sam1",
      toneOriginal: "1",
      toneMapped: "3",
      syllables: 1,
      freq: 92.1,
      pos: "NOUN",
      register: "neutral",
      gloss: "heart",
      source: "example",
    },
    {
      id: BigInt(3),
      entryId: BigInt(103),
      surface: "情",
      type: "char",
      lang: "zh-HK",
      jyutping: "cing4",
      toneOriginal: "4",
      toneMapped: "3",
      syllables: 1,
      freq: 78.3,
      pos: "NOUN",
      register: "neutral",
      gloss: "emotion, feeling",
      source: "example",
    },
  ];

  // Create rerank input
  const input: RerankInput = {
    candidates,
    tonePattern: "43",
    constraints: {
      theme: "romantic",
      mood: "tender",
    },
    context: {
      genre: "ballad",
      target_audience: "young_adults",
    },
    topK: 3,
  };

  try {
    console.log("🎵 Reranking Cantonese readings for lyrical composition...\n");

    // Check if the service is available
    const isAvailable = await reranker.isAvailable();
    if (!isAvailable) {
      console.error(
        "❌ Gemini API is not available. Please check your API key."
      );
      return;
    }

    // Get service info
    const info = reranker.getInfo();
    console.log(
      `📡 Using: ${info.provider} (${info.model} v${info.version})\n`
    );

    // Perform reranking
    const result = await reranker.rerank(input);

    if (result.success) {
      console.log("✅ Reranking successful!\n");
      console.log(`⏱️  Processing time: ${result.processingTimeMs}ms\n`);
      console.log("🏆 Rankings:");

      result.rankings.forEach((ranking, index) => {
        const candidate = candidates.find((c) => c.id === ranking.readingId);
        console.log(
          `${index + 1}. ${candidate?.surface} (${candidate?.jyutping})`
        );
        console.log(`   Score: ${ranking.score.toFixed(3)}`);
        console.log(`   Reason: ${ranking.reason || "No reason provided"}`);
        console.log(`   Gloss: ${candidate?.gloss}\n`);
      });
    } else {
      console.error("❌ Reranking failed:", result.error);
    }
  } catch (error) {
    console.error("💥 Unexpected error:", error);
  }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main };
