import type { AppConfig } from "../../config/AppConfig.js";
import {
	ErrorResponseSchema,
	ReadingDTOSchema,
	SearchResponseSchema,
	ComposeResponseSchema,
	FeedbackResponseSchema,
} from "./schemas/index.js";

/**
 * Build a static OpenAPI 3.0.0 document for ReDoc.
 * We keep this minimal and focused on current endpoints.
 */
export function buildOpenApiDocument(config: AppConfig) {
	const serverUrl = `http://${config.server.host}:${config.server.port}`;

	return {
		openapi: "3.0.0",
		info: {
			title: "CantoLyr API",
			description: "Cantonese lyrics composition assistant API",
			version: "1.0.0",
			contact: {
				name: "CantoLyr API Support",
				email: "contact@lst97.dev",
			},
			license: {
				name: "MIT",
				url: "https://opensource.org/licenses/MIT",
			},
		},
		servers: [{ url: serverUrl, description: "Application server" }],
		tags: [
			{ name: "health", description: "Health check endpoints" },
			{ name: "search", description: "Character and word search endpoints" },
			{ name: "compose", description: "Lyrical composition endpoints" },
			{ name: "feedback", description: "User feedback endpoints" },
		],
		components: {
			schemas: {
				Error: ErrorResponseSchema,
				ReadingDTO: ReadingDTOSchema,
				SearchResponse: SearchResponseSchema,
				ComposeResponse: ComposeResponseSchema,
				FeedbackResponse: FeedbackResponseSchema,
				// Request body schemas used below
				ComposeRequest: {
					type: "object",
					properties: {
						tonePattern: {
							type: "string",
							description:
								"Space-separated tone pattern using mapped digits (0,3,9,4,5,2)",
						},
						maxPerGroup: { type: "integer", minimum: 1, maximum: 100 },
						theme: { type: "string" },
						mood: { type: "string" },
						genre: { type: "string" },
						language: { type: "string" },
						seed: { type: "number" },
					},
					required: ["tonePattern"],
				},
				FeedbackRequest: {
					type: "object",
					properties: {
						readingId: {
							type: "string",
							description: "ID of the reading that was selected",
						},
						accepted: { type: "boolean" },
						sessionId: { type: "string", pattern: "^[a-zA-Z0-9_-]+$" },
						context: {
							type: "object",
							properties: {
								tonePattern: { type: "string" },
								theme: { type: "string" },
								mood: { type: "string" },
								genre: { type: "string" },
								position: { type: "integer", minimum: 0 },
								completeLine: { type: "string" },
								usedLlm: { type: "boolean" },
							},
						},
					},
					required: ["readingId", "accepted"],
				},
			},
		},
		paths: {
			"/": {
				get: {
					tags: ["health"],
					summary: "API root endpoint",
					description: "Returns basic API information",
					responses: {
						"200": {
							description: "OK",
							content: {
								"application/json": {
									schema: {
										type: "object",
										properties: {
											name: { type: "string" },
											version: { type: "string" },
											description: { type: "string" },
											documentation: { type: "string" },
											requestId: { type: "string" },
										},
										required: [
											"name",
											"version",
											"description",
											"documentation",
											"requestId",
										],
									},
								},
							},
						},
					},
				},
			},
			"/health": {
				get: {
					tags: ["health"],
					summary: "Health check endpoint",
					description:
						"Returns the health status of the API and its dependencies",
					responses: {
						"200": {
							description: "Service healthy",
							content: {
								"application/json": {
									schema: {
										type: "object",
										properties: {
											status: {
												type: "string",
												enum: ["healthy", "unhealthy"],
											},
											timestamp: { type: "string", format: "date-time" },
											version: { type: "string" },
											services: {
												type: "object",
												properties: {
													database: { type: "boolean" },
													cache: { type: "boolean" },
													llm: { type: "boolean" },
												},
												required: ["database", "cache", "llm"],
											},
											requestId: { type: "string" },
										},
										required: [
											"status",
											"timestamp",
											"version",
											"services",
											"requestId",
										],
									},
								},
							},
						},
						"503": {
							description: "Service unhealthy",
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/Error" },
								},
							},
						},
					},
				},
			},
			"/search/pronunciation": {
				get: {
					tags: ["search"],
					summary: "Search by pronunciation (mapped tone pattern)",
					description:
						"Search using the new pronunciation field (mapped tone digits)",
					parameters: [
						{
							name: "p",
							in: "query",
							required: true,
							schema: { type: "string" },
							description: "Pronunciation (mapped tone digits)",
						},
						{
							name: "mode",
							in: "query",
							required: false,
							schema: { type: "string", enum: ["all", "vocab", "char"] },
							description: "Filter by entry type",
						},
						{
							name: "prefix",
							in: "query",
							required: false,
							schema: { type: "boolean" },
							description: "Treat pattern as prefix",
						},
						{
							name: "limit",
							in: "query",
							required: false,
							schema: { type: "integer", minimum: 1, maximum: 1000 },
							description: "Max results",
						},
					],
					responses: {
						"200": {
							description: "OK",
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/SearchResponse" },
								},
							},
						},
						"400": {
							description: "Bad Request",
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/Error" },
								},
							},
						},
						"500": {
							description: "Server Error",
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/Error" },
								},
							},
						},
					},
				},
			},
			"/search/rhyme": {
				get: {
					tags: ["search"],
					summary: "Search by rhyme token",
					description:
						"Find readings containing a given rhyme in their decomposition",
					parameters: [
						{
							name: "rhyme",
							in: "query",
							required: true,
							schema: { type: "string" },
							description: "Rhyme token (final)",
						},
						{
							name: "mode",
							in: "query",
							required: false,
							schema: { type: "string", enum: ["all", "vocab", "char"] },
							description: "Filter by entry type",
						},
						{
							name: "limit",
							in: "query",
							required: false,
							schema: { type: "integer", minimum: 1, maximum: 1000 },
							description: "Max results",
						},
					],
					responses: {
						"200": {
							description: "OK",
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/SearchResponse" },
								},
							},
						},
						"400": {
							description: "Bad Request",
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/Error" },
								},
							},
						},
						"500": {
							description: "Server Error",
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/Error" },
								},
							},
						},
					},
				},
			},
			"/compose/line": {
				post: {
					tags: ["compose"],
					summary: "Compose a lyrical line with LLM enhancement",
					description:
						"Generate word suggestions for a tone pattern using heuristic prefiltering and optional LLM ranking",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/ComposeRequest" },
							},
						},
					},
					responses: {
						"200": {
							description: "OK",
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/ComposeResponse" },
								},
							},
						},
						"400": {
							description: "Bad Request",
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/Error" },
								},
							},
						},
						"500": {
							description: "Server Error",
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/Error" },
								},
							},
						},
						"503": {
							description: "Service Unavailable",
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/Error" },
								},
							},
						},
					},
				},
			},
			"/feedback/select": {
				post: {
					tags: ["feedback"],
					summary: "Record user selection feedback",
					description:
						"Record whether a user accepted or rejected a specific reading selection for learning purposes",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/FeedbackRequest" },
							},
						},
					},
					responses: {
						"200": {
							description: "OK",
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/FeedbackResponse" },
								},
							},
						},
						"400": {
							description: "Bad Request",
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/Error" },
								},
							},
						},
						"404": {
							description: "Not Found",
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/Error" },
								},
							},
						},
						"500": {
							description: "Server Error",
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/Error" },
								},
							},
						},
					},
				},
			},
		},
	} as const;
}
