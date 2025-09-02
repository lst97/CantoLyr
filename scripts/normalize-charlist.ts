#!/usr/bin/env tsx

/**
 * Script to normalize charlist.json data to JSONL format
 * Usage: tsx scripts/normalize-charlist.ts [input-file] [output-file]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { processCharlistToJSONL, type CharlistData } from '../src/shared/utils/charlistNormalizer.js';

async function main() {
  try {
    const inputFile = process.argv[2] || 'data/sample/charlist.json';
    const outputFile = process.argv[3] || 'data/sample/normalized-chars.jsonl';
    
    console.log(`🔄 Normalizing charlist data from: ${inputFile}`);
    
    // Check if input file exists
    if (!existsSync(inputFile)) {
      console.error(`❌ Input file not found: ${inputFile}`);
      process.exit(1);
    }
    
    // Read and parse the charlist data
    const rawData = readFileSync(inputFile, 'utf-8');
    const charlistData: CharlistData = JSON.parse(rawData);
    
    console.log(`📊 Processing ${Object.keys(charlistData).length} characters...`);
    
    // Process the data
    const jsonlOutput = processCharlistToJSONL(charlistData, 'charfreq_v1');
    
    // Write to output file
    writeFileSync(outputFile, jsonlOutput, 'utf-8');
    
    console.log(`✅ Normalized data written to: ${outputFile}`);
    console.log(`📊 Generated ${jsonlOutput.split('\n').length} entries`);
    
    // Show sample output
    console.log('\n📋 Sample normalized entries:');
    const lines = jsonlOutput.split('\n');
    lines.slice(0, 5).forEach((line, index) => {
      const entry = JSON.parse(line);
      console.log(`${index + 1}. ${entry.surface} (${entry.type}, ${entry.lang}) - ${entry.readings.length} reading(s)`);
    });
    
    if (lines.length > 5) {
      console.log(`... and ${lines.length - 5} more entries`);
    }
    
    // Show statistics
    const entries = lines.map(line => JSON.parse(line));
    const charEntries = entries.filter(e => e.type === 'char').length;
    const vocabEntries = entries.filter(e => e.type === 'vocab').length;
    const zhEntries = entries.filter(e => e.lang === 'zh-HK').length;
    const miscEntries = entries.filter(e => e.lang === 'misc').length;
    
    console.log('\n📈 Statistics:');
    console.log(`   Characters: ${charEntries}`);
    console.log(`   Vocabulary: ${vocabEntries}`);
    console.log(`   Chinese (zh-HK): ${zhEntries}`);
    console.log(`   Miscellaneous: ${miscEntries}`);
    
  } catch (error) {
    console.error('❌ Error normalizing charlist data:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
