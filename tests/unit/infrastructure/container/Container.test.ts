import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Container } from '../../../../src/infrastructure/container/Container.js';
import type { AppConfig } from '../../../../src/infrastructure/config/AppConfig.js';

// Mock Prisma Client
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }])
  }))
}));

// Mock adapters
vi.mock('../../../../src/infrastructure/adapters/database/PrismaReadingRepository.js', () => ({
  PrismaReadingRepository: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('../../../../src/infrastructure/adapters/database/PrismaWriteRepository.js', () => ({
  PrismaWriteRepository: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('../../../../src/infrastructure/adapters/cache/InMemoryCache.js', () => ({
  InMemoryCache: vi.fn().mockImplementation(() => ({
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue('ok'),
    delete: vi.fn().mockResolvedValue(true),
    clear: vi.fn().mockResolvedValue(undefined)
  }))
}));

vi.mock('../../../../src/infrastructure/adapters/llm/DummyLlmGroupedSelector.js', () => ({
  DummyLlmGroupedSelector: vi.fn().mockImplementation(() => ({
    isAvailable: vi.fn().mockResolvedValue(true)
  }))
}));

vi.mock('../../../../src/infrastructure/adapters/llm/GeminiLlmGroupedSelector.js', () => ({
  GeminiLlmGroupedSelector: vi.fn().mockImplementation(() => ({
    isAvailable: vi.fn().mockResolvedValue(true)
  }))
}));

describe('Container', () => {
  let testConfig: AppConfig;

  beforeEach(() => {
    Container.reset();
    
    testConfig = {
      env: 'test',
      database: {
        url: 'postgresql://test:test@localhost:5432/test',
        maxConnections: 5,
        connectionTimeout: 10000,
        queryTimeout: 5000,
        logQueries: false
      },
      llm: {
        provider: 'dummy',
        model: 'test-model',
        timeoutMs: 10000,
        maxRetries: 1,
        enableFallback: true
      },
      cache: {
        type: 'memory',
        defaultTtl: 60,
        maxSize: 100,
        enableStats: true,
        redisKeyPrefix: 'test:'
      },
      server: {
        port: 3001,
        host: 'localhost',
        logLevel: 'error',
        enableSwagger: false,
        corsEnabled: false,
        requestTimeout: 10000
      }
    };
  });

  afterEach(() => {
    Container.reset();
  });

  describe('getInstance', () => {
    it('should create singleton instance', () => {
      const container1 = Container.getInstance(testConfig);
      const container2 = Container.getInstance();

      expect(container1).toBe(container2);
    });

    it('should use provided config', () => {
      const container = Container.getInstance(testConfig);
      expect(container.config).toEqual(testConfig);
    });

    it('should initialize all services', () => {
      const container = Container.getInstance(testConfig);

      expect(container.prisma).toBeDefined();
      expect(container.readingRepo).toBeDefined();
      expect(container.writeRepo).toBeDefined();
      expect(container.cache).toBeDefined();
      expect(container.llmGroupedSelector).toBeDefined();
      expect(container.searchUseCase).toBeDefined();
      expect(container.composeLineUseCase).toBeDefined();
      expect(container.recordFeedbackUseCase).toBeDefined();
    });
  });

  describe('LLM service creation', () => {
    it('should create dummy LLM when provider is dummy', () => {
      const config = { ...testConfig, llm: { ...testConfig.llm, provider: 'dummy' as const } };
      const container = Container.getInstance(config);

      expect(container.llmGroupedSelector).toBeDefined();
      // The actual implementation type is mocked, but we can verify it was created
    });

    it('should create Gemini LLM when provider is gemini and API key is provided', () => {
      const config = {
        ...testConfig,
        llm: {
          ...testConfig.llm,
          provider: 'gemini' as const,
          apiKey: 'test-api-key'
        }
      };
      const container = Container.getInstance(config);

      expect(container.llmGroupedSelector).toBeDefined();
    });

    it('should fallback to dummy LLM when Gemini provider is selected but no API key', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const config = {
        ...testConfig,
        llm: {
          ...testConfig.llm,
          provider: 'gemini' as const,
          apiKey: undefined
        }
      };
      const container = Container.getInstance(config);

      expect(container.llmGroupedSelector).toBeDefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Gemini API key not provided, falling back to dummy LLM'
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('initialize', () => {
    it('should connect to database', async () => {
      const container = Container.getInstance(testConfig);
      const connectSpy = vi.spyOn(container.prisma, '$connect');

      await container.initialize();

      expect(connectSpy).toHaveBeenCalled();
    });

    it('should handle database connection errors', async () => {
      const container = Container.getInstance(testConfig);
      const error = new Error('Connection failed');
      vi.spyOn(container.prisma, '$connect').mockRejectedValue(error);

      await expect(container.initialize()).rejects.toThrow('Connection failed');
    });
  });

  describe('dispose', () => {
    it('should disconnect from database and clear cache', async () => {
      const container = Container.getInstance(testConfig);
      const disconnectSpy = vi.spyOn(container.prisma, '$disconnect');
      const clearSpy = vi.spyOn(container.cache, 'clear');

      await container.dispose();

      expect(disconnectSpy).toHaveBeenCalled();
      expect(clearSpy).toHaveBeenCalled();
    });

    it('should handle disposal errors', async () => {
      const container = Container.getInstance(testConfig);
      const error = new Error('Disposal failed');
      vi.spyOn(container.prisma, '$disconnect').mockRejectedValue(error);

      await expect(container.dispose()).rejects.toThrow('Disposal failed');
    });
  });

  describe('healthCheck', () => {
    it('should return health status for all services', async () => {
      const container = Container.getInstance(testConfig);
      
      const health = await container.healthCheck();

      expect(health).toHaveProperty('database');
      expect(health).toHaveProperty('cache');
      expect(health).toHaveProperty('llm');
      expect(health).toHaveProperty('overall');
      expect(typeof health.database).toBe('boolean');
      expect(typeof health.cache).toBe('boolean');
      expect(typeof health.llm).toBe('boolean');
      expect(typeof health.overall).toBe('boolean');
    });

    it('should handle database health check failure', async () => {
      const container = Container.getInstance(testConfig);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(container.prisma, '$queryRaw').mockRejectedValue(new Error('DB Error'));

      const health = await container.healthCheck();

      expect(health.database).toBe(false);
      expect(health.overall).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('Database health check failed:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });

    it('should handle cache health check failure', async () => {
      const container = Container.getInstance(testConfig);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(container.cache, 'set').mockRejectedValue(new Error('Cache Error'));

      const health = await container.healthCheck();

      expect(health.cache).toBe(false);
      expect(health.overall).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('Cache health check failed:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });

    it('should handle LLM health check failure', async () => {
      const container = Container.getInstance(testConfig);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(container.llmGroupedSelector, 'isAvailable').mockRejectedValue(new Error('LLM Error'));

      const health = await container.healthCheck();

      expect(health.llm).toBe(false);
      expect(health.overall).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('LLM health check failed:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });

    it('should return overall true when all services are healthy', async () => {
      const container = Container.getInstance(testConfig);

      const health = await container.healthCheck();

      expect(health.database).toBe(true);
      expect(health.cache).toBe(true);
      expect(health.llm).toBe(true);
      expect(health.overall).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset singleton instance', async () => {
      const container1 = Container.getInstance(testConfig);
      const disposeSpy = vi.spyOn(container1, 'dispose').mockResolvedValue();
      
      Container.reset();
      
      const container2 = Container.getInstance(testConfig);
      
      expect(container1).not.toBe(container2);
      expect(disposeSpy).toHaveBeenCalled();
    });
  });
});