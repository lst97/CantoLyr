import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getConfig,
  createMvpConfig,
  createConfigFromEnv,
  validateConfig,
  type AppConfig,
} from "../../../../src/infrastructure/config/AppConfig.js";

describe("AppConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("createMvpConfig", () => {
    it("should create MVP configuration with hardcoded defaults", () => {
      const config = createMvpConfig();

      expect(config.env).toBe("development");
      expect(config.database.url).toBe(
        "postgresql://cantolyr:cantolyr@localhost:5432/cantolyr_dev"
      );
      expect(config.database.maxConnections).toBe(10);
      expect(config.database.connectionTimeout).toBe(30000);
      expect(config.database.queryTimeout).toBe(10000);

      expect(config.llm.provider).toBe("dummy");
      expect(config.llm.model).toBe("gemini-2.5-flash");
      expect(config.llm.timeoutMs).toBe(30000);
      expect(config.llm.maxRetries).toBe(3);
      expect(config.llm.enableFallback).toBe(true);

      expect(config.cache.type).toBe("memory");
      expect(config.cache.defaultTtl).toBe(300);
      expect(config.cache.maxSize).toBe(1000);
      expect(config.cache.enableStats).toBe(true);

      expect(config.server.port).toBe(3000);
      expect(config.server.host).toBe("0.0.0.0");
      expect(config.server.logLevel).toBe("info");
      expect(config.server.enableSwagger).toBe(true);
      expect(config.server.corsEnabled).toBe(true);
    });

    it("should use environment variables when available", () => {
      process.env["DATABASE_URL"] = "postgresql://test:test@localhost:5432/test";
      process.env["PORT"] = "4000";
      process.env["GEMINI_API_KEY"] = "test-api-key";

      const config = createMvpConfig();

      expect(config.database.url).toBe(
        "postgresql://test:test@localhost:5432/test"
      );
      expect(config.server.port).toBe(4000);
      expect(config.llm.apiKey).toBe("test-api-key");
    });

    it("should enable query logging in development", () => {
      process.env["NODE_ENV"] = "development";
      const config = createMvpConfig();
      expect(config.database.logQueries).toBe(true);
    });

    it("should disable query logging in production", () => {
      process.env["NODE_ENV"] = "production";
      const config = createMvpConfig();
      expect(config.database.logQueries).toBe(false);
    });
  });

  describe("createConfigFromEnv", () => {
    it("should create configuration from environment variables", () => {
      process.env["NODE_ENV"] = "production";
      process.env["DATABASE_URL"] = "postgresql://prod:prod@localhost:5432/prod";
      process.env["DB_MAX_CONNECTIONS"] = "20";
      process.env["DB_CONNECTION_TIMEOUT"] = "60000";
      process.env["DB_QUERY_TIMEOUT"] = "20000";
      process.env["DB_LOG_QUERIES"] = "true";

      process.env["LLM_PROVIDER"] = "gemini";
      process.env["GEMINI_API_KEY"] = "prod-api-key";
      process.env["LLM_MODEL"] = "gemini-pro";
      process.env["LLM_TIMEOUT_MS"] = "45000";
      process.env["LLM_MAX_RETRIES"] = "5";
      process.env["LLM_ENABLE_FALLBACK"] = "false";

      process.env["CACHE_TYPE"] = "redis";
      process.env["CACHE_DEFAULT_TTL"] = "600";
      process.env["CACHE_MAX_SIZE"] = "5000";
      process.env["CACHE_ENABLE_STATS"] = "false";
      process.env["REDIS_URL"] = "redis://localhost:6379";
      process.env["REDIS_KEY_PREFIX"] = "prod:";

      process.env["PORT"] = "8080";
      process.env["HOST"] = "127.0.0.1";
      process.env["LOG_LEVEL"] = "warn";
      process.env["ENABLE_SWAGGER"] = "false";
      process.env["CORS_ENABLED"] = "false";
      process.env["REQUEST_TIMEOUT"] = "60000";

      const config = createConfigFromEnv();

      expect(config.env).toBe("production");
      expect(config.database.url).toBe(
        "postgresql://prod:prod@localhost:5432/prod"
      );
      expect(config.database.maxConnections).toBe(20);
      expect(config.database.connectionTimeout).toBe(60000);
      expect(config.database.queryTimeout).toBe(20000);
      expect(config.database.logQueries).toBe(true);

      expect(config.llm.provider).toBe("gemini");
      expect(config.llm.apiKey).toBe("prod-api-key");
      expect(config.llm.model).toBe("gemini-pro");
      expect(config.llm.timeoutMs).toBe(45000);
      expect(config.llm.maxRetries).toBe(5);
      expect(config.llm.enableFallback).toBe(false);

      expect(config.cache.type).toBe("redis");
      expect(config.cache.defaultTtl).toBe(600);
      expect(config.cache.maxSize).toBe(5000);
      expect(config.cache.enableStats).toBe(false);
      expect(config.cache.redisUrl).toBe("redis://localhost:6379");
      expect(config.cache.redisKeyPrefix).toBe("prod:");

      expect(config.server.port).toBe(8080);
      expect(config.server.host).toBe("127.0.0.1");
      expect(config.server.logLevel).toBe("warn");
      expect(config.server.enableSwagger).toBe(false);
      expect(config.server.corsEnabled).toBe(false);
      expect(config.server.requestTimeout).toBe(60000);
    });

    it("should use defaults when environment variables are not set", () => {
      // Clear NODE_ENV to test default behavior
      delete process.env["NODE_ENV"];

      const config = createConfigFromEnv();

      expect(config.env).toBe("development");
      expect(config.database.maxConnections).toBe(10);
      expect(config.llm.provider).toBe("dummy");
      expect(config.cache.type).toBe("memory");
      expect(config.server.port).toBe(3000);
    });

    it("should handle invalid numeric environment variables", () => {
      process.env["PORT"] = "invalid";
      process.env["DB_MAX_CONNECTIONS"] = "not-a-number";

      expect(() => createConfigFromEnv()).toThrow();
    });
  });

  describe("validateConfig", () => {
    it("should validate a correct configuration", () => {
      const validConfig: AppConfig = {
        env: "development",
        database: {
          url: "postgresql://test:test@localhost:5432/test",
          maxConnections: 10,
          connectionTimeout: 30000,
          queryTimeout: 10000,
          logQueries: false,
        },
        llm: {
          provider: "dummy",
          model: "gemini-2.5-flash",
          timeoutMs: 30000,
          maxRetries: 3,
          enableFallback: true,
        },
        cache: {
          type: "memory",
          defaultTtl: 300,
          maxSize: 1000,
          enableStats: true,
          redisKeyPrefix: "cantolyr:",
        },
        server: {
          port: 3000,
          host: "0.0.0.0",
          logLevel: "info",
          enableSwagger: true,
          corsEnabled: true,
          requestTimeout: 30000,
        },
      };

      const result = validateConfig(validConfig);
      expect(result).toEqual(validConfig);
    });

    it("should reject invalid database URL", () => {
      const invalidConfig = {
        env: "development",
        database: {
          url: "not-a-valid-url",
          maxConnections: 10,
          connectionTimeout: 30000,
          queryTimeout: 10000,
          logQueries: false,
        },
        llm: { provider: "dummy" },
        cache: { type: "memory" },
        server: { port: 3000 },
      };

      expect(() => validateConfig(invalidConfig)).toThrow();
    });

    it("should reject invalid port number", () => {
      const invalidConfig = {
        env: "development",
        database: { url: "postgresql://test:test@localhost:5432/test" },
        llm: { provider: "dummy" },
        cache: { type: "memory" },
        server: { port: 70000 }, // Invalid port
      };

      expect(() => validateConfig(invalidConfig)).toThrow();
    });

    it("should reject invalid LLM provider", () => {
      const invalidConfig = {
        env: "development",
        database: { url: "postgresql://test:test@localhost:5432/test" },
        llm: { provider: "invalid-provider" },
        cache: { type: "memory" },
        server: { port: 3000 },
      };

      expect(() => validateConfig(invalidConfig)).toThrow();
    });

    it("should reject negative timeout values", () => {
      const invalidConfig = {
        env: "development",
        database: {
          url: "postgresql://test:test@localhost:5432/test",
          connectionTimeout: -1000,
        },
        llm: { provider: "dummy" },
        cache: { type: "memory" },
        server: { port: 3000 },
      };

      expect(() => validateConfig(invalidConfig)).toThrow();
    });
  });

  describe("getConfig", () => {
    it("should return MVP config in development", () => {
      process.env["NODE_ENV"] = "development";
      const config = getConfig();

      // Should be MVP config with dummy LLM
      expect(config.llm.provider).toBe("dummy");
      expect(config.cache.type).toBe("memory");
    });

    it("should return MVP config in test environment", () => {
      process.env["NODE_ENV"] = "test";
      const config = getConfig();

      // Should be MVP config
      expect(config.llm.provider).toBe("dummy");
      expect(config.cache.type).toBe("memory");
    });

    it("should return environment config in production", () => {
      process.env["NODE_ENV"] = "production";
      process.env["LLM_PROVIDER"] = "gemini";
      process.env["GEMINI_API_KEY"] = "prod-key";

      const config = getConfig();

      // Should use environment variables
      expect(config.llm.provider).toBe("gemini");
      expect(config.llm.apiKey).toBe("prod-key");
    });
  });
});
