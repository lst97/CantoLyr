#!/usr/bin/env tsx

/**
 * Script to seed the main database with sample data from charlist.json and wordslist.json
 * Usage: tsx scripts/seed-sample-data.ts
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { normalizeCharlistData, type CharlistData } from '../src/shared/utils/charlistNormalizer.js';
import { normalizeWordslistData, type WordslistData } from '../src/shared/utils/wordslistNormalizer.js';

async function main() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🌱 Starting database seeding with sample data...');
    
    // Load and normalize sample data
    console.log('📖 Loading sample data files...');
    
    // Load charlist data
    const charlistRaw = readFileSync('data/sample/charlist.json', 'utf-8');
    const charlistData: CharlistData = JSON.parse(charlistRaw);
    const charEntries = normalizeCharlistData(charlistData, 'charfreq_v1');
    
    // Load wordslist data
    const wordslistRaw = readFileSync('data/sample/wordslist.json', 'utf-8');
    const wordslistData: WordslistData = JSON.parse(wordslistRaw);
    const vocabEntries = normalizeWordslistData(wordslistData, 'wordslist_v1');
    
    // Combine all entries
    const allEntries = [...charEntries, ...vocabEntries];
    console.log(`📊 Loaded ${allEntries.length} entries (${charEntries.length} chars, ${vocabEntries.length} vocab)`);
    
    // Check if data already exists
    const existingCount = await prisma.entry.count({
      where: {
        readings: {
          some: {
            source: { in: ['charfreq_v1', 'wordslist_v1'] }
          }
        }
      }
    });
    
    if (existingCount > 0) {
      console.log(`⚠️  Found ${existingCount} existing entries with sample data sources.`);
      console.log('🧹 Cleaning up existing sample data...');
      
      // Clean up existing sample data
      await prisma.feedback.deleteMany({
        where: {
          reading: {
            source: { in: ['charfreq_v1', 'wordslist_v1'] }
          }
        }
      });
      
      await prisma.reading.deleteMany({
        where: {
          source: { in: ['charfreq_v1', 'wordslist_v1'] }
        }
      });
      
      await prisma.entry.deleteMany({
        where: {
          readings: {
            some: {
              source: { in: ['charfreq_v1', 'wordslist_v1'] }
            }
          }
        }
      });
      
      console.log('✅ Cleaned up existing sample data');
    }
    
    // Insert new data
    console.log('💾 Inserting sample data into database...');
    let insertedEntries = 0;
    let insertedReadings = 0;
    let skippedEntries = 0;
    
    for (const entry of allEntries) {
      try {
        // Create entry
        const createdEntry = await prisma.entry.create({
          data: {
            surface: entry.surface,
            type: entry.type,
            lang: entry.lang,
          },
        });
        
        insertedEntries++;
        
        // Create readings for this entry
        for (const reading of entry.readings) {
          await prisma.reading.create({
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
              source: reading.source,
            },
          });
          
          insertedReadings++;
        }
        
        // Progress indicator
        if (insertedEntries % 1000 === 0) {
          console.log(`📈 Progress: ${insertedEntries}/${allEntries.length} entries inserted...`);
        }
        
      } catch (error) {
        console.warn(`⚠️  Failed to insert entry "${entry.surface}":`, error);
        skippedEntries++;
      }
    }
    
    console.log('\n🎉 Database seeding completed!');
    console.log(`📊 Statistics:`);
    console.log(`   ✅ Entries inserted: ${insertedEntries}`);
    console.log(`   ✅ Readings inserted: ${insertedReadings}`);
    console.log(`   ⚠️  Entries skipped: ${skippedEntries}`);
    
    // Verify the data
    const finalCount = await prisma.entry.count();
    const readingCount = await prisma.reading.count();
    
    console.log(`\n🔍 Database verification:`);
    console.log(`   📚 Total entries in database: ${finalCount}`);
    console.log(`   📖 Total readings in database: ${readingCount}`);
    
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}