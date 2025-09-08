import type {
	LyricsAnnotator,
	LyricsAnnotatorInput,
	LyricsAnnotatorOutput,
} from "../../../application/ports/LyricsAnnotator.js";

export class DummyLyricsAnnotator implements LyricsAnnotator {
	constructor() {}

	async validateConfig(): Promise<void> {
		// No-op for dummy
	}

	async annotate(input: LyricsAnnotatorInput): Promise<LyricsAnnotatorOutput> {
		// Simple heuristic: neutral sentiment, themes guessed by keywords
		const lines = input.lines.map((l) => {
			const keywords = Array.from(
				new Set(
					l.text
						.replace(/[\p{P}\p{S}]/gu, " ")
						.split(/\s+/)
						.filter(Boolean)
				)
			).slice(0, 6);

			const lower = l.text.toLowerCase();
			const isSad = /sad|哭|淚|失|痛|傷|孤|離/g.test(lower);
			const isHappy = /笑|樂|愛|喜|甜|暖|光/g.test(lower);
			const sentiment = (
				isSad ? "NEGATIVE" : isHappy ? "POSITIVE" : "NEUTRAL"
			) as any;

			const themes: string[] = [];
			if (/童年|成長|時間|回憶/.test(l.text)) themes.push("成長");
			if (/愛|情|她|他|你|我/.test(l.text)) themes.push("愛情");
			if (/城市|夜|光|路/.test(l.text)) themes.push("城市");

			const tokens = (l.tokens || []).map((t) => {
				const txt = t.text;
				// naive POS guess by heuristics/length
				const pos = /[0-9０-９一二三四五六七八九十百千萬億]/.test(txt)
					? "NUM"
					: txt.length <= 1
					? "NOUN"
					: /不|沒|未|無|了/.test(txt)
					? "PART"
					: /在|到|於|向|跟|和/.test(txt)
					? "ADP"
					: /很|太|更|較/.test(txt)
					? "ADV"
					: "NOUN";
				return { text: txt, pos };
			});

			const syntaxNotes = themes.length
				? `主題：${themes.join("、")}；情緒：${sentiment}`
				: `情緒：${sentiment}`;

			return {
				id: l.id,
				semantics: {
					themes,
					sentiment,
					keywords,
				},
				tokens,
				syntax_notes: syntaxNotes,
			};
		});

		const songGenre = ["Cantopop"];
		return { songGenre, lines };
	}
}
