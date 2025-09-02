/**
 * Unit tests for database seeder
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { DatabaseSeeder, createDatabaseSeeder, DEFAULT_SEED_CONFIG } from '../../../../src/shared/utils/databaseSeeder.js';

// Mock PrismaClient
const mockPrismaClient = {
  entry: {
    create: vi.fn(),
    count: vi.fn(),
    deleteMany: vi.fn()
  },
  reading: {
    create: vi.fn(),
    count: vi.fn(),
    deleteMany: vi.fn()
  },
  $transaction: vi.fn(),
  $disconnect: vi.fn()
};

describe('DatabaseSeeder', () => {
  let seeder: DatabaseSeeder;
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    seeder = new DatabaseSeeder(mockPrismaClient as any, {
      batchSize: 2,
      logProgress: false
    });
    tempDir = join(process.cwd(), 'temp-test-seeder');
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should use default config when none provided', () => {
      const seeder = new DatabaseSeeder(mockPrismaClient as any);
      expect(seeder['config']).toEqual(DEFAULT_SEED_CONFIG);
    });

    it('should merge provided config with defaults', () => {
      const customConfig = { batchSize: 500, logProgress: false };
      const seeder = new DatabaseSeeder(mockPrismaClient as any, customConfig);
      
      expect(seeder['config'].batchSize).toBe(500);
      expect(seeder['config'].logProgress).toBe(false);
      expect(seeder['config'].maxRetries).toBe(DEFAULT_SEED_CONFIG.maxRetries);
    });
  });

  describe('seedFromFile', () => {
    it('should seed valid entries successfully', async () => {
      const entries = [
        {
          surface: "test1",
          type: "vocab",
          lang: "zh-HK",
          readings: [{
            jyutping: "test1",
            freq: 1,
            pos: "NOUN",
            register: "neutral",
            gloss: "test1",
            source: "test"
          }]
        },
        {
          surface: "test2",
          type: "char",
          lang: "zh-HK",
          readings: [{
            jyutping: "test2",
            freq: 2,
            pos: "VERB",
            register: "formal",
            gloss: "test2",
            source: "test"
          }]
        }
      ];

      const jsonlContent = entries.map(entry => JSON.stringify(entry)).join('\n');
      const filePath = join(tempDir, 'test.jsonl');
      writeFileSync(filePath, jsonlContent);

      // Mock successful database operations
      mockPrismaClient.entry.create
        .mockResolvedValueOnce({ id: 1n })
        .mockResolvedValueOnce({ id: 2n });
      
      mockPrismaClient.reading.create
        .mockResolvedValue({});

      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        return await callback(mockPrismaClient);
      });

      const result = await seeder.seedFromFile(filePath);

      expect(result.insertedEntries).toBe(2);
      expect(result.insertedReadings).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(mockPrismaClient.entry.create).toHaveBeenCalledTimes(2);
      expect(mockPrismaClient.reading.create).toHaveBeenCalledTimes(2);
    });

    it('should handle parsing errors gracefully', async () => {
      const content = [
        JSON.stringify({ surface: "valid", type: "vocab", lang: "zh-HK", readings: [{ jyutping: "test1", freq: 1, pos: "NOUN", register: "neutral", gloss: "test", source: "test" }] }),
        "invalid json {",
        JSON.stringify({ surface: "valid2", type: "vocab", lang: "zh-HK", readings: [{ jyutping: "test2", freq: 1, pos: "NOUN", register: "neutral", gloss: "test", source: "test" }] })
      ].join('\n');

      const filePath = join(tempDir, 'test.jsonl');
      writeFileSync(filePath, content);

      mockPrismaClient.entry.create
        .mockResolvedValueOnce({ id: 1n })
        .mockResolvedValueOnce({ id: 2n });
      
      mockPrismaClient.reading.create.mockResolvedValue({});
      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        return await callback(mockPrismaClient);
      });

      const result = await seeder.seedFromFile(filePath);

      expect(result.insertedEntries).toBe(2);
      expect(result.insertedReadings).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Line 2:');
    });

    it('should process entries in batches', async () => {
      const entries = Array.from({ length: 5 }, (_, i) => ({
        surface: `test${i}`,
        type: "vocab" as const,
        lang: "zh-HK",
        readings: [{
          jyutping: `test${i}`,
          freq: i,
          pos: "NOUN",
          register: "neutral",
          gloss: `test${i}`,
          source: "test"
        }]
      }));

      const jsonlContent = entries.map(entry => JSON.stringify(entry)).join('\n');
      const filePath = join(tempDir, 'test.jsonl');
      writeFileSync(filePath, jsonlContent);

      mockPrismaClient.entry.create.mockImplementation(() => Promise.resolve({ id: 1n }));
      mockPrismaClient.reading.create.mockResolvedValue({});
      
      let transactionCallCount = 0;
      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        transactionCallCount++;
        return await callback(mockPrismaClient);
      });

      const result = await seeder.seedFromFile(filePath);

      expect(result.insertedEntries).toBe(5);
      expect(result.insertedReadings).toBe(5);
      // With batch size 2, we should have 3 transactions (2+2+1)
      expect(transactionCallCount).toBe(3);
    });

    it('should handle database errors with retries', async () => {
      const entry = {
        surface: "test",
        type: "vocab",
        lang: "zh-HK",
        readings: [{
          jyutping: "test1",
          freq: 1,
          pos: "NOUN",
          register: "neutral",
          gloss: "test",
          source: "test"
        }]
      };

      const jsonlContent = JSON.stringify(entry);
      const filePath = join(tempDir, 'test.jsonl');
      writeFileSync(filePath, jsonlContent);

      // Mock database failure then success
      mockPrismaClient.$transaction
        .mockRejectedValueOnce(new Error('Database error'))
        .mockImplementation(async (callback) => {
          return await callback(mockPrismaClient);
        });

      mockPrismaClient.entry.create.mockResolvedValue({ id: 1n });
      mockPrismaClient.reading.create.mockResolvedValue({});

      const result = await seeder.seedFromFile(filePath);

      expect(result.insertedEntries).toBe(1);
      expect(result.insertedReadings).toBe(1);
      expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearDatabase', () => {
    it('should clear all entries and readings', async () => {
      mockPrismaClient.reading.deleteMany.mockResolvedValue({ count: 10 });
      mockPrismaClient.entry.deleteMany.mockResolvedValue({ count: 5 });
      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        return await callback(mockPrismaClient);
      });

      const result = await seeder.clearDatabase();

      expect(result.entries).toBe(5);
      expect(result.readings).toBe(10);
      expect(mockPrismaClient.reading.deleteMany).toHaveBeenCalledBefore(
        mockPrismaClient.entry.deleteMany as any
      );
    });
  });

  describe('getDatabaseStats', () => {
    it('should return current database counts', async () => {
      mockPrismaClient.entry.count.mockResolvedValue(5);
      mockPrismaClient.reading.count.mockResolvedValue(10);

      const stats = await seeder.getDatabaseStats();

      expect(stats.entries).toBe(5);
      expect(stats.readings).toBe(10);
    });
  });

  describe('createDatabaseSeeder', () => {
    it('should create a new seeder instance', () => {
      const seeder = createDatabaseSeeder(mockPrismaClient as any);
      expect(seeder).toBeInstanceOf(DatabaseSeeder);
    });

    it('should pass config to constructor', () => {
      const config = { batchSize: 100 };
      const seeder = createDatabaseSeeder(mockPrismaClient as any, config);
      expect(seeder['config'].batchSize).toBe(100);
    });
  });
});