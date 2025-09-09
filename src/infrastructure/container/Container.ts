import { getConfig } from "../config/index.ts";
import type { AppConfig } from "../config/index.ts";
import { Logger } from "../logging/Logger.ts";

// Ports
import type { ReadingRepo } from "../../application/ports/ReadingRepo.ts";
import type { WriteRepo } from "../../application/ports/WriteRepo.ts";
import type { Cache } from "../../application/ports/Cache.ts";
import type { LlmGroupedSelector } from "../../application/ports/LlmGroupedSelector.ts";

// Adapters
import { PrismaReadingRepository } from "../adapters/database/PrismaReadingRepository.ts";
import { PrismaWriteRepository } from "../adapters/database/PrismaWriteRepository.ts";
import { InMemoryCache } from "../adapters/cache/InMemoryCache.ts";
import { GeminiLlmGroupedSelector } from "../adapters/llm/GeminiLlmGroupedSelector.ts";

// Use Cases
import { SearchUseCase } from "../../application/use-cases/SearchUseCase.ts";
import { ComposeLineUseCase } from "../../application/use-cases/ComposeLineUseCase.ts";
import { RecordFeedbackUseCase } from "../../application/use-cases/RecordFeedbackUseCase.ts";
import { PrismaClient } from "../../../prisma/generated/client.ts";

// Type for resolvable services
export type ServiceName = keyof Container["services"];

/**
 * Dependency injection container for the application.
 * Manages service instances and their dependencies.
 * Simplified for Deno: instantiated directly, no singleton.
 */
export class Container {
	public readonly config: AppConfig;
	private readonly prisma: PrismaClient;
	public readonly services: {
		logger: Logger;
		readingRepo: ReadingRepo;
		writeRepo: WriteRepo;
		cache: Cache;
		llmGroupedSelector: LlmGroupedSelector;
		searchUseCase: SearchUseCase;
		composeLineUseCase: ComposeLineUseCase;
		recordFeedbackUseCase: RecordFeedbackUseCase;
	};

	private constructor(config: AppConfig, prisma: PrismaClient, logger: Logger) {
		this.config = config;
		this.prisma = prisma;

		// Initialize services
		const cache = new InMemoryCache({
			defaultTtl: this.config.cache.defaultTtl,
			maxSize: this.config.cache.maxSize,
		});
		const readingRepo = new PrismaReadingRepository(this.prisma);
		const writeRepo = new PrismaWriteRepository(this.prisma);
		const llmGroupedSelector = this.createLlmGroupedSelector();

		this.services = {
			logger,
			cache,
			readingRepo,
			writeRepo,
			llmGroupedSelector,
			searchUseCase: new SearchUseCase(readingRepo, cache),
			composeLineUseCase: new ComposeLineUseCase(
				readingRepo,
				cache,
				llmGroupedSelector
			),
			recordFeedbackUseCase: new RecordFeedbackUseCase(writeRepo, readingRepo),
		};
	}

	/**
	 * Asynchronously creates and initializes a new Container instance.
	 */
	public static async create(): Promise<Container> {
		const config = getConfig();
		await Logger.init({
			level: config.logging.level,
			json: config.logging.json,
			console: config.logging.console,
			fileEnabled: config.logging.fileEnabled,
			filePath: config.logging.filePath,
			rotate: config.logging.rotate,
		});
		const logger = Logger.for("app", { env: config.env });
		const prisma = new PrismaClient({
			datasources: { db: { url: config.database.url } },
			log: config.database.logQueries
				? ["query", "warn", "error"]
				: ["warn", "error"],
		});
		if (config.database.logQueries) {
			// deno-lint-ignore no-explicit-any
			(prisma as any).$on(
				"query",
				(e: { query: string; params: string; duration: number }) => {
					Logger.for("db").debug("db_query", {
						query: e.query,
						params: e.params,
						duration_ms: e.duration,
					});
				}
			);
		}
		await prisma.$connect();
		try {
			await prisma.$executeRawUnsafe("SET client_encoding TO 'UTF8'");
		} catch (_) {
			// ignore if not supported by driver/runtime
		}
		logger.info("database_connected");
		return new Container(config, prisma, logger);
	}

	/**
	 * Resolves a service by its name.
	 */
	public resolve<T extends ServiceName>(name: T): this["services"][T] {
		return this.services[name];
	}

	private createLlmGroupedSelector(): LlmGroupedSelector {
		switch (this.config.llm.provider) {
			case "gemini":
				if (!this.config.llm.apiKey) {
					throw new Error("Gemini API key is required");
				}
				return new GeminiLlmGroupedSelector({ apiKey: this.config.llm.apiKey });
		}
		throw new Error("Invalid LLM provider");
	}

	/**
	 * Performs a health check on all critical services.
	 */
	public async healthCheck(): Promise<Record<string, boolean>> {
		const health = { database: false, cache: false, llm: false };
		try {
			await this.prisma.$queryRaw`SELECT 1`;
			health.database = true;
		} catch (e) {
			this.services.logger.error("db_health_check_failed", {
				error: e instanceof Error ? e.message : String(e),
			});
		}

		try {
			await this.services.cache.set("health", "ok", 1);
			health.cache = (await this.services.cache.get("health")) === "ok";
		} catch (e) {
			this.services.logger.error("cache_health_check_failed", {
				error: e instanceof Error ? e.message : String(e),
			});
		}

		try {
			health.llm = await this.services.llmGroupedSelector.isAvailable();
		} catch (e) {
			this.services.logger.error("llm_health_check_failed", {
				error: e instanceof Error ? e.message : String(e),
			});
		}

		return health;
	}

	/**
	 * Disposes of all resources, like database connections.
	 */
	public async dispose(): Promise<void> {
		await this.prisma.$disconnect();
		this.services.logger.info("database_disconnected");
	}
}
