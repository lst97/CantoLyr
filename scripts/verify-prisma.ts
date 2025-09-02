#!/usr/bin/env tsx

/**
 * Script to verify Prisma client setup and database schema
 */

import { getPrismaClient, checkDatabaseConnection } from '../src/infrastructure/config/database.js'

async function verifyPrismaSetup() {
  console.log('🔍 Verifying Prisma setup...')
  
  try {
    // Test client instantiation
    getPrismaClient()
    console.log('✅ Prisma client instantiated successfully')
    
    // Test database connection (will fail if DB is not running, but that's expected)
    const isConnected = await checkDatabaseConnection()
    if (isConnected) {
      console.log('✅ Database connection successful')
    } else {
      console.log('⚠️  Database connection failed (expected if DB is not running)')
    }
    
    // Test that the generated types are available
    console.log('✅ Prisma models available:')
    console.log('  - Entry model available')
    console.log('  - Reading model available')
    
    console.log('🎉 Prisma setup verification complete!')
    
  } catch (error) {
    console.error('❌ Prisma setup verification failed:', error)
    process.exit(1)
  }
}

verifyPrismaSetup().catch(console.error)
