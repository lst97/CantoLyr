import type { WriteRepo, SelectionInput } from '../ports/WriteRepo.js';
import type { ReadingRepo } from '../ports/ReadingRepo.js';

/**
 * Input for record feedback use case
 */
export interface RecordFeedbackInput {
  /** ID of the reading that was selected */
  readingId: bigint;
  /** Whether the user accepted or rejected this reading */
  accepted: boolean;
  /** Optional session ID to group related selections */
  sessionId?: string;
  /** Optional context about the selection */
  context?: {
    /** Tone pattern that was being composed */
    tonePattern?: string;
    /** Theme used in composition */
    theme?: string;
    /** Mood used in composition */
    mood?: string;
    /** Genre used in composition */
    genre?: string;
    /** Position in the composed line */
    position?: number;
    /** Complete composed line */
    completeLine?: string;
    /** Whether LLM was used for selection */
    usedLlm?: boolean;
    /** Additional metadata */
    [key: string]: any;
  };
}

/**
 * Output from record feedback use case
 */
export interface RecordFeedbackOutput {
  /** Whether the feedback was successfully recorded */
  success: boolean;
  /** Processing time in milliseconds */
  processingTimeMs: number;
  /** Session ID used (generated if not provided) */
  sessionId: string;
  /** Validation details */
  validation: {
    /** Whether the reading ID exists */
    readingExists: boolean;
    /** Surface text of the reading (for confirmation) */
    readingSurface?: string;
  };
}

/**
 * Use case for recording user selection feedback
 * Implements requirement 3.1-3.3 for user feedback collection
 */
export class RecordFeedbackUseCase {
  constructor(
    private readonly writeRepo: WriteRepo,
    private readonly readingRepo: ReadingRepo
  ) {}

  /**
   * Execute feedback recording with validation
   * Validates reading exists before recording feedback
   */
  async execute(input: RecordFeedbackInput): Promise<RecordFeedbackOutput> {
    const startTime = Date.now();
    
    // Validate input
    this.validateInput(input);
    
    // Verify reading exists
    const reading = await this.readingRepo.getById(input.readingId);
    if (!reading) {
      throw new Error(`Reading with ID ${input.readingId} not found`);
    }

    // Generate session ID if not provided
    const sessionId = input.sessionId ?? this.generateSessionId();

    // Prepare selection input
    const selectionInput: SelectionInput = {
      readingId: input.readingId,
      accepted: input.accepted,
      sessionId,
      timestamp: new Date(),
      ...(input.context && {
        context: {
          ...input.context,
          recordedAt: new Date().toISOString()
        }
      })
    };

    // Record the selection
    await this.writeRepo.recordSelection(selectionInput);

    return {
      success: true,
      processingTimeMs: Date.now() - startTime,
      sessionId,
      validation: {
        readingExists: true,
        readingSurface: reading.surface
      }
    };
  }

  /**
   * Validate feedback input
   */
  private validateInput(input: RecordFeedbackInput): void {
    if (!input.readingId) {
      throw new Error('Reading ID is required');
    }

    if (typeof input.accepted !== 'boolean') {
      throw new Error('Accepted status must be a boolean');
    }

    // Validate session ID format if provided
    if (input.sessionId && !/^[a-zA-Z0-9_-]+$/.test(input.sessionId)) {
      throw new Error('Session ID must contain only alphanumeric characters, underscores, and hyphens');
    }

    // Validate context if provided
    if (input.context) {
      // Ensure context is not too large (prevent abuse)
      const contextStr = JSON.stringify(input.context);
      if (contextStr.length > 10000) { // 10KB limit
        throw new Error('Context data is too large (max 10KB)');
      }
    }
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `session_${timestamp}_${random}`;
  }

  /**
   * Batch record multiple feedback entries
   * Useful for recording feedback for an entire composed line
   */
  async executeBatch(inputs: RecordFeedbackInput[]): Promise<RecordFeedbackOutput[]> {
    if (inputs.length === 0) {
      return [];
    }

    // Use the same session ID for all entries if not specified
    const batchSessionId = inputs[0]?.sessionId ?? this.generateSessionId();
    
    const results: RecordFeedbackOutput[] = [];
    
    for (const input of inputs) {
      try {
        const inputWithSession = {
          ...input,
          sessionId: input.sessionId ?? batchSessionId
        };
        
        const result = await this.execute(inputWithSession);
        results.push(result);
      } catch (error) {
        // Continue processing other entries even if one fails
        results.push({
          success: false,
          processingTimeMs: 0,
          sessionId: batchSessionId,
          validation: {
            readingExists: false
          }
        });
      }
    }

    return results;
  }
}