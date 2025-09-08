import type {
	LlmGroupedSelector,
	GroupedSelectionInput,
	GroupedSelectionResult,
	LlmConfig,
	GroupSelection,
} from "../../../application/ports/LlmGroupedSelector.js";
import { GoogleGenAI } from "@google/genai";
import Ajv, { ValidateFunction } from "ajv";
import { buildMvpGroupedSelectionPrompt } from "./prompts/mvpGroupedSelectionPrompt.js";

/**
 * Expected JSON structure from Gemini for grouped selection
 */
const groupedSelectionResponseSchema = {
	type: "object",
	properties: {
		selections: {
			type: "array",
			items: {
				type: "object",
				properties: {
					group: { type: "number" },
					option: { type: "number" },
				},
				required: ["group", "option"],
			},
		},
		line: { type: "string" },
		reason: { type: "string" },
	},
	required: ["selections", "line"],
};

/**
 * Google Gemini API implementation of LlmGroupedSelector using the official Google Gen AI SDK
 * Provides intelligent grouped selection of Cantonese words based on creative context
 */
export class GeminiLlmGroupedSelector implements LlmGroupedSelector {
	private readonly ajv: Ajv;
	private readonly validateGroupedSelectionResponse: ValidateFunction;
	private readonly genAI: GoogleGenAI;

	constructor(private readonly config: LlmConfig) {
		this.ajv = new Ajv();
		this.validateGroupedSelectionResponse = this.ajv.compile(
			groupedSelectionResponseSchema
		);
		this.genAI = new GoogleGenAI({ apiKey: config.apiKey! });
	}

	async selectFromGroups(
		input: GroupedSelectionInput
	): Promise<GroupedSelectionResult> {
		const startTime = Date.now();

		try {
			await this.validateConfig();

			const promptOptions = Object.fromEntries(
				Object.entries({
					theme: input.theme,
					mood: input.mood,
					genre: input.genre,
					language: input.language,
				}).filter(([_, value]) => value !== undefined)
			);

			const prompt = buildMvpGroupedSelectionPrompt(
				input.groups,
				promptOptions
			);

			const response = (await this.generateContent(prompt)) as any;

			const text = this.extractText(response);
			if (!text) {
				throw new Error("No text content in Gemini response");
			}

			const result = this.parseGroupedSelection(text, input.groups);
			const processingTimeMs = Date.now() - startTime;

			return {
				...result,
				success: true,
				model: this.config.model || "gemini-2.5-flash",
				processingTimeMs,
			};
		} catch (error) {
			const processingTimeMs = Date.now() - startTime;
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";

			return {
				selections: [],
				line: "",
				success: false,
				error: errorMessage,
				model: this.config.model || "gemini-2.5-flash",
				processingTimeMs,
			};
		}
	}

	async isAvailable(): Promise<boolean> {
		try {
			await this.validateConfig();
			return true;
		} catch {
			return false;
		}
	}

	getInfo() {
		return {
			provider: "Google Gemini",
			model: this.config.model || "gemini-2.5-flash",
			version: "2.0",
		};
	}

	async validateConfig(): Promise<void> {
		if (!this.config.apiKey) {
			throw new Error("Gemini API key is required");
		}

		if (this.config.timeoutMs && this.config.timeoutMs <= 0) {
			throw new Error("Timeout must be positive");
		}

		if (this.config.maxRetries && this.config.maxRetries < 0) {
			throw new Error("Max retries cannot be negative");
		}
	}

	private async generateContent(prompt: string) {
		const model = this.config.model || "gemini-2.5-flash";

		// Create a timeout promise if timeout is configured
		const timeoutMs = this.config.timeoutMs || 600000;
		const timeoutPromise = new Promise((_, reject) => {
			setTimeout(() => {
				reject(new Error(`Gemini API request timed out after ${timeoutMs}ms`));
			}, timeoutMs);
		});

		// Create the generation promise
		const generationPromise = this.genAI.models.generateContent({
			model,
			contents: prompt,
			config: {
				temperature: 0.3,
				topK: 40,
				topP: 0.95,
				maxOutputTokens: 20480,
				responseModalities: ["TEXT"],
				// Ask SDK to treat output as JSON and help enforce structure
				responseMimeType: "application/json",
				responseJsonSchema: groupedSelectionResponseSchema,
			},
		});

		// Race between generation and timeout
		return Promise.race([generationPromise, timeoutPromise]);
	}

	/**
	 * Extract plain text from various possible Google GenAI SDK response shapes.
	 * Supports both mocked `.text` property and real SDK `.response.text()` forms.
	 */
	private extractText(response: any): string | undefined {
		console.log("Gemini response:", response);
		try {
			if (!response) return undefined;
			// Unit test mock shape: { text: string }
			if (
				typeof response.text === "string" &&
				response.text.trim().length > 0
			) {
				return response.text as string;
			}

			// Some SDKs expose combined inline data (e.g., JSON) via data accessor
			if (
				typeof response.data === "string" &&
				response.data.trim().length > 0
			) {
				return response.data as string;
			}

			// Official SDK result shape often: { response: { text(): string, candidates: [...] } }
			const maybeResp = response.response ?? response;
			if (maybeResp && typeof maybeResp.text === "function") {
				const t = maybeResp.text();
				if (typeof t === "string" && t.trim().length > 0) return t;
			}

			if (
				typeof maybeResp?.data === "string" &&
				maybeResp.data.trim().length > 0
			) {
				return maybeResp.data as string;
			}

			// Fall back to digging into candidates/parts
			const candidates = maybeResp?.candidates ?? response?.candidates;
			if (Array.isArray(candidates) && candidates.length > 0) {
				for (const c of candidates) {
					const contentItems = c?.content
						? Array.isArray(c.content)
							? c.content
							: [c.content]
						: [];

					for (const content of contentItems) {
						const parts = content?.parts ?? c?.parts ?? [];
						if (Array.isArray(parts) && parts.length) {
							// Prefer explicit text parts
							for (const p of parts) {
								if (typeof p?.text === "string" && p.text.trim().length > 0) {
									return p.text as string;
								}
							}
							// Try inlineData/base64 JSON parts
							for (const p of parts) {
								const inline = p?.inlineData ?? p?.inline_data;
								const b64 = inline?.data ?? inline?.bytes ?? inline?.b64;
								if (typeof b64 === "string" && b64.length > 0) {
									try {
										const decoded = Buffer.from(b64, "base64").toString("utf8");
										if (decoded.trim().length > 0) return decoded;
									} catch {}
								}
							}
						}
					}
					// Some candidates might expose text directly
					if (
						typeof c?.content?.text === "string" &&
						c.content.text.trim().length > 0
					) {
						return c.content.text as string;
					}
					if (typeof c?.text === "string" && c.text.trim().length > 0) {
						return c.text as string;
					}
				}
			}

			// Some SDKs expose `output_text`
			if (
				typeof maybeResp?.output_text === "string" &&
				maybeResp.output_text.trim().length > 0
			) {
				return maybeResp.output_text as string;
			}

			return undefined;
		} catch {
			return undefined;
		}
	}

	private parseGroupedSelection(
		textContent: string,
		groups: any[]
	): { selections: GroupSelection[]; line: string; reason?: string } {
		try {
			// Try to extract JSON from the response
			const jsonMatch = textContent.match(/\{[\s\S]*\}/);
			if (!jsonMatch) {
				throw new Error("No JSON found in Gemini response");
			}

			const parsed: unknown = JSON.parse(jsonMatch[0]);

			if (!this.validateGroupedSelectionResponse(parsed)) {
				throw new Error(
					`Invalid grouped selection response format: ${this.ajv.errorsText(
						this.validateGroupedSelectionResponse.errors
					)}`
				);
			}

			// Type assertion is safe here because we've validated the structure above
			const validatedParsed = parsed as {
				selections: Array<{ group: number; option: number }>;
				line: string;
				reason?: string;
			};

			// Validate selections against available groups and options
			const validatedSelections: GroupSelection[] = [];

			for (const selection of validatedParsed.selections) {
				const groupIndex = selection.group - 1; // Convert to 0-based
				const optionIndex = selection.option - 1; // Convert to 0-based

				if (groupIndex < 0 || groupIndex >= groups.length) {
					throw new Error(`Invalid group number: ${selection.group}`);
				}

				const group = groups[groupIndex];
				if (!group || optionIndex < 0 || optionIndex >= group.options.length) {
					throw new Error(
						`Invalid option number: ${selection.option} for group ${selection.group}`
					);
				}

				const option = group.options[optionIndex];
				validatedSelections.push({
					group: selection.group,
					option: selection.option,
					surface: option.surface,
					readingId: option.readingId,
				});
			}

			// Verify we have selections for all groups
			if (validatedSelections.length !== groups.length) {
				throw new Error(
					`Expected ${groups.length} selections, got ${validatedSelections.length}`
				);
			}

			const result: {
				selections: GroupSelection[];
				line: string;
				reason?: string;
			} = {
				selections: validatedSelections,
				line: validatedParsed.line,
			};

			if (validatedParsed.reason) {
				result.reason = validatedParsed.reason;
			}

			return result;
		} catch (error) {
			throw new Error(
				`Failed to parse Gemini grouped selection: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	}
}
