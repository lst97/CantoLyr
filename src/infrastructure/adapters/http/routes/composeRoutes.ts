import type { FastifyInstance } from 'fastify';
import type { Container } from '../../../container/Container.js';
import type { ComposeLineInput } from '../../../../application/use-cases/ComposeLineUseCase.js';
import { ComposeRequestSchema, ComposeResponseSchema, ErrorResponseSchema } from '../schemas/index.js';

/**
 * Setup compose routes
 * Implements requirements 2.1-2.6 and 8.5 for LLM-enhanced composition
 */
export async function setupComposeRoutes(app: FastifyInstance, container: Container): Promise<void> {
  
  // POST /compose/line - Compose a lyrical line with LLM enhancement
  app.post('/compose/line', {
    schema: {
      tags: ['compose'],
      summary: 'Compose a lyrical line with LLM enhancement',
      description: 'Generate contextually relevant word suggestions for a tone pattern using heuristic prefiltering and optional LLM ranking',
      body: {
        type: 'object',
        properties: {
          tonePattern: {
            type: 'string',
            description: 'Space-separated tone pattern groups (digits 0,3,9,4,5,2)'
          },
          maxPerGroup: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'Maximum candidates per tone group'
          },
          theme: {
            type: 'string',
            description: 'Optional theme for creative selection'
          },
          mood: {
            type: 'string',
            description: 'Optional mood for creative selection'
          },
          genre: {
            type: 'string',
            description: 'Optional genre for creative selection'
          },
          language: {
            type: 'string',
            description: 'Language specification'
          },
          seed: {
            type: 'number',
            description: 'Optional seed for reproducible randomness'
          }
        },
        required: ['tonePattern']
      },
      response: {
        200: ComposeResponseSchema,
        400: ErrorResponseSchema,
        500: ErrorResponseSchema,
        503: ErrorResponseSchema
      }
    }
  }, async (request, reply) => {
    try {
      // Validate request body
      const validatedBody = ComposeRequestSchema.parse(request.body);
      
      // Get compose use case from container
      const composeUseCase = container.getComposeLineUseCase();
      
      // Map request to compose input
      const composeInput: ComposeLineInput = {
        tonePattern: validatedBody.tonePattern,
      };
      if (validatedBody.maxPerGroup !== undefined)
        composeInput.maxPerGroup = validatedBody.maxPerGroup;
      if (validatedBody.theme !== undefined) composeInput.theme = validatedBody.theme;
      if (validatedBody.mood !== undefined) composeInput.mood = validatedBody.mood;
      if (validatedBody.genre !== undefined) composeInput.genre = validatedBody.genre;
      if (validatedBody.language !== undefined)
        composeInput.language = validatedBody.language;
      if (validatedBody.seed !== undefined) composeInput.seed = validatedBody.seed;
      
      // Execute composition
      const result = await composeUseCase.execute(composeInput);
      
      // Transform result for API response
      const response = {
        line: result.line,
        selections: result.selections.map(sel => ({
          ...sel,
          readingId: sel.readingId.toString() // Convert BigInt to string for JSON
        })),
        reason: result.reason,
        usedLlm: result.usedLlm,
        processingTimeMs: result.processingTimeMs,
        totalCandidates: result.totalCandidates,
        filteredCandidates: result.filteredCandidates
      };
      
      request.log.info(
        {
          tonePattern: validatedBody.tonePattern,
          theme: validatedBody.theme,
          mood: validatedBody.mood,
          genre: validatedBody.genre,
          maxPerGroup: validatedBody.maxPerGroup,
          usedLlm: result.usedLlm,
          totalCandidates: result.totalCandidates,
          filteredCandidates: result.filteredCandidates,
          processingTimeMs: result.processingTimeMs,
          composedLine: result.line
        },
        'Composition completed successfully'
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
        'Compose request failed'
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
      
      // Handle validation errors
      if (error instanceof Error && error.message.includes('Invalid tone pattern')) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_TONE_PATTERN',
            message: error.message,
            requestId: request.id,
            details: { body: request.body }
          }
        });
      }
      
      // Handle LLM service errors
      if (error instanceof Error && error.message.includes('LLM')) {
        return reply.status(503).send({
          error: {
            code: 'LLM_SERVICE_ERROR',
            message: 'LLM service temporarily unavailable, using fallback ranking',
            requestId: request.id
          }
        });
      }
      
      // Handle other known errors
      if (error instanceof Error) {
        const statusCode = error.message.includes('validation') ? 400 : 500;
        return reply.status(statusCode).send({
          error: {
            code: statusCode === 400 ? 'VALIDATION_ERROR' : 'COMPOSE_ERROR',
            message: error.message,
            requestId: request.id
          }
        });
      }
      
      // Handle unknown errors
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred during composition',
          requestId: request.id
        }
      });
    }
  });
  
  app.log.info('Compose routes configured');
}