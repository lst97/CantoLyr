import { PrismaClient } from "../../../../../prisma/generated/client.ts";

/**
 * Prisma implementation for Lyrics write operations (CQRS write side)
 * Contains insert/update operations for lyrics domain if needed in the future
 */
export class LyricsWriteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // Placeholder for future write operations (e.g., moderation, manual corrections)
}
