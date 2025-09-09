import { PrismaClient } from "../../../../prisma/generated/client.ts";
import type {
  FeedbackRecord,
  SelectionInput,
  WriteRepo,
} from "../../../application/ports/WriteRepo.ts";

/**
 * Prisma implementation of WriteRepo for feedback recording operations
 * Implements CQRS write side for user selection tracking and learning
 */
export class PrismaWriteRepository implements WriteRepo {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Record a user's selection feedback
   * Used to track which readings users accept/reject for future ML training
   */
  async recordSelection(input: SelectionInput): Promise<void> {
    const {
      readingId,
      accepted,
      sessionId,
      context,
      timestamp = new Date(),
    } = input;

    await this.prisma.feedback.create({
      data: {
        readingId,
        accepted,
        sessionId: sessionId || null,
        // When context is undefined, omit the field
        ...(context !== undefined ? { context } : {}),
        createdAt: timestamp,
      },
    });
  }

  /**
   * Get feedback records for a specific reading
   * Used for analytics and learning algorithms
   */
  async getFeedbackForReading(readingId: bigint): Promise<FeedbackRecord[]> {
    const feedback = await this.prisma.feedback.findMany({
      where: { readingId },
      orderBy: { createdAt: "desc" },
    });

    return feedback.map(this.mapToFeedbackRecord);
  }

  /**
   * Get feedback records for a session
   * Used to analyze user behavior patterns
   */
  async getFeedbackForSession(sessionId: string): Promise<FeedbackRecord[]> {
    const feedback = await this.prisma.feedback.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" }, // Chronological order for session analysis
    });

    return feedback.map(this.mapToFeedbackRecord);
  }

  /**
   * Get recent feedback records
   * Used for monitoring and analytics
   */
  async getRecentFeedback(limit: number = 100): Promise<FeedbackRecord[]> {
    const feedback = await this.prisma.feedback.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return feedback.map(this.mapToFeedbackRecord);
  }

  /**
   * Maps Prisma feedback result to FeedbackRecord
   */
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
