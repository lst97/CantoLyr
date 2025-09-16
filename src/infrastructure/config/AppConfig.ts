import { z } from "zod";
import { getLogger } from "jsr:@std/log";

const logger = getLogger();

// Schemas remain the same as they are framework-agnostic
const DatabaseConfigSchema = z.object({
  url: z.string().url(),
  logQueries: z.boolean().default(false),
});

const LlmConfigSchema = z.object({
  provider: z.enum(["gemini", "dummy"]).default("gemini"),
  apiKey: z.string().optional(),
});

const CacheConfigSchema = z.object({
  type: z.enum(["memory", "redis"]).default("memory"),
  defaultTtl: z.number().int().positive().default(300),
  maxSize: z.number().int().positive().default(1000),
});

const ServerConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3000),
  host: z.string().default("0.0.0.0"),
});

const LoggingConfigSchema = z.object({
  level: z
    .enum(["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"])
    .default("INFO"),
  json: z.boolean().default(true),
  console: z.boolean().default(true),
  fileEnabled: z.boolean().default(false),
  filePath: z.string().default("logs/app.log"),
  rotate: z
    .object({
      maxSizeBytes: z.number().int().positive().default(5_000_000),
      maxBackupCount: z.number().int().positive().default(3),
    })
    .default({ maxSizeBytes: 5_000_000, maxBackupCount: 3 }),
});

const AppConfigSchema = z.object({
  env: z.enum(["development", "production", "test"]).default("development"),
  database: DatabaseConfigSchema,
  llm: LlmConfigSchema,
  cache: CacheConfigSchema,
  server: ServerConfigSchema,
  logging: LoggingConfigSchema,
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

/**
 * Gets configuration from Deno environment variables.
 */
export function getConfig(): AppConfig {
  // Prefer Accelerate URL if provided; fallback to direct Postgres URL
  const dbUrl = Deno.env.get("PRISMA_ACCELERATE_URL") || Deno.env.get("DATABASE_URL") || "";

  const config = {
    env: Deno.env.get("DENO_ENV") || "development",
    database: {
      url: dbUrl,
      logQueries: Deno.env.get("DB_LOG_QUERIES") === "true",
    },
    llm: {
      provider: Deno.env.get("LLM_PROVIDER") || "dummy",
      apiKey: Deno.env.get("GEMINI_API_KEY"),
    },
    cache: {
      type: Deno.env.get("CACHE_TYPE") || "memory",
      defaultTtl: parseInt(Deno.env.get("CACHE_DEFAULT_TTL") || "300", 10),
      maxSize: parseInt(Deno.env.get("CACHE_MAX_SIZE") || "1000", 10),
    },
    server: {
      port: parseInt(Deno.env.get("PORT") || "3000", 10),
      host: Deno.env.get("HOST") || "0.0.0.0",
    },
    logging: {
      level: (Deno.env.get("LOG_LEVEL") || "INFO").toUpperCase() as any,
      json: (Deno.env.get("LOG_JSON") || "true").toLowerCase() === "true",
      console: (Deno.env.get("LOG_CONSOLE") || "true").toLowerCase() === "true",
      fileEnabled: (Deno.env.get("LOG_FILE_ENABLED") || "false").toLowerCase() === "true",
      filePath: Deno.env.get("LOG_FILE_PATH") || "logs/app.log",
      rotate: {
        maxSizeBytes: parseInt(
          Deno.env.get("LOG_ROTATE_MAX_SIZE") || "5000000",
          10,
        ),
        maxBackupCount: parseInt(Deno.env.get("LOG_ROTATE_BACKUPS") || "3", 10),
      },
    },
  };

  // We use safeParse to provide a better error message if config is invalid.
  const result = AppConfigSchema.safeParse(config);
  if (!result.success) {
    // Using console here since logger may not be initialized yet
    logger.error(
      "❌ Invalid application configuration:",
      result.error.flatten(),
    );
    throw new Error("Configuration validation failed.");
  }

  return result.data as AppConfig;
}
