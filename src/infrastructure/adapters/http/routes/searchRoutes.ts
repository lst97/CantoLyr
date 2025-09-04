import type { FastifyInstance } from "fastify";
import type { Container } from "../../../container/Container.js";
import type { SearchInput } from "../../../../application/use-cases/SearchUseCase.js";
import {
  SearchQuerySchema,
  SearchResponseSchema,
  ErrorResponseSchema,
} from "../schemas/index.js";


/**
 * Setup search routes
 * Implements requirements 1.1-1.6 for tone-based search functionality
 */
export async function setupSearchRoutes(
  app: FastifyInstance,
  container: Container
): Promise<void> {
  // GET /search - Search for characters/words by tone pattern
  app.get(
    "/search",
    {
      schema: {
        tags: ["search"],
        summary: "Search characters and words by tone pattern",
        description:
          "Search for Cantonese characters and words using mapped tone patterns with optional filtering and pagination",
        querystring: {
          type: "object",
          properties: {
            v: {
              type: "string",
              description:
                "Mapped tone pattern to search for (digits 0,3,9,4,5,2)",
            },
            mode: {
              type: "string",
              enum: ["all", "vocab", "char"],
              description: "Filter by entry type",
            },
            prefix: {
              type: "boolean",
              description: "Whether to treat the pattern as a prefix",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 1000,
              description: "Maximum number of results to return",
            },
          },
          required: ["v"],
        },
        response: {
          200: SearchResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        // Validate query parameters
        const validatedQuery = SearchQuerySchema.parse(request.query);

        // Get search use case from container
        const searchUseCase = container.getSearchUseCase();

        // Map query parameters to search input
        const searchInput: SearchInput = {
          tonePattern: validatedQuery.v,
        };
        if (validatedQuery.prefix !== undefined) {
          searchInput.isPrefix = validatedQuery.prefix;
        }
        if (validatedQuery.limit !== undefined) {
          searchInput.limit = validatedQuery.limit;
        }
        if (validatedQuery.mode !== undefined && validatedQuery.mode !== "all") {
          searchInput.entryType = validatedQuery.mode;
        }

        // Execute search
        const result = await searchUseCase.execute(searchInput);

        // Transform result for API response
        const response = {
          query: result.query,
          count: result.count,
          items: result.items.map((item) => ({
            ...item,
            id: item.id.toString(), // Convert BigInt to string for JSON
          })),
          fromCache: result.fromCache,
          processingTimeMs: result.processingTimeMs,
        };

        request.log.info(
          {
            query: validatedQuery.v,
            mode: validatedQuery.mode,
            prefix: validatedQuery.prefix,
            limit: validatedQuery.limit,
            resultCount: result.count,
            fromCache: result.fromCache,
            processingTimeMs: result.processingTimeMs,
          },
          "Search completed successfully"
        );

        return reply.send(response);
      } catch (error) {
        request.log.error(
          {
            error: {
              message: error instanceof Error ? error.message : "Unknown error",
              stack: error instanceof Error ? error.stack : undefined,
            },
            query: request.query,
          },
          "Search request failed"
        );

        // Handle Zod validation errors
        if (error && typeof error === "object" && "issues" in error) {
          return reply.status(400).send({
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid request parameters",
              requestId: request.id,
              details: { issues: error.issues },
            },
          });
        }

        // Handle validation errors
        if (
          error instanceof Error &&
          error.message.includes("Invalid tone pattern")
        ) {
          return reply.status(400).send({
            error: {
              code: "INVALID_TONE_PATTERN",
              message: error.message,
              requestId: request.id,
              details: { query: request.query },
            },
          });
        }

        // Handle other known errors
        if (error instanceof Error) {
          const statusCode = error.message.includes("validation") ? 400 : 500;
          return reply.status(statusCode).send({
            error: {
              code: statusCode === 400 ? "VALIDATION_ERROR" : "SEARCH_ERROR",
              message: error.message,
              requestId: request.id,
            },
          });
        }

        // Handle unknown errors
        return reply.status(500).send({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "An unexpected error occurred during search",
            requestId: request.id,
          },
        });
      }
    }
  );

  app.log.info("Search routes configured");
}
