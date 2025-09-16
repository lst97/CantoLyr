export { countSyllables, extractTones, isValidJyutping, normalizeJyutping } from "./jyutping.ts";

export {
  type CharlistData,
  entriesToJSONL,
  normalizeCharlistData,
  processCharlistToJSONL,
} from "./charlistNormalizer.ts";

export { type NormalizedEntry, type NormalizedReading } from "../types/data.ts";

export {
  entriesToJSONL as wordslistEntriesToJSONL,
  normalizeWordslistData,
  processWordslistToJSONL,
  type WordslistData,
  type WordslistEntry,
  type WordslistReading,
} from "./wordslistNormalizer.ts";

export { createJsonlParser, JsonlParser } from "./jsonlParser.ts";

export {
  createDatabaseSeeder,
  DatabaseSeeder,
  DEFAULT_SEED_CONFIG,
  type SeedConfig,
  type SeedResult,
} from "./databaseSeeder.ts";

export { createSeedRng, type SeedRng } from "./seed-rng.ts";

export {
  createTextSimilarityService,
  DEFAULT_SIMILARITY_CONFIG,
  type EmbeddingService,
  type EmbeddingVector,
  type SimilarityConfig,
  type SimilarityResult,
  type TextSimilarityService,
} from "./text-similarity.ts";
