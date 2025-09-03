import type { FastifyInstance } from 'fastify';
import type { Container } from '../../../container/Container.js';
import type { RecordFeedbackInput } from '../../../../application/use-cases/RecordFeedbackUseCase.js';
import { FeedbackRequestSchema, FeedbackResponseSchema, ErrorResponseSchema } from '../schemas/index.js';

/**
 * Setup feedback routes
 * Implements requirements 3.1-3.4 for user feedback collection
 */
export async function setupFeedbackRoutes(app: FastifyInstance, container: Container): Promise<void> {
  
  // POST /feedback/select - Record user selection feedback
  app.post('/feedback/select', {
    schema: {
      tags: ['feedback'],
      summary: 'Record user selection feedback',
      description: 'Record whether a user accepted or rejected a specific reading selection for learning purposes',
      body: {
        type: 'object',
        properties: {
          readingId: {
            type: 'string',
            description: 'ID of the reading that was selected'
          },
          accepted: {
            type: 'boolean',
            description: 'Whether the user accepted or rejected this reading'
          },
          sessionId: {
            type: 'string',
            pattern: '^[a-zA-Z0-9_-]+$',
            description: 'Optional session ID to group related selections'
          },
          context: {
            type: 'object',
            properties: {
              tonePattern: {
                type: 'string',
                description: 'Tone pattern that was being composed'
              },
              theme: {
                type: 'string',
                description: 'Theme used in composition'
              },
              mood: {
                type: 'string',
                description: 'Mood used in composition'
              },
              genre: {
                type: 'string',
                description: 'Genre used in composition'
              },
              position: {
                type: 'integer',
                minimum: 0,
                description: 'Position in the composed line'
              },
              completeLine: {
                type: 'string',
                description: 'Complete composed line'
              },
              usedLlm: {
                type: 'boolean',
                description: 'Whether LLM was used for selection'
              }
            },
            description: 'Optional context about the selection'
          }
        },
        required: ['readingId', 'accepted']
      },
      response: {
        200: FeedbackResponseSchema,
        400: ErrorResponseSchema,
        404: ErrorResponseSchema,
        500: ErrorResponseSchema
      }
    }
  }, async (request, reply) => {
    try {
      // Validate request body
      const validatedBody = FeedbackRequestSchema.parse(request.body);
      
      // Get feedback use case from container
      const recordFeedbackUseCase = container.getRecordFeedbackUseCase();
      
      // Map request to feedback input
      const feedbackInput: RecordFeedbackInput = {
        readingId: validatedBody.readingId,
        accepted: validatedBody.accepted
      };

      if (validatedBody.sessionId !== undefined) {
        feedbackInput.sessionId = validatedBody.sessionId;
      }

      if (validatedBody.context !== undefined) {
        const context: { [key: string]: any } = {};
        for (const [key, value] of Object.entries(validatedBody.context)) {
          if (value !== undefined) {
            context[key] = value;
          }
        }
        feedbackInput.context = context;
      }
      
      // Execute feedback recording
      const result = await recordFeedbackUseCase.execute(feedbackInput);
      
      // Transform result for API response
      const response = {
        success: result.success,
        processingTimeMs: result.processingTimeMs,
        sessionId: result.sessionId,
        validation: {
          readingExists: result.validation.readingExists,
          readingSurface: result.validation.readingSurface
        }
      };
      
      request.log.info(
        {
          readingId: validatedBody.readingId.toString(),
          accepted: validatedBody.accepted,
          sessionId: result.sessionId,
          readingSurface: result.validation.readingSurface,
          processingTimeMs: result.processingTimeMs,
          hasContext: !!validatedBody.context
        },
        'Feedback recorded successfully'
      );
      
      return reply.send(response);
      
    } catch (error) {
      request.log.error(
        {
          error: {
            message: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
          },
          body: request.body
        },
        'Feedback request failed'
      );
      
      // Handle Zod validation errors
      if (error && typeof error === 'object' && 'issues' in error) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request parameters',
            requestId: request.id,
            details: { issues: error.issues }
          }
        });
      }
      
      // Handle reading not found errors
      if (error instanceof Error && error.message.includes('not found')) {
        return reply.status(404).send({
          error: {
            code: 'READING_NOT_FOUND',
            message: error.message,
            requestId: request.id,
            details: { body: request.body }
          }
        });
      }
      
      // Handle validation errors
      if (error instanceof Error && (
        error.message.includes('validation') ||
        error.message.includes('Invalid reading ID') ||
        error.message.includes('Session ID must contain')
      )) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: error.message,
            requestId: request.id,
            details: { body: request.body }
          }
        });
      }
      
      // Handle context size errors
      if (error instanceof Error && error.message.includes('Context data is too large')) {
        return reply.status(400).send({
          error: {
            code: 'CONTEXT_TOO_LARGE',
            message: error.message,
            requestId: request.id
          }
        });
      }
      
      // Handle other known errors
      if (error instanceof Error) {
        return reply.status(500).send({
          error: {
            code: 'FEEDBACK_ERROR',
            message: error.message,
            requestId: request.id
          }
        });
      }
      
      // Handle unknown errors
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred while recording feedback',
          requestId: request.id
        }
      });
    }
  });
  
  app.log.info('Feedback routes configured');
}