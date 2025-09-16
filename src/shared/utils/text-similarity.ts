/**
 * Text similarity utilities for computing semantic similarity between texts
 * Interface definitions for cosine similarity over embedding vectors
 */

/**
 * Represents a dense vector embedding
 */
export type EmbeddingVector = readonly number[];

/**
 * Configuration for similarity computation
 */
export interface SimilarityConfig {
  /**
   * Similarity threshold for considering texts "similar"
   * Values closer to 1.0 require higher similarity
   */
  threshold: number;

  /**
   * Whether to normalize vectors before comparison
   * Recommended for cosine similarity
   */
  normalize: boolean;
}

/**
 * Result of a similarity comparison
 */
export interface SimilarityResult {
  /**
   * Similarity score between 0.0 and 1.0
   * 1.0 = identical, 0.0 = completely dissimilar
   */
  score: number;

  /**
   * Whether the similarity meets the configured threshold
   */
  isSimilar: boolean;
}

/**
 * Interface for computing text similarity
 */
export interface TextSimilarityService {
  /**
   * Compute cosine similarity between two embedding vectors
   * @param vecA - First embedding vector
   * @param vecB - Second embedding vector
   * @param config - Similarity configuration
   * @returns Similarity result
   */
  computeSimilarity(
    vecA: EmbeddingVector,
    vecB: EmbeddingVector,
    config?: Partial<SimilarityConfig>,
  ): SimilarityResult;

  /**
   * Compute similarity between two texts by comparing their embeddings
   * @param textA - First text
   * @param textB - Second text
   * @param config - Similarity configuration
   * @returns Similarity result
   */
  compareTexts(
    textA: string,
    textB: string,
    config?: Partial<SimilarityConfig>,
  ): Promise<SimilarityResult>;

  /**
   * Find the most similar text from a collection
   * @param targetText - Text to find matches for
   * @param candidates - Array of candidate texts
   * @param config - Similarity configuration
   * @returns Array of similarity results sorted by score (highest first)
   */
  findSimilar(
    targetText: string,
    candidates: readonly string[],
    config?: Partial<SimilarityConfig>,
  ): Promise<SimilarityResult[]>;

  /**
   * Batch compute similarities between multiple text pairs
   * @param textPairs - Array of text pairs to compare
   * @param config - Similarity configuration
   * @returns Array of similarity results in same order as input pairs
   */
  batchCompare(
    textPairs: ReadonlyArray<readonly [string, string]>,
    config?: Partial<SimilarityConfig>,
  ): Promise<SimilarityResult[]>;
}

/**
 * Default similarity configuration
 */
export const DEFAULT_SIMILARITY_CONFIG: SimilarityConfig = {
  threshold: 0.7,
  normalize: true,
};

/**
 * Create a text similarity service instance
 * @param embeddingService - Service for generating text embeddings
 * @returns TextSimilarityService instance
 */
export function createTextSimilarityService(
  _embeddingService: EmbeddingService,
): TextSimilarityService {
  // Implementation will be added later
  throw new Error("Text similarity service implementation not yet available");
}

/**
 * Interface for text embedding generation
 * This will be implemented by the embedding adapter
 */
export interface EmbeddingService {
  /**
   * Generate embedding vector for a text
   * @param text - Text to embed
   * @returns Promise resolving to embedding vector
   */
  generateEmbedding(text: string): Promise<EmbeddingVector>;

  /**
   * Generate embeddings for multiple texts
   * @param texts - Array of texts to embed
   * @returns Promise resolving to array of embedding vectors
   */
  generateEmbeddings(texts: readonly string[]): Promise<EmbeddingVector[]>;
}
