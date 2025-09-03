import type { Group } from "../../../../application/services/mvpPrefilter.js";

type PromptOptions = {
  theme?: string;
  mood?: string;
  genre?: string;
  language?: string; // e.g., "zh-HK"
};

/**
 * Build a strict, compact prompt for MVP grouped selection.
 * - Only surface text is included.
 * - Model must pick exactly one option from each group, in order.
 * - Output must be JSON only with selections and the composed line.
 */
export function buildMvpGroupedSelectionPrompt(
  groups: Group[],
  opts: PromptOptions = {}
): string {
  const { theme, mood, genre, language } = opts;

  const header = [
    `Task: Select exactly one option from each group to compose ONE lyric line.`,
    `Constraints:`,
    `- Use ONLY the chosen options, concatenated in the same group order.`,
    `- Do NOT add, remove, or change any characters.`,
    `- Pick the most fitting options to express feeling and grammaticality.`,
    language ? `- Language: ${language}` : undefined,
    theme ? `- Theme: ${theme}` : undefined,
    mood ? `- Mood: ${mood}` : undefined,
    genre ? `- Genre: ${genre}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  const groupsText = groups
    .map((g) => {
      const optionsText = g.options
        .map((o) => `[${o.option}] ${o.surface}`)
        .join(", ");
      return `Group ${g.groupIndex} (${g.pattern}): ${optionsText}`;
    })
    .join("\n");

  const outputSpec = `\n\nOutput JSON only (no prose):\n{\n  "selections": [\n    {"group": 1, "option": <number>},\n    {"group": 2, "option": <number>},\n    ...\n  ],\n  "line": "<concatenation of chosen options in order>",\n  "reason": "<brief rationale>"\n}`;

  return `${header}\n\n${groupsText}${outputSpec}`;
}
