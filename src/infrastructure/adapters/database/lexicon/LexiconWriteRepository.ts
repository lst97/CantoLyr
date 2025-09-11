import { PrismaClient } from "../../../../../prisma/generated/client.ts";
import type { FeedbackRecord, SelectionInput, WriteRepo } from "../../../../application/ports/WriteRepo.ts";

/**
 * Prisma implementation of WriteRepo for the Lexicon domain
 * Implements CQRS write side for user selection tracking and learning
 */
export class LexiconWriteRepository implements WriteRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async recordSelection(input: SelectionInput): Promise<void> {
    const { readingId, accepted, sessionId, context, timestamp = new Date() } = input;

    await this.prisma.feedback.create({
      data: {
        readingId,
        accepted,
        sessionId: sessionId || null,
        ...(context !== undefined ? { context } : {}),
        createdAt: timestamp,
      },
    });
  }

  async getFeedbackForReading(readingId: bigint): Promise<FeedbackRecord[]> {
    const feedback = await this.prisma.feedback.findMany({
      where: { readingId },
      orderBy: { createdAt: "desc" },
    });
    return feedback.map(this.mapToFeedbackRecord);
  }

  async getFeedbackForSession(sessionId: string): Promise<FeedbackRecord[]> {
    const feedback = await this.prisma.feedback.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
    });
    return feedback.map(this.mapToFeedbackRecord);
  }

  async getRecentFeedback(limit: number = 100): Promise<FeedbackRecord[]> {
    const feedback = await this.prisma.feedback.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return feedback.map(this.mapToFeedbackRecord);
  }

  private mapToFeedbackRecord(feedback: any): FeedbackRecord {
    return {
      id: feedback.id,
      readingId: feedback.readingId,
      accepted: feedback.accepted,
      sessionId: feedback.sessionId,
      context: feedback.context,
      createdAt: feedback.createdAt,
    };
  }
}
