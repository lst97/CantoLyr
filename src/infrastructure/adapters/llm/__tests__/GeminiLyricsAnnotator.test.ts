import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GeminiLyricsAnnotator } from "../GeminiLyricsAnnotator.js";
import type { LyricsAnnotatorInput } from "../../../../application/ports/LyricsAnnotator.js";

// Mock the Google GenAI SDK
vi.mock("@google/genai", () => ({
	GoogleGenAI: vi.fn().mockImplementation(() => ({
		models: {
			generateContent: vi.fn(),
		},
	})),
}));

describe("GeminiLyricsAnnotator", () => {
	let annotator: GeminiLyricsAnnotator;
	let mockGenAI: any;
	let mockGenerateContent: any;

	beforeEach(async () => {
		const { GoogleGenAI } = vi.mocked(await import("@google/genai")) as any;
		mockGenerateContent = vi.fn();
		mockGenAI = { models: { generateContent: mockGenerateContent } };
		(GoogleGenAI as any).mockImplementation(() => mockGenAI);

		annotator = new GeminiLyricsAnnotator({
			apiKey: "test-key",
			model: "gemini-2.5-flash",
			timeoutMs: 5000,
			maxRetries: 1,
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	const makeInput = (): LyricsAnnotatorInput => ({
		title: "時間之光",
		artists: ["鄭秀文"],
		lyricists: ["C AllStar", "林若寧"],
		language: "zh-Hant",
		lines: [
			{
				id: "l1",
				text: "童年裏每天都擁抱毛布小丑",
				tokens: [{ text: "童年" }, { text: "裏" }],
			},
			{
				id: "l2",
				text: "從前我覺得它的生命比我重",
				tokens: [{ text: "從前" }, { text: "我" }],
			},
		],
	});

	it("should parse a valid response including tokens and syntax_notes", async () => {
		const input = makeInput();
		const responsePayload = {
			songGenre: ["Cantopop"],
			lines: [
				{
					id: "l1",
					semantics: {
						themes: ["成長"],
						sentiment: "NEUTRAL",
						keywords: ["童年", "擁抱"],
					},
					tokens: [
						{ text: "童年", pos: "NOUN" },
						{ text: "裏", pos: "NOUN" },
					],
					syntax_notes: "主題與回憶的引入",
				},
				{
					id: "l2",
					semantics: {
						themes: ["愛情"],
						sentiment: "POSITIVE",
						keywords: ["覺得", "生命"],
					},
					tokens: [
						{ text: "從前", pos: "NOUN" },
						{ text: "我", pos: "PRON" },
					],
					syntax_notes: "主語與賓語關係",
				},
			],
		};
		mockGenerateContent.mockResolvedValueOnce({
			text: JSON.stringify(responsePayload),
		});

		const out = await annotator.annotate(input);
		expect(out.songGenre).toEqual(["Cantopop"]);
		expect(out.lines).toHaveLength(2);
		expect(out.lines[0]?.semantics.sentiment).toBe("NEUTRAL");
		expect(out.lines[0]?.tokens?.[0]?.pos).toBe("NOUN");
		expect(out.lines[0]?.syntax_notes).toBeTypeOf("string");
	});

	it("should retry once on transient error then succeed", async () => {
		const input = makeInput();
		const good = {
			songGenre: ["Cantopop"],
			lines: [
				{
					id: "l1",
					semantics: { themes: ["成長"], sentiment: "NEUTRAL", keywords: [] },
					tokens: [
						{ text: "童年", pos: "NOUN" },
						{ text: "裏", pos: "NOUN" },
					],
					syntax_notes: "ok",
				},
				{
					id: "l2",
					semantics: { themes: [], sentiment: "NEGATIVE", keywords: [] },
					tokens: [
						{ text: "從前", pos: "NOUN" },
						{ text: "我", pos: "PRON" },
					],
					syntax_notes: "ok",
				},
			],
		};

		mockGenerateContent
			.mockRejectedValueOnce(new Error("network"))
			.mockResolvedValueOnce({ text: JSON.stringify(good) });

		const out = await annotator.annotate(input);
		expect(out.lines[0]?.semantics.sentiment).toBe("NEUTRAL");
		expect(mockGenerateContent).toHaveBeenCalledTimes(2);
	});

	it("should fail after retries if schema is invalid (missing syntax_notes)", async () => {
		const input = makeInput();
		const bad = {
			songGenre: ["Cantopop"],
			lines: [
				{
					id: "l1",
					semantics: { themes: ["成長"], sentiment: "NEUTRAL", keywords: [] },
					tokens: [{ text: "童年", pos: "NOUN" }],
					// syntax_notes missing
				} as any,
			],
		};

		mockGenerateContent.mockResolvedValue({ text: JSON.stringify(bad) });

		await expect(annotator.annotate(input)).rejects.toThrow(
			/failed after retries/i
		);
		expect(mockGenerateContent).toHaveBeenCalledTimes(2); // 1 retry
	});
});
