import { z } from 'zod';

/**
 * Database configuration schema
 */
const DatabaseConfigSchema = z.object({
  url: z.string().url('Database URL must be a valid URL'),
  maxConnections: z.number().int().positive().default(10),
  connectionTimeout: z.number().int().positive().default(30000), // 30 seconds
  queryTimeout: z.number().int().positive().default(10000), // 10 seconds
  logQueries: z.boolean().default(false)
});

/**
 * LLM configuration schema
 */
const LlmConfigSchema = z.object({
  provider: z.enum(['gemini', 'dummy']).default('gemini'),
  apiKey: z.string().optional(),
  model: z.string().default('gemini-2.5-flash'),
  timeoutMs: z.number().int().positive().default(30000),
  maxRetries: z.number().int().min(0).default(3),
  enableFallback: z.boolean().default(true)
});

/**
 * Cache configuration schema
 */
const CacheConfigSchema = z.object({
  type: z.enum(['memory', 'redis']).default('memory'),
  defaultTtl: z.number().int().positive().default(300), // 5 minutes
  maxSize: z.number().int().positive().default(1000),
  enableStats: z.boolean().default(true),
  // Redis-specific config (for future use)
  redisUrl: z.string().optional(),
  redisKeyPrefix: z.string().default('cantolyr:')
});

/**
 * Server configuration schema
 */
const ServerConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3000),
  host: z.string().default('0.0.0.0'),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  enableSwagger: z.boolean().default(true),
  corsEnabled: z.boolean().default(true),
  requestTimeout: z.number().int().positive().default(60000)
});

/**
 * Application configuration schema
 */
const AppConfigSchema = z.object({
  env: z.enum(['development', 'production', 'test']).default('development'),
  database: DatabaseConfigSchema,
  llm: LlmConfigSchema,
  cache: CacheConfigSchema,
  server: ServerConfigSchema
});

/**
 * Type definitions
 */
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type LlmConfig = z.infer<typeof LlmConfigSchema>;
export type CacheConfig = z.infer<typeof CacheConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

/**
 * MVP Configuration Factory
 * Returns hardcoded configuration for quick development iteration
 */
export function createMvpConfig(): AppConfig {
  const config: AppConfig = {
    env: 'development',
    database: {
      url: process.env["DATABASE_URL"] || 'postgresql://cantolyr:cantolyr@localhost:5432/cantolyr_dev',
      maxConnections: 10,
      connectionTimeout: 30000,
      queryTimeout: 10000,
      logQueries: process.env["NODE_ENV"] === 'development'
    },
    llm: {
      provider: (process.env["LLM_PROVIDER"] as 'gemini' | 'dummy') || 'dummy',
      apiKey: process.env["GEMINI_API_KEY"],
      model: process.env["LLM_MODEL"] || 'gemini-2.5',
      timeoutMs: parseInt(process.env["LLM_TIMEOUT_MS"] || '30000', 10),
      maxRetries: parseInt(process.env["LLM_MAX_RETRIES"] || '3', 10),
      enableFallback: process.env["LLM_ENABLE_FALLBACK"] !== 'false'
    },
    cache: {
      type: 'memory', // In-memory cache for MVP
      defaultTtl: 300, // 5 minutes
      maxSize: 1000,
      enableStats: true,
      redisUrl: undefined,
      redisKeyPrefix: 'cantolyr:'
    },
    server: {
      port: parseInt(process.env["PORT"] || '3000', 10),
      host: process.env["HOST"] || '0.0.0.0',
      logLevel: (process.env["LOG_LEVEL"] as any) || 'info',
      enableSwagger: true,
      corsEnabled: true,
      requestTimeout: parseInt(process.env["REQUEST_TIMEOUT"] || '60000', 10)
    }
  };

  // Validate the configuration
  return AppConfigSchema.parse(config);
}

/**
 * Environment-based configuration factory
 * For future use when moving beyond MVP
 */
export function createConfigFromEnv(): AppConfig {
  const config = {
    env: process.env["NODE_ENV"] || 'development',
    database: {
      url: process.env["DATABASE_URL"] || 'postgresql://cantolyr:cantolyr@localhost:5432/cantolyr_dev',
      maxConnections: parseInt(process.env["DB_MAX_CONNECTIONS"] || '10', 10),
      connectionTimeout: parseInt(process.env["DB_CONNECTION_TIMEOUT"] || '30000', 10),
      queryTimeout: parseInt(process.env["DB_QUERY_TIMEOUT"] || '10000', 10),
      logQueries: process.env["DB_LOG_QUERIES"] === 'true'
    },
    llm: {
      provider: (process.env["LLM_PROVIDER"] as 'gemini' | 'dummy') || 'dummy',
      apiKey: process.env["GEMINI_API_KEY"],
      model: process.env["LLM_MODEL"] || 'gemini-2.5-flash',
      timeoutMs: parseInt(process.env["LLM_TIMEOUT_MS"] || '30000', 10),
      maxRetries: parseInt(process.env["LLM_MAX_RETRIES"] || '3', 10),
      enableFallback: process.env["LLM_ENABLE_FALLBACK"] !== 'false'
    },
    cache: {
      type: (process.env["CACHE_TYPE"] as 'memory' | 'redis') || 'memory',
      defaultTtl: parseInt(process.env["CACHE_DEFAULT_TTL"] || '300', 10),
      maxSize: parseInt(process.env["CACHE_MAX_SIZE"] || '1000', 10),
      enableStats: process.env["CACHE_ENABLE_STATS"] !== 'false',
      redisUrl: process.env["REDIS_URL"],
      redisKeyPrefix: process.env["REDIS_KEY_PREFIX"] || 'cantolyr:'
    },
    server: {
      port: parseInt(process.env["PORT"] || '3000', 10),
      host: process.env["HOST"] || '0.0.0.0',
      logLevel: (process.env["LOG_LEVEL"] as any) || 'info',
      enableSwagger: process.env["ENABLE_SWAGGER"] !== 'false',
      corsEnabled: process.env["CORS_ENABLED"] !== 'false',
      requestTimeout: parseInt(process.env["REQUEST_TIMEOUT"] || '60000', 10)
    }
  };

  return AppConfigSchema.parse(config);
}

/**
 * Validate configuration object
 */
export function validateConfig(config: unknown): AppConfig {
  return AppConfigSchema.parse(config);
}

/**
 * Get configuration for current environment
 * Uses MVP config by default for quick iteration
 */
export function getConfig(): AppConfig {
  // For MVP, always use hardcoded config for quick changes
  if (process.env["NODE_ENV"] !== 'production') {
    return createMvpConfig();
  }
  
  // In production, use environment variables
  return createConfigFromEnv();
}
