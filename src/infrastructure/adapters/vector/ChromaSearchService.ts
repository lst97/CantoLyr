import { ChromaClient } from "chromadb";
import { Logger } from "../../logging/Logger.ts";
import { pipeline } from "npm:@huggingface/transformers@3.0.0";

export interface ChromaSearchResult {
  documents: string[][];
  metadatas: Record<string, any>[][];
  distances: number[][];
}

export interface ChromaSearchOptions {
  query: string;
  collection: string;
  limit?: number;
  where?: Record<string, any>;
}

export interface ChromaCollectionStats {
  count: number;
  name: string;
}

/**
 * ChromaSearchService provides vector search capabilities for the Canton-Lyr application.
 * This service handles connection to ChromaDB and provides methods for searching
 * Cantonese lexicon data using vector similarity.
 */
export class ChromaSearchService {
  private client: ChromaClient;
  private chromaUrl: string;
  private logger: Logger;
  private embeddingModel: string;
  private transformersCache: string;
  private embeddingFunction: any = null;
  private isInitialized = false;

  constructor(chromaUrl: string = "http://localhost:8000") {
    this.chromaUrl = chromaUrl;
    this.logger = Logger.for("vector");
    this.embeddingModel = Deno.env.get("EMBEDDING_MODEL") ||
      "onnx-community/Qwen3-Embedding-0.6B-ONNX";
    this.transformersCache = Deno.env.get("TRANSFORMERS_CACHE") || "./.cache/transformers";

    const url = new URL(chromaUrl);
    this.client = new ChromaClient({
      ssl: url.protocol === "https:",
      host: url.hostname,
      port: Number(url.port || (url.protocol === "https:" ? 443 : 8000)),
    });
  }

  /**
   * Initializes the service by connecting to Chroma and loading the embedding model.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    this.logger.info("Initializing ChromaSearchService...");
    await this.connect();
    await this.initializeEmbeddingFunction();
    this.isInitialized = true;
    this.logger.info("ChromaSearchService initialized successfully.");
  }

  private async initializeEmbeddingFunction(): Promise<void> {
    this.logger.info(`📥 Initializing ONNX embedding model: ${this.embeddingModel}`);
    this.logger.info(`📁 Cache directory: ${this.transformersCache}`);

    try {
      await Deno.mkdir(this.transformersCache, { recursive: true });
    } catch {
      // Directory might already exist
    }

    try {
      this.embeddingFunction = await pipeline("feature-extraction", this.embeddingModel, {
        cache_dir: this.transformersCache,
        dtype: "fp32",
      });
      this.logger.info("✅ ONNX embedding model initialized successfully");
    } catch (error) {
      this.logger.error(`❌ Failed to initialize embedding model: ${error}`);
      throw error;
    }
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    if (!this.embeddingFunction) {
      throw new Error("Embedding function not initialized. Call initialize() first.");
    }

    try {
      const output = await this.embeddingFunction([text], {
        pooling: "last_token",
        normalize: true,
      });
      const embedding = output.data;
      return Array.from(embedding);
    } catch (error) {
      this.logger.error(`❌ Failed to generate embedding: ${error}`);
      throw error;
    }
  }

  /**
   * Connect to Chroma server and verify connectivity
   */
  async connect(): Promise<void> {
    try {
      await this.client.heartbeat();
      this.logger.info(`Connected to Chroma at ${this.chromaUrl}`);
    } catch (error) {
      this.logger.error(`Failed to connect to Chroma: ${error}`);
      throw error;
    }
  }

  /**
   * Perform vector similarity search
   */
  async search(options: ChromaSearchOptions): Promise<ChromaSearchResult> {
    await this.initialize();

    try {
      const { query, collection, limit = 10, where } = options;
      const collectionClient = await this.client.getCollection({
        name: collection,
      });

      const queryEmbedding = await this.generateEmbedding(query);

      const results = await collectionClient.query({
        queryEmbeddings: [queryEmbedding],
        nResults: limit,
        where: where,
        include: ["documents", "metadatas", "distances"],
      });

      return results as ChromaSearchResult;
    } catch (error) {
      this.logger.error(`Search failed: ${error}`);
      throw error;
    }
  }

  /**
   * Get collection statistics
   */
  async getCollectionStats(collection: string): Promise<ChromaCollectionStats> {
    try {
      const collectionClient = await this.client.getCollection({
        name: collection,
      });
      const count = await collectionClient.count();
      return { count, name: collection };
    } catch (error) {
      this.logger.error(`Failed to get collection stats: ${error}`);
      throw error;
    }
  }

  /**
   * List all available collections
   */
  async listCollections(): Promise<string[]> {
    try {
      const collections = await this.client.listCollections();
      return collections.map((c: any) => c.name);
    } catch (error) {
      this.logger.error(`Failed to list collections: ${error}`);
      throw error;
    }
  }

  /**
   * Search for Cantonese lexicon entries by text query
   * Returns formatted results suitable for the application
   */
  async searchLexicon(
    query: string,
    options: {
      limit?: number;
      type?: "char" | "vocab";
      language?: string;
      pronunciation?: string;
      rhymes?: Record<number, string>;
    } = {},
  ): Promise<
    Array<{
      text: string;
      metadata: Record<string, any>;
      similarity: number;
    }>
  > {
    const { limit = 10, type, language, pronunciation, rhymes } = options;

    const where: Record<string, any> = {};
    if (type) where.type = type;
    if (language) where.lang = language;
    if (pronunciation) where.pronunciation = pronunciation;
    if (rhymes) {
      for (const position of Object.keys(rhymes)) {
        where[`rhyme${position}`] = rhymes[Number(position)];
      }
    }

    const result = await this.search({
      query,
      collection: "cantolyr_lexicon_v1_1024",
      limit,
      where: Object.keys(where).length > 0 ? where : undefined,
    });

    // Transform results to application format
    return (
      result.documents?.[0]?.map((doc, index) => ({
        text: doc,
        metadata: result.metadatas?.[0]?.[index] || {},
        similarity: result.distances?.[0]?.[index] ? 1 - result.distances[0][index] : 0,
      })) || []
    );
  }

  /**
   * Search for characters only
   */
  searchCharacters(
    query: string,
    limit: number = 10,
  ): Promise<
    Array<{
      text: string;
      metadata: Record<string, any>;
      similarity: number;
    }>
  > {
    return this.searchLexicon(query, { limit, type: "char" });
  }

  /**
   * Search for vocabulary only
   */
  searchVocabulary(
    query: string,
    limit: number = 10,
  ): Promise<
    Array<{
      text: string;
      metadata: Record<string, any>;
      similarity: number;
    }>
  > {
    return this.searchLexicon(query, { limit, type: "vocab" });
  }

  /**
   * Search by specific language variant
   */
  searchByLanguage(
    query: string,
    language: "zh-HK" | "zh-TW" | "misc",
    limit: number = 10,
  ): Promise<
    Array<{
      text: string;
      metadata: Record<string, any>;
      similarity: number;
    }>
  > {
    return this.searchLexicon(query, { limit, language });
  }

  /**
   * Get health status of the Chroma service
   */
  async getHealthStatus(): Promise<{
    connected: boolean;
    collections: string[];
    totalDocuments: number;
  }> {
    try {
      await this.initialize();

      await this.client.heartbeat();
      const collections = await this.listCollections();

      let totalDocuments = 0;
      for (const collectionName of collections) {
        try {
          const stats = await this.getCollectionStats(collectionName);
          totalDocuments += stats.count;
        } catch {
          // Skip collections that can't be accessed
        }
      }

      return {
        connected: true,
        collections,
        totalDocuments,
      };
    } catch (error) {
      this.logger.error(`Health check failed: ${error}`);
      return {
        connected: false,
        collections: [],
        totalDocuments: 0,
      };
    }
  }

  /**
   * Format search results for display
   */
  formatSearchResult(result: ChromaSearchResult, query: string): void {
    const documents = result.documents?.[0] || [];
    const metadatas = result.metadatas?.[0] || [];
    const distances = result.distances?.[0] || [];

    this.logger.info(`Query: "${query}"`);
    this.logger.info(`Found ${documents.length} results:`);

    documents.forEach((doc, index) => {
      const metadata = metadatas[index] || {};
      const distance = distances[index];
      const similarity = distance ? (1 - distance).toFixed(4) : "N/A";

      this.logger.info(`\n${index + 1}. Similarity: ${similarity}`);
      this.logger.info(`   Document: ${doc}`);
      this.logger.info(`   Surface: ${metadata.surface || "N/A"}`);
      this.logger.info(`   Type: ${metadata.type || "N/A"}`);
      this.logger.info(`   Language: ${metadata.lang || "N/A"}`);
      this.logger.info(`   Jyutping: ${metadata.jyutping || "N/A"}`);
      this.logger.info(`   POS: ${metadata.pos || "N/A"}`);
      this.logger.info(`   Register: ${metadata.register || "N/A"}`);
    });
  }
}
