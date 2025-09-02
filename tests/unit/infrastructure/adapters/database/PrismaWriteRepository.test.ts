import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaWriteRepository } from '../../../../../src/infrastructure/adapters/database/PrismaWriteRepository.js';
import type { SelectionInput } from '../../../../../src/application/ports/WriteRepo.js';

// Mock Prisma Client
const mockPrisma = {
  feedback: {
    create: vi.fn(),
    findMany: vi.fn()
  }
} as unknown as PrismaClient;

describe('PrismaWriteRepository', () => {
  let repository: PrismaWriteRepository;
  let mockCreate: MockedFunction<any>;
  let mockFindMany: MockedFunction<any>;

  beforeEach(() => {
    repository = new PrismaWriteRepository(mockPrisma);
    mockCreate = mockPrisma.feedback.create as MockedFunction<any>;
    mockFindMany = mockPrisma.feedback.findMany as MockedFunction<any>;
    
    // Reset all mocks
    vi.clearAllMocks();
  });

  describe('recordSelection', () => {
    it('should record selection with all fields', async () => {
      const timestamp = new Date('2024-01-01T10:00:00Z');
      const input: SelectionInput = {
        readingId: BigInt(123),
        accepted: true,
        sessionId: 'session-456',
        context: { source: 'compose', query: '403' },
        timestamp
      };

      mockCreate.mockResolvedValue({});

      await repository.recordSelection(input);

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          readingId: BigInt(123),
          accepted: true,
          sessionId: 'session-456',
          context: { source: 'compose', query: '403' },
          createdAt: timestamp
        }
      });
    });

    it('should record selection with minimal fields', async () => {
      const input: SelectionInput = {
        readingId: BigInt(789),
        accepted: false
      };

      mockCreate.mockResolvedValue({});

      await repository.recordSelection(input);

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          readingId: BigInt(789),
          accepted: false,
          sessionId: null,
          context: null,
          createdAt: expect.any(Date)
        }
      });
    });

    it('should use current timestamp when not provided', async () => {
      const beforeCall = new Date();
      
      const input: SelectionInput = {
        readingId: BigInt(111),
        accepted: true
      };

      mockCreate.mockResolvedValue({});

      await repository.recordSelection(input);

      const afterCall = new Date();
      const callArgs = mockCreate.mock.calls[0]?.[0] as any;
      const createdAt = callArgs?.data?.createdAt;

      expect(createdAt).toBeInstanceOf(Date);
      expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      expect(createdAt.getTime()).toBeLessThanOrEqual(afterCall.getTime());
    });
  });

  describe('getFeedbackForReading', () => {
    const mockFeedbackData = [
      {
        id: BigInt(1),
        readingId: BigInt(123),
        accepted: true,
        sessionId: 'session-1',
        context: { source: 'search' },
        createdAt: new Date('2024-01-01T10:00:00Z')
      },
      {
        id: BigInt(2),
        readingId: BigInt(123),
        accepted: false,
        sessionId: 'session-2',
        context: null,
        createdAt: new Date('2024-01-01T11:00:00Z')
      }
    ];

    it('should get feedback for reading ordered by creation date desc', async () => {
      mockFindMany.mockResolvedValue(mockFeedbackData);

      const result = await repository.getFeedbackForReading(BigInt(123));

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { readingId: BigInt(123) },
        orderBy: { createdAt: 'desc' }
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: BigInt(1),
        readingId: BigInt(123),
        accepted: true,
        sessionId: 'session-1',
        context: { source: 'search' },
        createdAt: new Date('2024-01-01T10:00:00Z')
      });
    });

    it('should return empty array when no feedback found', async () => {
      mockFindMany.mockResolvedValue([]);

      const result = await repository.getFeedbackForReading(BigInt(999));

      expect(result).toEqual([]);
    });
  });

  describe('getFeedbackForSession', () => {
    const mockSessionFeedback = [
      {
        id: BigInt(10),
        readingId: BigInt(100),
        accepted: true,
        sessionId: 'session-abc',
        context: { step: 1 },
        createdAt: new Date('2024-01-01T09:00:00Z')
      },
      {
        id: BigInt(11),
        readingId: BigInt(101),
        accepted: false,
        sessionId: 'session-abc',
        context: { step: 2 },
        createdAt: new Date('2024-01-01T09:30:00Z')
      }
    ];

    it('should get feedback for session ordered by creation date asc', async () => {
      mockFindMany.mockResolvedValue(mockSessionFeedback);

      const result = await repository.getFeedbackForSession('session-abc');

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { sessionId: 'session-abc' },
        orderBy: { createdAt: 'asc' }
      });

      expect(result).toHaveLength(2);
      expect(result[0]?.context).toEqual({ step: 1 });
      expect(result[1]?.context).toEqual({ step: 2 });
    });
  });

  describe('getRecentFeedback', () => {
    const mockRecentFeedback = [
      {
        id: BigInt(20),
        readingId: BigInt(200),
        accepted: true,
        sessionId: 'recent-1',
        context: null,
        createdAt: new Date('2024-01-01T12:00:00Z')
      }
    ];

    it('should get recent feedback with default limit', async () => {
      mockFindMany.mockResolvedValue(mockRecentFeedback);

      const result = await repository.getRecentFeedback();

      expect(mockFindMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        take: 100
      });

      expect(result).toHaveLength(1);
    });

    it('should get recent feedback with custom limit', async () => {
      mockFindMany.mockResolvedValue(mockRecentFeedback);

      const result = await repository.getRecentFeedback(25);

      expect(mockFindMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        take: 25
      });

      expect(result).toHaveLength(1);
    });
  });
});