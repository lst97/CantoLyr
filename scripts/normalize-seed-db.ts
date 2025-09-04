#!/usr/bin/env tsx

/**
 * One-shot bootstrap script:
 * - Ensures DB is reachable and schema is applied (Prisma migrate deploy)
 * - Normalizes sample data (chars + words) and enriches gloss from detail files
 * - Seeds the normalized data into the main database
 *
 * Usage: tsx scripts/normalize-seed-db.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { normalizeCharlistData, entriesToJSONL as charsToJSONL, type CharlistData } from '../src/shared/utils/charlistNormalizer.js';
import { normalizeWordslistData, entriesToJSONL as wordsToJSONL, type WordslistData } from '../src/shared/utils/wordslistNormalizer.js';
import { createDatabaseSeeder } from '../src/shared/utils/databaseSeeder.js';
import { checkDatabaseConnection } from '../src/infrastructure/config/database.js';

type CharDetailItem = {
  char: string;
  pronunciations?: Array<{
    explanations?: Array<{ content?: string }>;
  }>;
};

type WordDetailItem = {
  word: string;
  explanation?: string;
};

async function waitForDbReady(retries = 30, delayMs = 2000) {
  for (let i = 1; i <= retries; i++) {
    const ok = await checkDatabaseConnection();
    if (ok) return true;
    console.log(`⏳ Waiting for database... (${i}/${retries})`);
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

function parseConcatenatedJsonObjects(raw: string): any[] {
  const objs: string[] = [];
  let depth = 0, inStr = false, esc = false, start = -1;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === '{') { if (depth === 0) start = i; depth++; }
      else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { objs.push(raw.slice(start, i + 1)); start = -1; } }
    }
  }
  return objs.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}

function loadCharDetail(filePath: string): Map<string, string> {
  if (!existsSync(filePath)) return new Map();
  const raw = readFileSync(filePath, 'utf-8');
  let items: CharDetailItem[] = [];
  try {
    const parsed = JSON.parse(raw);
    items = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    items = parseConcatenatedJsonObjects(raw) as CharDetailItem[];
  }
  const map = new Map<string, string>();
  for (const item of items) {
    if (!item || typeof item.char !== 'string') continue;
    const contents: string[] = [];
    for (const p of item.pronunciations || []) {
      for (const ex of p.explanations || []) {
        if (ex && typeof ex.content === 'string' && ex.content.trim()) contents.push(ex.content.trim());
      }
    }
    if (contents.length) map.set(item.char, contents.join('； '));
  }
  return map;
}

function loadWordDetail(filePath: string): Map<string, string> {
  if (!existsSync(filePath)) return new Map();
  const raw = readFileSync(filePath, 'utf-8');
  let items: WordDetailItem[] = [];
  try {
    const parsed = JSON.parse(raw);
    items = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    items = parseConcatenatedJsonObjects(raw) as WordDetailItem[];
  }
  const map = new Map<string, string>();
  for (const item of items) {
    if (!item || typeof item.word !== 'string') continue;
    const gloss = (item.explanation || '').trim();
    if (gloss) map.set(item.word, gloss);
  }
  return map;
}

async function main() {
  console.log('🚀 Bootstrapping database and data...');

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL is not set. Please export it before running.');
    process.exit(1);
  }

  // 1) Ensure DB is reachable
  console.log('🔎 Checking database connectivity...');
  const dbReady = await waitForDbReady();
  if (!dbReady) {
    console.error('❌ Database not reachable after retries. Is Docker DB up?');
    process.exit(1);
  }
  console.log('✅ Database is reachable');

  // 2) Apply Prisma migrations (schema init)
  console.log('🧭 Applying Prisma migrations (migrate deploy)...');
  const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
  if (migrate.status !== 0) {
    console.error('❌ Prisma migrate deploy failed.');
    process.exit(migrate.status ?? 1);
  }
  console.log('✅ Migrations applied');

  // Track char surfaces for dedup
  const charSurfaces = new Set<string>();

  // 3) Normalize and enrich charlist
  const charInput = 'data/sample/charlist.json';
  const charDetail = 'data/sample/char_detail.json';
  const charOut = 'data/normalized/normalized-chars.jsonl';
  if (existsSync(charInput)) {
    console.log(`🔤 Normalizing chars from ${charInput}`);
    const rawChar = readFileSync(charInput, 'utf-8');
    const charData: CharlistData = JSON.parse(rawChar);
    const charEntries = normalizeCharlistData(charData, 'words_hk_charlist_v28042025');
    for (const e of charEntries) charSurfaces.add(e.surface);
    const glossMap = loadCharDetail(charDetail);
    for (const entry of charEntries) {
      const g = glossMap.get(entry.surface);
      if (g) {
        entry.lang = 'zh-TW';
        for (const r of entry.readings) r.gloss = g;
      }
    }
    writeFileSync(charOut, charsToJSONL(charEntries));
    console.log(`✅ Wrote ${charOut}`);
  } else {
    console.log(`ℹ️  Skipping char normalization; missing ${charInput}`);
  }

  // 4) Normalize and enrich wordslist (dedup against char surfaces)
  const wordInput = 'data/sample/wordslist.json';
  const wordDetail = 'data/sample/word_detail.json';
  const wordOut = 'data/normalized/normalized-vocab.jsonl';
  if (existsSync(wordInput)) {
    console.log(`🧾 Normalizing words from ${wordInput}`);
    const rawWords = readFileSync(wordInput, 'utf-8');
    const wordsData: WordslistData = JSON.parse(rawWords);
    let wordEntries = normalizeWordslistData(wordsData, 'words_hk_wordslist_v28042025');
    if (charSurfaces.size > 0) {
      const before = wordEntries.length;
      wordEntries = wordEntries.filter(e => !charSurfaces.has(e.surface));
      const after = wordEntries.length;
      const removed = before - after;
      if (removed > 0) console.log(`🧹 Deduped ${removed} vocab entries present in chars (${before} -> ${after}).`);
    }
    const glossMap = loadWordDetail(wordDetail);
    for (const entry of wordEntries) {
      const g = glossMap.get(entry.surface);
      if (g) {
        entry.lang = 'zh-TW';
        for (const r of entry.readings) r.gloss = g;
      }
    }
    writeFileSync(wordOut, wordsToJSONL(wordEntries));
    console.log(`✅ Wrote ${wordOut}`);
  } else {
    console.log(`ℹ️  Skipping words normalization; missing ${wordInput}`);
  }

  // 5) Seed database from normalized files
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const seeder = createDatabaseSeeder(prisma, { batchSize: 1000, logProgress: true });

  try {
    await prisma.$connect();
    console.log('🔌 Connected to DB. Seeding...');
    let totalEntries = 0;
    let totalReadings = 0;

    if (existsSync(charOut)) {
      const res = await seeder.seedFromFile(charOut);
      totalEntries += res.insertedEntries;
      totalReadings += res.insertedReadings;
      console.log(`   ↳ Seeded chars: ${res.insertedEntries} entries, ${res.insertedReadings} readings`);
    }
    if (existsSync(wordOut)) {
      const res = await seeder.seedFromFile(wordOut);
      totalEntries += res.insertedEntries;
      totalReadings += res.insertedReadings;
      console.log(`   ↳ Seeded vocab: ${res.insertedEntries} entries, ${res.insertedReadings} readings`);
    }

    console.log(`✅ Seeding done. Total inserted: ${totalEntries} entries, ${totalReadings} readings.`);
  } catch (e) {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
