#!/usr/bin/env tsx

/**
 * Script to normalize wordslist.json data to JSONL format
 * Usage: tsx scripts/normalize-wordslist.ts [input-file] [output-file]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { processWordslistToJSONL, type WordslistData } from '../src/shared/utils/wordslistNormalizer.js';

async function main() {
  try {
    const inputFile = process.argv[2] || 'data/sample/wordslist.json';
    const outputFile = process.argv[3] || 'data/sample/normalized-vocab.jsonl';
    
    console.log(`🔄 Normalizing wordslist data from: ${inputFile}`);
    
    // Check if input file exists
    if (!existsSync(inputFile)) {
      console.error(`❌ Input file not found: ${inputFile}`);
      process.exit(1);
    }
    
    // Read and parse the wordslist data
    const rawData = readFileSync(inputFile, 'utf-8');
    
    // Handle empty file
    if (!rawData.trim()) {
      console.log(`⚠️  Input file is empty: ${inputFile}`);
      console.log(`📝 Creating empty JSONL file: ${outputFile}`);
      writeFileSync(outputFile, '', 'utf-8');
      return;
    }
    
    const wordslistData: WordslistData = JSON.parse(rawData);
    
    console.log(`📊 Processing ${Object.keys(wordslistData).length} words...`);
    
    // Process the data
    const jsonlOutput = processWordslistToJSONL(wordslistData, 'wordslist_v1');
    
    // Write to output file
    writeFileSync(outputFile, jsonlOutput, 'utf-8');
    
    console.log(`✅ Normalized data written to: ${outputFile}`);
    
    if (jsonlOutput.trim()) {
      const lines = jsonlOutput.split('\n').filter(line => line.trim());
      console.log(`📊 Generated ${lines.length} entries`);
      
      // Show sample output
      console.log('\n📋 Sample normalized entries:');
      lines.slice(0, 5).forEach((line, index) => {
        const entry = JSON.parse(line);
        console.log(`${index + 1}. ${entry.surface} (${entry.type}, ${entry.lang}) - ${entry.readings.length} reading(s)`);
      });
      
      if (lines.length > 5) {
        console.log(`... and ${lines.length - 5} more entries`);
      }
      
      // Show statistics
      const entries = lines.map(line => JSON.parse(line));
      const vocabEntries = entries.filter(e => e.type === 'vocab').length;
      const zhEntries = entries.filter(e => e.lang === 'zh-HK').length;
      const enEntries = entries.filter(e => e.lang === 'en').length;
      const miscEntries = entries.filter(e => e.lang === 'misc').length;
      
      console.log('\n📈 Statistics:');
      console.log(`   Vocabulary entries: ${vocabEntries}`);
      console.log(`   Chinese (zh-HK): ${zhEntries}`);
      console.log(`   English: ${enEntries}`);
      console.log(`   Miscellaneous: ${miscEntries}`);
    } else {
      console.log(`📊 No valid entries generated`);
    }
    
  } catch (error) {
    console.error('❌ Error normalizing wordslist data:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}