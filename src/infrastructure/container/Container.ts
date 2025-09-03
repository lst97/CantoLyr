import { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config/AppConfig.js";
import { getConfig } from "../config/AppConfig.js";

// Domain ports
import type { ReadingRepo } from "../../application/ports/ReadingRepo.js";
import type { WriteRepo } from "../../application/ports/WriteRepo.js";
import type { Cache } from "../../application/ports/Cache.js";
import type { LlmGroupedSelector } from "../../application/ports/LlmGroupedSelector.js";

// Infrastructure adapters
import { PrismaReadingRepository } from "../adapters/database/PrismaReadingRepository.js";
import { PrismaWriteRepository } from "../adapters/database/PrismaWriteRepository.js";
import { InMemoryCache } from "../adapters/cache/InMemoryCache.js";
import { DummyLlmGroupedSelector } from "../adapters/llm/DummyLlmGroupedSelector.js";
import { GeminiLlmGroupedSelector } from "../adapters/llm/GeminiLlmGroupedSelector.js";

// Application use cases
import { SearchUseCase } from "../../application/use-cases/SearchUseCase.js";
import { ComposeLineUseCase } from "../../application/use-cases/ComposeLineUseCase.js";
import { RecordFeedbackUseCase } from "../../application/use-cases/RecordFeedbackUseCase.js";

// HTTP server
import { FastifyServer } from "../adapters/http/FastifyServer.js";

/**
 * Dependency injection container for the application
 * Manages all service instances and their dependencies
 */
export class Container {
  private static instance: Container;
  private _config: AppConfig;
  private _prisma!: PrismaClient;
  private _readingRepo!: ReadingRepo;
  private _writeRepo!: WriteRepo;
  private _cache!: Cache;
  private _llmGroupedSelector!: LlmGroupedSelector;
  private _searchUseCase!: SearchUseCase;
  private _composeLineUseCase!: ComposeLineUseCase;
  private _recordFeedbackUseCase!: RecordFeedbackUseCase;
  private _server!: FastifyServer;

  private constructor(config?: AppConfig) {
    this._config = config || getConfig();
    this.initializeServices();
  }

  /**
   * Get singleton instance of the container
   */
  public static getInstance(config?: AppConfig): Container {
    if (!Container.instance) {
      Container.instance = new Container(config);
    }
    return Container.instance;
  }

  /**
   * Reset singleton instance (useful for testing)
   */
  public static reset(): void {
    if (Container.instance) {
      Container.instance.dispose();
      Container.instance = null as any;
    }
  }

  /**
   * Initialize all services with their dependencies
   */
  private initializeServices(): void {
    // Initialize Prisma client
    this._prisma = new PrismaClient({
      log: this._config.database.logQueries
        ? ["query", "info", "warn", "error"]
        : ["error"],
      datasources: {
        db: {
          url: this._config.database.url,
        },
      },
    });

    // Initialize repositories
    this._readingRepo = new PrismaReadingRepository(this._prisma);
    this._writeRepo = new PrismaWriteRepository(this._prisma);

    // Initialize cache
    this._cache = new InMemoryCache({
      defaultTtl: this._config.cache.defaultTtl,
      maxSize: this._config.cache.maxSize,
      enableStats: this._config.cache.enableStats,
    });

    // Initialize LLM service based on configuration
    this._llmGroupedSelector = this.createLlmGroupedSelector();

    // Initialize use cases
    this._searchUseCase = new SearchUseCase(this._readingRepo, this._cache);
    this._composeLineUseCase = new ComposeLineUseCase(
      this._readingRepo,
      this._cache,
      this._llmGroupedSelector
    );
    this._recordFeedbackUseCase = new RecordFeedbackUseCase(
      this._writeRepo,
      this._readingRepo
    );

    // Initialize HTTP server
    this._server = new FastifyServer(this);
  }

  /**
   * Create LLM grouped selector based on configuration
   */
  private createLlmGroupedSelector(): LlmGroupedSelector {
    switch (this._config.llm.provider) {
      case "gemini":
        if (!this._config.llm.apiKey) {
          console.warn(
            "Gemini API key not provided, falling back to dummy LLM"
          );
          return new DummyLlmGroupedSelector();
        }
        return new GeminiLlmGroupedSelector({
          apiKey: this._config.llm.apiKey,
          model: this._config.llm.model,
          timeoutMs: this._config.llm.timeoutMs,
          maxRetries: this._config.llm.maxRetries,
          enableFallback: this._config.llm.enableFallback,
        });

      case "dummy":
      default:
        return new DummyLlmGroupedSelector();
    }
  }

  /**
   * Get application configuration
   */
  public get config(): AppConfig {
    return this._config;
  }

  /**
   * Get Prisma client instance
   */
  public get prisma(): PrismaClient {
    return this._prisma;
  }

  /**
   * Get reading repository
   */
  public get readingRepo(): ReadingRepo {
    return this._readingRepo;
  }

  /**
   * Get write repository
   */
  public get writeRepo(): WriteRepo {
    return this._writeRepo;
  }

  /**
   * Get cache instance
   */
  public get cache(): Cache {
    return this._cache;
  }

  /**
   * Get LLM grouped selector
   */
  public get llmGroupedSelector(): LlmGroupedSelector {
    return this._llmGroupedSelector;
  }

  /**
   * Get search use case
   */
  public get searchUseCase(): SearchUseCase {
    return this._searchUseCase;
  }

  /**
   * Get search use case (alternative method name for routes)
   */
  public getSearchUseCase(): SearchUseCase {
    return this._searchUseCase;
  }

  /**
   * Get compose line use case
   */
  public get composeLineUseCase(): ComposeLineUseCase {
    return this._composeLineUseCase;
  }

  /**
   * Get compose line use case (alternative method name for routes)
   */
  public getComposeLineUseCase(): ComposeLineUseCase {
    return this._composeLineUseCase;
  }

  /**
   * Get record feedback use case
   */
  public get recordFeedbackUseCase(): RecordFeedbackUseCase {
    return this._recordFeedbackUseCase;
  }

  /**
   * Get record feedback use case (alternative method name for routes)
   */
  public getRecordFeedbackUseCase(): RecordFeedbackUseCase {
    return this._recordFeedbackUseCase;
  }

  /**
   * Get HTTP server instance
   */
  public get server(): FastifyServer {
    return this._server;
  }

  /**
   * Initialize database connection
   */
  public async initialize(): Promise<void> {
    try {
      await this._prisma.$connect();
      console.log("Database connection established");
    } catch (error) {
      console.error("Failed to connect to database:", error);
      throw error;
    }
  }

  /**
   * Dispose of all resources
   */
  public async dispose(): Promise<void> {
    try {
      // Stop HTTP server first
      await this._server.stop();
      // Then disconnect from database and clear cache
      await this._prisma.$disconnect();
      await this._cache.clear();
      console.log("Container disposed successfully");
    } catch (error) {
      console.error("Error disposing container:", error);
      throw error;
    }
  }

  /**
   * Health check for all services
   */
  public async healthCheck(): Promise<{
    database: boolean;
    cache: boolean;
    llm: boolean;
    overall: boolean;
  }> {
    const health = {
      database: false,
      cache: false,
      llm: false,
      overall: false,
    };

    try {
      // Check database
      await this._prisma.$queryRaw`SELECT 1`;
      health.database = true;
    } catch (error) {
      console.error("Database health check failed:", error);
    }

    try {
      // Check cache
      await this._cache.set("health-check", "ok", 1);
      const result = await this._cache.get("health-check");
      health.cache = result === "ok";
      await this._cache.delete("health-check");
    } catch (error) {
      console.error("Cache health check failed:", error);
    }

    try {
      // Check LLM
      health.llm = await this._llmGroupedSelector.isAvailable();
    } catch (error) {
      console.error("LLM health check failed:", error);
    }

    health.overall = health.database && health.cache && health.llm;
    return health;
  }
}
