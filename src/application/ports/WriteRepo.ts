/**
 * Input for recording user selection feedback
 */
export interface SelectionInput {
  /** ID of the reading that was selected */
  readingId: bigint;
  /** Whether the user accepted or rejected this reading */
  accepted: boolean;
  /** Optional session ID to group related selections */
  sessionId?: string;
  /** Optional context about the selection (e.g., composition context) */
  context?: Record<string, any>;
  /** Timestamp of the selection */
  timestamp?: Date;
}

/**
 * Feedback record stored in the database
 */
export interface FeedbackRecord {
  /** Unique feedback ID */
  id: bigint;
  /** ID of the reading that was selected */
  readingId: bigint;
  /** Whether the user accepted or rejected this reading */
  accepted: boolean;
  /** Session ID to group related selections */
  sessionId: string | null;
  /** Context about the selection */
  context: Record<string, any> | null;
  /** When the feedback was recorded */
  createdAt: Date;
}

/**
 * Repository interface for write operations (CQRS write side)
 * Handles user feedback and selection recording for future learning
 */
export interface WriteRepo {
  /**
   * Record a user's selection feedback
   * Used to track which readings users accept/reject for future ML training
   */
  recordSelection(input: SelectionInput): Promise<void>;

  /**
   * Get feedback records for a specific reading
   * Used for analytics and learning algorithms
   */
  getFeedbackForReading(readingId: bigint): Promise<FeedbackRecord[]>;

  /**
   * Get feedback records for a session
   * Used to analyze user behavior patterns
   */
  getFeedbackForSession(sessionId: string): Promise<FeedbackRecord[]>;

  /**
   * Get recent feedback records
   * Used for monitoring and analytics
   */
  getRecentFeedback(limit?: number): Promise<FeedbackRecord[]>;
}