import { describe, it, expect } from "vitest";
import { buildMvpGroupedSelectionPrompt } from "../../../../../src/infrastructure/adapters/llm/prompts/mvpGroupedSelectionPrompt.js";
import type { Group } from "../../../../../src/application/services/mvpPrefilter.js";

describe("buildMvpGroupedSelectionPrompt (MVP)", () => {
	const groups: Group[] = [
		{
			groupIndex: 1,
			pattern: "00",
			options: [
				{ option: 1, surface: "愛你", readingId: 1n },
				{ option: 2, surface: "心靈", readingId: 2n },
			],
		},
		{
			groupIndex: 2,
			pattern: "22",
			options: [
				{ option: 1, surface: "回憶", readingId: 3n },
				{ option: 2, surface: "月光", readingId: 4n },
			],
		},
	];

	it("includes strict constraints and lists groups with numbered options", () => {
		const prompt = buildMvpGroupedSelectionPrompt(groups, {
			theme: "romantic",
			mood: "tender",
			genre: "ballad",
			language: "zh-HK",
		});

		expect(prompt).toContain("Task: Select exactly one option from each group");
		expect(prompt).toContain("Use ONLY the chosen options");
		expect(prompt).toContain("Do NOT add, remove, or change any characters");
		expect(prompt).toContain("Language: zh-HK");
		expect(prompt).toContain("Theme: romantic");
		expect(prompt).toContain("Mood: tender");
		expect(prompt).toContain("Genre: ballad");

		expect(prompt).toContain("Group 1 (00): [1] 愛你, [2] 心靈");
		expect(prompt).toContain("Group 2 (22): [1] 回憶, [2] 月光");
	});

	it("specifies JSON-only output schema", () => {
		const prompt = buildMvpGroupedSelectionPrompt(groups);
		expect(prompt).toContain("Output JSON only (no prose):");
		expect(prompt).toContain('"selections"');
		expect(prompt).toContain('"line"');
		expect(prompt).toContain('"reason"');
	});
});
