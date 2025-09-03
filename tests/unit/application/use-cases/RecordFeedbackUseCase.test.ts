import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecordFeedbackUseCase, type RecordFeedbackInput } from '../../../../src/application/use-cases/RecordFeedbackUseCase.js';
import type { WriteRepo } from '../../../../src/application/ports/WriteRepo.js';
import type { ReadingRepo, ReadingDTO } from '../../../../src/application/ports/ReadingRepo.js';

// Mock implementations
const mockWriteRepo: WriteRepo = {
  recordSelection: vi.fn(),
  getFeedbackForReading: vi.fn(),
  getFeedbackForSession: vi.fn(),
  getRecentFeedback: vi.fn()
};

const mockReadingRepo: ReadingRepo = {
  searchByToneMapped: vi.fn(),
  getByIds: vi.fn(),
  getById: vi.fn(),
  countByToneMapped: vi.fn()
};

// Sample test data
const sampleReading: ReadingDTO = {
  id: 1n,
  entryId: 1n,
  surface: '債權人',
  type: 'vocab',
  lang: 'zh-HK',
  jyutping: 'zaai3 kyun4 jan4',
  toneOriginal: '341',
  toneMapped: '403',
  syllables: 3,
  freq: 0.8,
  pos: 'NOUN',
  register: 'formal',
  gloss: 'creditor',
  source: 'lexicon_v1'
};

describe('RecordFeedbackUseCase', () => {
  let recordFeedbackUseCase: RecordFeedbackUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    recordFeedbackUseCase = new RecordFeedbackUseCase(mockWriteRepo, mockReadingRepo);
  });

  describe('execute', () => {
    it('should record feedback successfully with valid input', async () => {
      // Arrange
      const input: RecordFeedbackInput = {
        readingId: 1n,
        accepted: true,
        sessionId: 'test-session-123',
        context: {
          tonePattern: '403',
          theme: 'love',
          position: 1
        }
      };

      vi.mocked(mockReadingRepo.getById).mockResolvedValue(sampleReading);

      // Act
      const result = await recordFeedbackUseCase.execute(input);

      // Assert
      expect(result.success).toBe(true);
      expect(result.sessionId).toBe('test-session-123');
      expect(result.validation.readingExists).toBe(true);
      expect(result.validation.readingSurface).toBe('債權人');
      expect(mockWriteRepo.recordSelection).toHaveBeenCalledWith({
        readingId: 1n,
        accepted: true,
        sessionId: 'test-session-123',
        context: {
          tonePattern: '403',
          theme: 'love',
          position: 1,
          recordedAt: expect.any(String)
        },
        timestamp: expect.any(Date)
      });
    });

    it('should generate session ID when not provided', async () => {
      // Arrange
      const input: RecordFeedbackInput = {
        readingId: 1n,
        accepted: false
      };

      vi.mocked(mockReadingRepo.getById).mockResolvedValue(sampleReading);

      // Act
      const result = await recordFeedbackUseCase.execute(input);

      // Assert
      expect(result.success).toBe(true);
      expect(result.sessionId).toMatch(/^session_[a-z0-9]+_[a-z0-9]+$/);
      expect(mockWriteRepo.recordSelection).toHaveBeenCalledWith({
        readingId: 1n,
        accepted: false,
        sessionId: result.sessionId,
        context: undefined,
        timestamp: expect.any(Date)
      });
    });

    it('should throw error when reading does not exist', async () => {
      // Arrange
      const input: RecordFeedbackInput = {
        readingId: 999n,
        accepted: true
      };

      vi.mocked(mockReadingRepo.getById).mockResolvedValue(null);

      // Act & Assert
      await expect(recordFeedbackUseCase.execute(input)).rejects.toThrow(
        'Reading with ID 999 not found'
      );
      expect(mockWriteRepo.recordSelection).not.toHaveBeenCalled();
    });

    it('should validate required reading ID', async () => {
      // Arrange
      const input = {
        accepted: true
      } as RecordFeedbackInput;

      // Act & Assert
      await expect(recordFeedbackUseCase.execute(input)).rejects.toThrow(
        'Reading ID is required'
      );
    });

    it('should validate accepted status is boolean', async () => {
      // Arrange
      const input = {
        readingId: 1n,
        accepted: 'yes' as any
      } as RecordFeedbackInput;

      // Act & Assert
      await expect(recordFeedbackUseCase.execute(input)).rejects.toThrow(
        'Accepted status must be a boolean'
      );
    });

    it('should validate session ID format', async () => {
      // Arrange
      const input: RecordFeedbackInput = {
        readingId: 1n,
        accepted: true,
        sessionId: 'invalid session id!' // Contains invalid characters
      };

      // Act & Assert
      await expect(recordFeedbackUseCase.execute(input)).rejects.toThrow(
        'Session ID must contain only alphanumeric characters, underscores, and hyphens'
      );
    });

    it('should validate context size limit', async () => {
      // Arrange
      const largeContext = { data: 'x'.repeat(10001) }; // Exceeds 10KB limit
      const input: RecordFeedbackInput = {
        readingId: 1n,
        accepted: true,
        context: largeContext
      };

      // Act & Assert
      await expect(recordFeedbackUseCase.execute(input)).rejects.toThrow(
        'Context data is too large (max 10KB)'
      );
    });

    it('should handle context without recordedAt timestamp', async () => {
      // Arrange
      const input: RecordFeedbackInput = {
        readingId: 1n,
        accepted: true,
        context: {
          tonePattern: '403',
          usedLlm: true
        }
      };

      vi.mocked(mockReadingRepo.getById).mockResolvedValue(sampleReading);

      // Act
      await recordFeedbackUseCase.execute(input);

      // Assert
      expect(mockWriteRepo.recordSelection).toHaveBeenCalledWith({
        readingId: 1n,
        accepted: true,
        sessionId: expect.any(String),
        context: {
          tonePattern: '403',
          usedLlm: true,
          recordedAt: expect.any(String)
        },
        timestamp: expect.any(Date)
      });
    });

    it('should measure processing time', async () => {
      // Arrange
      const input: RecordFeedbackInput = {
        readingId: 1n,
        accepted: true
      };

      vi.mocked(mockReadingRepo.getById).mockResolvedValue(sampleReading);

      // Act
      const result = await recordFeedbackUseCase.execute(input);

      // Assert
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.processingTimeMs).toBe('number');
    });
  });

  describe('executeBatch', () => {
    it('should handle empty batch', async () => {
      // Act
      const results = await recordFeedbackUseCase.executeBatch([]);

      // Assert
      expect(results).toEqual([]);
    });

    it('should process multiple feedback entries with same session ID', async () => {
      // Arrange
      const inputs: RecordFeedbackInput[] = [
        { readingId: 1n, accepted: true, sessionId: 'batch-session' },
        { readingId: 2n, accepted: false, sessionId: 'batch-session' }
      ];

      vi.mocked(mockReadingRepo.getById)
        .mockResolvedValueOnce(sampleReading)
        .mockResolvedValueOnce({ ...sampleReading, id: 2n, surface: '亡' });

      // Act
      const results = await recordFeedbackUseCase.executeBatch(inputs);

      // Assert
      expect(results).toHaveLength(2);
      expect(results[0]!.success).toBe(true);
      expect(results[0]!.sessionId).toBe('batch-session');
      expect(results[1]!.success).toBe(true);
      expect(results[1]!.sessionId).toBe('batch-session');
      expect(mockWriteRepo.recordSelection).toHaveBeenCalledTimes(2);
    });

    it('should generate shared session ID when not provided', async () => {
      // Arrange
      const inputs: RecordFeedbackInput[] = [
        { readingId: 1n, accepted: true },
        { readingId: 2n, accepted: false }
      ];

      vi.mocked(mockReadingRepo.getById)
        .mockResolvedValueOnce(sampleReading)
        .mockResolvedValueOnce({ ...sampleReading, id: 2n });

      // Act
      const results = await recordFeedbackUseCase.executeBatch(inputs);

      // Assert
      expect(results).toHaveLength(2);
      expect(results[0]!.sessionId).toMatch(/^session_[a-z0-9]+_[a-z0-9]+$/);
      expect(results[1]!.sessionId).toBe(results[0]!.sessionId);
    });

    it('should continue processing when one entry fails', async () => {
      // Arrange
      const inputs: RecordFeedbackInput[] = [
        { readingId: 1n, accepted: true },
        { readingId: 999n, accepted: false }, // This will fail
        { readingId: 2n, accepted: true }
      ];

      vi.mocked(mockReadingRepo.getById)
        .mockResolvedValueOnce(sampleReading)
        .mockResolvedValueOnce(null) // Reading not found
        .mockResolvedValueOnce({ ...sampleReading, id: 2n });

      // Act
      const results = await recordFeedbackUseCase.executeBatch(inputs);

      // Assert
      expect(results).toHaveLength(3);
      expect(results[0]!.success).toBe(true);
      expect(results[1]!.success).toBe(false);
      expect(results[2]!.success).toBe(true);
      expect(mockWriteRepo.recordSelection).toHaveBeenCalledTimes(2); // Only successful ones
    });

    it('should use individual session IDs when provided', async () => {
      // Arrange
      const inputs: RecordFeedbackInput[] = [
        { readingId: 1n, accepted: true, sessionId: 'session-1' },
        { readingId: 2n, accepted: false, sessionId: 'session-2' }
      ];

      vi.mocked(mockReadingRepo.getById)
        .mockResolvedValueOnce(sampleReading)
        .mockResolvedValueOnce({ ...sampleReading, id: 2n });

      // Act
      const results = await recordFeedbackUseCase.executeBatch(inputs);

      // Assert
      expect(results[0]!.sessionId).toBe('session-1');
      expect(results[1]!.sessionId).toBe('session-2');
    });
  });
});