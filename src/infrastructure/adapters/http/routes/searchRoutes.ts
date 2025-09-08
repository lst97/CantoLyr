import type { FastifyInstance } from "fastify";
import type { Container } from "../../../container/Container.js";
import {
	SearchPronunciationQuerySchema,
	SearchRhymeQuerySchema,
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
	app.log.info("Search routes configured (pronunciation + rhyme)");

	// GET /search/pronunciation - Search using new 'pronunciation' (mapped tone) naming
	app.get(
		"/search/pronunciation",
		{
			schema: {
				tags: ["search"],
				summary: "Search by pronunciation (mapped tone pattern)",
				description:
					"Search using the new pronunciation field (mapped tone digits)",
				querystring: {
					type: "object",
					properties: {
						p: {
							type: "string",
							description: "Pronunciation (mapped tone digits)",
						},
						mode: {
							type: "string",
							enum: ["all", "vocab", "char"],
							description: "Filter by entry type",
						},
						prefix: { type: "boolean", description: "Treat pattern as prefix" },
						limit: {
							type: "integer",
							minimum: 1,
							maximum: 1000,
							description: "Max results",
						},
					},
					required: ["p"],
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
				const q = SearchPronunciationQuerySchema.parse(request.query);
				const repo = container.readingRepo;
				const entryType = q.mode && q.mode !== "all" ? q.mode : undefined;
				const args: { pronunciation: string; offset: number; isPrefix?: boolean; entryType?: any; limit?: number } = {
					pronunciation: q.p,
					offset: 0,
				};
				if (typeof q.prefix === "boolean") args.isPrefix = q.prefix;
				if (entryType) args.entryType = entryType;
				if (typeof q.limit === "number") args.limit = q.limit;
				const results = await repo.searchByPronunciation(args);
				const response = {
					query: q.p,
					count: results.length,
					items: results.map((item) => ({ ...item, id: item.id.toString() })),
					fromCache: false,
					processingTimeMs: 0,
				};
				return reply.send(response);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Unknown error";
				return reply.status(400).send({
					error: { code: "INVALID_REQUEST", message, requestId: request.id },
				});
			}
		}
	);

	// GET /search/rhyme - Search readings that contain a specific rhyme token
	app.get(
		"/search/rhyme",
		{
			schema: {
				tags: ["search"],
				summary: "Search by rhyme token",
				description:
					"Find readings containing a given rhyme in their decomposition",
				querystring: {
					type: "object",
					properties: {
						rhyme: { type: "string", description: "Rhyme token (final)" },
						mode: {
							type: "string",
							enum: ["all", "vocab", "char"],
							description: "Filter by entry type",
						},
						limit: {
							type: "integer",
							minimum: 1,
							maximum: 1000,
							description: "Max results",
						},
					},
					required: ["rhyme"],
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
				const q = SearchRhymeQuerySchema.parse(request.query);
				const repo = container.readingRepo;
				const entryType = q.mode && q.mode !== "all" ? q.mode : undefined;
				const args2: { rhyme: string; offset: number; entryType?: any; limit?: number } = {
					rhyme: q.rhyme,
					offset: 0,
				};
				if (entryType) args2.entryType = entryType;
				if (typeof q.limit === "number") args2.limit = q.limit;
				const results = await repo.searchByRhyme(args2);
				const response = {
					query: q.rhyme,
					count: results.length,
					items: results.map((item) => ({ ...item, id: item.id.toString() })),
					fromCache: false,
					processingTimeMs: 0,
				};
				return reply.send(response);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Unknown error";
				return reply.status(400).send({
					error: { code: "INVALID_REQUEST", message, requestId: request.id },
				});
			}
		}
	);
}
