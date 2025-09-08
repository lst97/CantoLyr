#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { extractTones } from '../src/shared/utils/jyutping.js';
import { ToneMap } from '../src/domain/value-objects/ToneMap.js';

interface CharlistData {
  [character: string]: {
    [jyutping: string]: number; // frequency
  };
}

interface WordslistData {
  [word: string]: string[]; // array of jyutping pronunciations
}

/**
 * Setup test database with sample data from charlist.json and wordslist.json
 */
async function setupTestDatabase() {
  const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('TEST_DATABASE_URL or DATABASE_URL must be set');
  }
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url
      }
    }
  });

  try {
    console.log('🧹 Cleaning existing test data...');
    
    // Clean up existing test data
    await prisma.feedback.deleteMany({
      where: {
        reading: {
          source: { in: ['test_charlist', 'test_wordslist'] }
        }
      }
    });
    
    await prisma.reading.deleteMany({
      where: {
        source: { in: ['test_charlist', 'test_wordslist'] }
      }
    });
    
    await prisma.entry.deleteMany({
      where: {
        OR: [
          { surface: { in: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] } },
          { surface: { in: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'X', 'Y', 'Z'] } },
          { surface: { in: ['一', '人', '不', '了', '在', '有', '個', '我', '你', '他'] } },
          { surface: { in: ['%', 'OK', 'app', 'baby', 'call', 'game', 'happy', 'test'] } }
        ]
      }
    });

    console.log('📖 Loading sample data...');
    
    // Load charlist data
    const charlistPath = resolve(process.cwd(), 'data/sample/charlist.json');
    const charlistData: CharlistData = JSON.parse(readFileSync(charlistPath, 'utf-8'));
    
    // Load wordslist data  
    const wordslistPath = resolve(process.cwd(), 'data/sample/wordslist.json');
    const wordslistData: WordslistData = JSON.parse(readFileSync(wordslistPath, 'utf-8'));

    console.log('🔤 Processing character data...');
    
    // Process charlist data (characters)
    let charCount = 0;
    let charReadingCount = 0;
    
    for (const [surface, jyutpingMap] of Object.entries(charlistData)) {
      // Skip if we've processed enough for testing
      if (charCount >= 100) break;
      
      // Create entry
      const entry = await prisma.entry.create({
        data: {
          surface,
          type: 'char',
          lang: determineLanguage(surface)
        }
      });

      // Create readings for each jyutping variant
      for (const [jyutping, freq] of Object.entries(jyutpingMap)) {
        const tone = extractTones(jyutping);
        const pronunciation = ToneMap.mapTones(tone).value;
        const syllables = jyutping.split(' ').length;

        await prisma.reading.create({
          // Cast to any to support both older client (jyutping: string) and new (string[])
          data: {
            entryId: entry.id,
            jyutping: jyutping.split(' '),
            tone,
            pronunciation,
            syllables,
            freq: freq / 1000, // Normalize frequency
            pos: determinePartOfSpeech(surface, 'char'),
            register: 'neutral',
            gloss: generateGloss(surface, 'char'),
            source: 'test_charlist'
          } as any
        });
        
        charReadingCount++;
      }
      
      charCount++;
    }

    console.log('📝 Processing word data...');
    
    // Process wordslist data (words/phrases)
    let wordCount = 0;
    let wordReadingCount = 0;
    
    for (const [surface, jyutpingArray] of Object.entries(wordslistData)) {
      // Skip if we've processed enough for testing
      if (wordCount >= 100) break;
      
      // Create entry
      const entry = await prisma.entry.create({
        data: {
          surface,
          type: surface.length === 1 ? 'char' : 'vocab',
          lang: determineLanguage(surface)
        }
      });

      // Create readings for each jyutping variant
      for (let i = 0; i < jyutpingArray.length; i++) {
        const jyutping = jyutpingArray[i]!;
        const tone = extractTones(jyutping);
        const pronunciation = ToneMap.mapTones(tone).value;
        const syllables = jyutping.split(' ').length;

        await prisma.reading.create({
          // Cast to any to support both older client (jyutping: string) and new (string[])
          data: {
            entryId: entry.id,
            jyutping: jyutping.split(' '),
            tone,
            pronunciation,
            syllables,
            freq: (jyutpingArray.length - i) / jyutpingArray.length, // Higher freq for first variants
            pos: determinePartOfSpeech(surface, surface.length === 1 ? 'char' : 'vocab'),
            register: 'colloquial',
            gloss: generateGloss(surface, surface.length === 1 ? 'char' : 'vocab'),
            source: 'test_wordslist'
          } as any
        });
        
        wordReadingCount++;
      }
      
      wordCount++;
    }

    console.log('✅ Test database setup complete!');
    console.log(`📊 Created ${charCount} character entries with ${charReadingCount} readings`);
    console.log(`📊 Created ${wordCount} word entries with ${wordReadingCount} readings`);
    console.log(`📊 Total: ${charCount + wordCount} entries, ${charReadingCount + wordReadingCount} readings`);

  } catch (error) {
    console.error('❌ Error setting up test database:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Determine language based on character content
 */
function determineLanguage(surface: string): string {
  // Check if contains Chinese characters
  if (/[\u4e00-\u9fff]/.test(surface)) {
    return 'zh-HK';
  }
  
  // Check if contains only ASCII letters
  if (/^[A-Za-z]+$/.test(surface)) {
    return 'en';
  }
  
  // Check if contains digits or symbols
  if (/^[0-9\W]+$/.test(surface)) {
    return 'misc';
  }
  
  return 'zh-HK'; // Default
}

/**
 * Determine part of speech based on surface and type
 */
function determinePartOfSpeech(surface: string, type: 'char' | 'vocab'): string {
  // Numbers
  if (/^[0-9]+$/.test(surface)) {
    return 'NUM';
  }
  
  // Letters
  if (/^[A-Za-z]$/.test(surface)) {
    return 'LETTER';
  }
  
  // Mixed alphanumeric (often abbreviations or codes)
  if (/^[A-Za-z0-9]+$/.test(surface) && surface.length > 1) {
    return 'NOUN';
  }
  
  // Default based on type
  return type === 'char' ? 'NOUN' : 'NOUN';
}

/**
 * Generate appropriate gloss based on surface and type
 */
function generateGloss(surface: string, type: 'char' | 'vocab'): string {
  // Numbers
  if (/^[0-9]$/.test(surface)) {
    const digits = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    return `digit ${digits[parseInt(surface)] || surface}`;
  }
  
  // Letters
  if (/^[A-Za-z]$/.test(surface)) {
    return `Latin letter ${surface.toUpperCase()}`;
  }
  
  // Multi-character entries
  if (surface.length > 1) {
    return `${type === 'char' ? 'character' : 'word'} ${surface}`;
  }
  
  // Default
  return `${type} ${surface}`;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupTestDatabase().catch(console.error);
}

export { setupTestDatabase };
