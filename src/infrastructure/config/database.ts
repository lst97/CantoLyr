import { PrismaClient } from '@prisma/client'

// Global variable to store the Prisma client instance
let prisma: PrismaClient

// Singleton pattern for Prisma client to avoid connection issues
export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env['NODE_ENV'] === 'development' ? ['query', 'info', 'warn', 'error'] : ['warn', 'error'],
      errorFormat: 'pretty',
    })
  }
  return prisma
}

// Graceful shutdown handler
export async function disconnectDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect()
  }
}

// Health check function
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    const client = getPrismaClient()
    await client.$queryRaw`SELECT 1`
    return true
  } catch (error) {
    console.error('Database connection failed:', error)
    return false
  }
}