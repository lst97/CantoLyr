/**
 * Database seeding utilities with batch insertion
 */

import { PrismaClient } from '@prisma/client';
import { createJsonlParser } from './jsonlParser.js';
import type { NormalizedEntry, ParseStats } from '../types/data.js';

/**
 * Configuration for database seeding
 */
export interface SeedConfig {
  batchSize: number;
  maxRetries: number;
  retryDelayMs: number;
  logProgress: boolean;
}

/**
 * Default seeding configuration
 */
export const DEFAULT_SEED_CONFIG: SeedConfig = {
  batchSize: 1000,
  maxRetries: 3,
  retryDelayMs: 1000,
  logProgress: true
};

/**
 * Result of seeding operation
 */
export interface SeedResult {
  filePath: string;
  parseStats: ParseStats;
  insertedEntries: number;
  insertedReadings: number;
  duration: number;
  errors: string[];
}

/**
 * Database seeder class for batch insertion of normalized entries
 */
export class DatabaseSeeder {
  private prisma: PrismaClient;
  private config: SeedConfig;

  constructor(prisma: PrismaClient, config: Partial<SeedConfig> = {}) {
    this.prisma = prisma;
    this.config = { ...DEFAULT_SEED_CONFIG, ...config };
  }

  /**
   * Seed database from a JSONL file
   * 
   * @param filePath - Path to the JSONL file
   * @returns Seed result with statistics
   */
  async seedFromFile(filePath: string): Promise<SeedResult> {
    const startTime = Date.now();
    const parser = createJsonlParser();
    const errors: string[] = [];
    
    let insertedEntries = 0;
    let insertedReadings = 0;
    let batch: NormalizedEntry[] = [];

    if (this.config.logProgress) {
      console.log(`Starting to seed from file: ${filePath}`);
    }

    try {
      // Parse file and collect entries in batches
      for await (const result of parser.parseFile(filePath)) {
        if (result.success && result.entry) {
          batch.push(result.entry);
          
          // Process batch when it reaches the configured size
          if (batch.length >= this.config.batchSize) {
            const batchResult = await this.insertBatch(batch);
            insertedEntries += batchResult.entries;
            insertedReadings += batchResult.readings;
            
            if (this.config.logProgress) {
              console.log(`Processed batch: ${insertedEntries} entries, ${insertedReadings} readings`);
            }
            
            batch = [];
          }
        } else if (!result.success) {
          errors.push(`Line ${result.lineNumber}: ${result.error}`);
        }
      }

      // Process remaining entries in the final batch
      if (batch.length > 0) {
        const batchResult = await this.insertBatch(batch);
        insertedEntries += batchResult.entries;
        insertedReadings += batchResult.readings;
        
        if (this.config.logProgress) {
          console.log(`Processed final batch: ${insertedEntries} entries, ${insertedReadings} readings`);
        }
      }

      // Get parse statistics
      const parseStats = await parser.parseFileWithStats(filePath);
      
      const duration = Date.now() - startTime;
      
      if (this.config.logProgress) {
        console.log(`Seeding completed in ${duration}ms`);
        console.log(`Inserted: ${insertedEntries} entries, ${insertedReadings} readings`);
        console.log(`Parse errors: ${parseStats.failedEntries}`);
      }

      return {
        filePath,
        parseStats,
        insertedEntries,
        insertedReadings,
        duration,
        errors
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Fatal error during seeding: ${errorMessage}`);
      
      return {
        filePath,
        parseStats: {
          totalLines: 0,
          successfulEntries: 0,
          failedEntries: 0,
          errors: []
        },
        insertedEntries,
        insertedReadings,
        duration: Date.now() - startTime,
        errors
      };
    }
  }

  /**
   * Insert a batch of normalized entries into the database
   * 
   * @param entries - Batch of normalized entries
   * @returns Number of inserted entries and readings
   */
  private async insertBatch(entries: NormalizedEntry[]): Promise<{ entries: number; readings: number }> {
    let attempt = 0;
    
    while (attempt < this.config.maxRetries) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          let insertedEntries = 0;
          let insertedReadings = 0;

          for (const entry of entries) {
            // Insert entry
            const createdEntry = await tx.entry.create({
              data: {
                surface: entry.surface,
                type: entry.type,
                lang: entry.lang
              }
            });

            insertedEntries++;

            // Insert readings for this entry
            for (const reading of entry.readings) {
              await tx.reading.create({
                data: {
                  entryId: createdEntry.id,
                  jyutping: reading.jyutping,
                  toneOriginal: reading.toneOriginal,
                  toneMapped: reading.toneMapped,
                  syllables: reading.syllables,
                  freq: reading.freq,
                  pos: reading.pos,
                  register: reading.register,
                  gloss: reading.gloss,
                  source: reading.source
                }
              });

              insertedReadings++;
            }
          }

          return { entries: insertedEntries, readings: insertedReadings };
        });

      } catch (error) {
        attempt++;
        
        if (attempt >= this.config.maxRetries) {
          throw new Error(`Failed to insert batch after ${this.config.maxRetries} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs));
        
        if (this.config.logProgress) {
          console.log(`Retrying batch insertion (attempt ${attempt + 1}/${this.config.maxRetries})`);
        }
      }
    }

    throw new Error('Unexpected error in batch insertion');
  }

  /**
   * Clear all entries and readings from the database
   * 
   * @returns Number of deleted entries and readings
   */
  async clearDatabase(): Promise<{ entries: number; readings: number }> {
    if (this.config.logProgress) {
      console.log('Clearing database...');
    }

    return await this.prisma.$transaction(async (tx) => {
      // Delete readings first (due to foreign key constraint)
      const deletedReadings = await tx.reading.deleteMany();
      
      // Delete entries
      const deletedEntries = await tx.entry.deleteMany();

      if (this.config.logProgress) {
        console.log(`Cleared: ${deletedEntries.count} entries, ${deletedReadings.count} readings`);
      }

      return {
        entries: deletedEntries.count,
        readings: deletedReadings.count
      };
    });
  }

  /**
   * Get database statistics
   * 
   * @returns Current database counts
   */
  async getDatabaseStats(): Promise<{ entries: number; readings: number }> {
    const [entries, readings] = await Promise.all([
      this.prisma.entry.count(),
      this.prisma.reading.count()
    ]);

    return { entries, readings };
  }
}

/**
 * Convenience function to create a database seeder
 */
export function createDatabaseSeeder(prisma: PrismaClient, config?: Partial<SeedConfig>): DatabaseSeeder {
  return new DatabaseSeeder(prisma, config);
}