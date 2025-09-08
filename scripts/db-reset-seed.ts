#!/usr/bin/env tsx

/**
 * Development convenience script to drop/init schema via SQL, regenerate Prisma client,
 * and normalize + seed data into the database.
 *
 * Requires:
 * - DATABASE_URL in env pointing to your Postgres instance
 * - `psql` available on PATH
 *
 * Usage: pnpm run db:reset-seed
 */

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { loadEnvFile } from '../src/infrastructure/config/env.js';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: opts.cwd, env: { ...process.env, ...(opts.env || {}) } });
  if (res.status !== 0) {
    throw new Error(`${cmd} exited with status ${res.status}`);
  }
}

async function main() {
  // Load .env into process.env for scripts
  loadEnvFile();
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL is not set. Please export it before running.');
    process.exit(1);
  }

  const sqlPath = resolve('scripts/init-db.sql');
  if (!existsSync(sqlPath)) {
    console.error(`❌ Cannot find ${sqlPath}`);
    process.exit(1);
  }

  console.log('🧹 Dropping + initializing schema from SQL...');
  // Prefer psql if available; otherwise fall back to Prisma raw execution
  const psqlCheck = spawnSync('psql', ['--version'], { stdio: 'ignore' });
  let appliedVia = 'psql';
  if (psqlCheck.status === 0) {
    // Stop on first error to make failures visible
    run('psql', ['-v', 'ON_ERROR_STOP=1', databaseUrl, '-f', sqlPath]);
  } else {
    console.warn('⚠️  psql not found on PATH. Falling back to Prisma raw execution...');
    appliedVia = 'prisma-raw';
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    try {
      const sql = readFileSync(sqlPath, 'utf-8');
      // Split on semicolons followed by newline or EOF
      const statements = sql
        .split(/;\s*(?:\n|$)/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('--'));
      for (const stmt of statements) {
        try {
          // Use unsafe to execute DDL statements
          await prisma.$executeRawUnsafe(stmt);
        } catch (e) {
          // CREATE DATABASE may fail without superuser; log and continue
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`   ↳ Skipping statement due to error: ${msg}\n      ${stmt.substring(0, 160)}...`);
        }
      }
    } finally {
      await prisma.$disconnect();
    }
  }

  // Verify required tables exist; if not, apply Prisma schema directly
  console.log('🔎 Verifying schema objects exist...');
  const verifyClient = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await verifyClient.$connect();
  try {
    // Check for entries table
    const res: Array<{ exists: boolean }> = await verifyClient.$queryRawUnsafe(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'entries') AS exists"
    );
    const ok = Array.isArray(res) && res[0] && (res[0] as any).exists === true;
    if (!ok) {
      console.warn(`⚠️  entries table not found after ${appliedVia}. Applying Prisma schema (db push)...`);
      run('pnpm', ['exec', 'prisma', 'db', 'push']);
    } else {
      console.log('✅ Schema verified.');
    }
  } finally {
    await verifyClient.$disconnect();
  }

  console.log('🧩 Regenerating Prisma client...');
  run('pnpm', ['run', 'db:generate']);

  console.log('🌱 Normalizing and seeding database...');
  run('pnpm', ['exec', 'tsx', 'scripts/normalize-seed-db.ts']);

  console.log('✅ Done. Database reset, normalized, and seeded.');
}

main().catch((e) => { console.error(e); process.exit(1); });
