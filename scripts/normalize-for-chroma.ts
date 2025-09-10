/**
 * Normalize JSONL (chars + vocab) into Chroma-ready documents.
 *
 * Input (defaults):
 *  - data/normalized/normalized-chars.jsonl
 *  - data/normalized/normalized-vocab.jsonl
 *
 * Output (defaults):
 *  - data/vector/chroma-chars.jsonl
 *  - data/vector/chroma-vocab.jsonl
 *  - data/vector/chroma-all.jsonl (merged)
 *
 * Each output line is a JSON object:
 *  {
 *    id: string,
 *    document: string,
 *    metadata: { ...original fields flattened per reading... }
 *  }
 */

import { dirname } from "jsr:@std/path";
import { getLogger } from "jsr:@std/log";

const logger = getLogger();

type Reading = {
	jyutping?: string[]; // tokens
	pronunciation?: string; // mapped tones (new schema keeps this)
	tone?: string; // tone digits (new)
	consonants?: string[]; // initial(s) per syllable (new)
	rhymes?: string[]; // rhyme(s) per syllable (new)
	syllables?: number;
	freq?: number;
	pos?: string;
	register?: string;
	gloss?: string;
	source?: string;
};

type NormalizedLine = {
	surface: string;
	type: "char" | "vocab" | string;
	lang?: string;
	readings?: Reading[];
};

async function ensureDirFor(filePath: string) {
	const dir = dirname(filePath);
	try {
		await Deno.stat(dir);
	} catch {
		await Deno.mkdir(dir, { recursive: true });
	}
}

function sanitizeForId(s: string | undefined): string {
	if (!s) return "";
	// Avoid whitespace in IDs; keep pipes as delimiters
	return s.trim().replace(/\s+/g, "_");
}

function buildId(type: string, surface: string, r: Reading): string {
	const jp = sanitizeForId(
		Array.isArray(r.jyutping) ? r.jyutping.join(" ") : ""
	);
	// ID scheme uses tone (not pronunciation) per docs and new schema
	const toneToken = r.tone ? `tone${r.tone}` : "tone";
	return `${type}|${surface}|${jp}|${toneToken}`;
}

function buildDocument(n: NormalizedLine, r: Reading): string {
	const prefix = n.type === "char" ? "字" : "詞";
	const surface = n.surface;
	const jyutping = Array.isArray(r.jyutping) ? r.jyutping.join(" ") : "";
	const pronunciation = r.pronunciation ?? "";
	const tone = r.tone ?? "";
	const rhymesStr = Array.isArray(r.rhymes) ? r.rhymes.join(" ") : "";
	const pos = r.pos ?? "";
	const register = r.register ?? "";
	const gloss = r.gloss ?? "";

	// Use full-width parentheses for the first block and ASCII for the rest, per example
	// Example target:
	// 詞：9up（粵音：gau1 ap1, 韻母:au ap, 發音:33, 調：11）(詞性：VERB), (情感: NEUTRAL)。意：([9up])
	return `${prefix}：${surface}（粵音：${jyutping}, 韻母:${rhymesStr}, 發音:${pronunciation}, 調:${tone}）(詞性：${pos}), (情感: ${register})。意：(${gloss})。`;
}

function toChromaJSONLines(
	inputJsonl: string,
	typeHint: "char" | "vocab",
	producedIds: Set<string>
) {
	const lines = inputJsonl.split(/\r?\n/).filter(Boolean);
	const out: string[] = [];
	for (const line of lines) {
		let obj: NormalizedLine | undefined;
		try {
			obj = JSON.parse(line) as NormalizedLine;
		} catch {
			continue; // skip invalid JSON lines
		}
		if (!obj || typeof obj.surface !== "string") continue;
		const type = (obj.type as string) || typeHint || "vocab";
		const base: NormalizedLine = { ...obj, type };
		if (!Array.isArray(base.readings) || base.readings.length === 0) continue;

		for (const r of base.readings) {
			const id = buildId(type, base.surface, r);
			if (producedIds.has(id)) continue; // skip duplicates
			const document = buildDocument(base, r);
			const metadata = {
				surface: base.surface,
				type: type,
				lang: base.lang ?? "",
				jyutping: Array.isArray(r.jyutping) ? r.jyutping.join(" ") : "",
				pronunciation: r.pronunciation ?? "",
				tone: r.tone ?? "",
				// No arrays in metadata (Chroma restriction); keep stringified variants
				consonantsStr: Array.isArray(r.consonants)
					? r.consonants.join(" ")
					: "",
				rhymesStr: Array.isArray(r.rhymes) ? r.rhymes.join(" ") : "",
				syllables: r.syllables,
				pos: r.pos ?? "",
				register: r.register ?? "",
				freq: r.freq,
				gloss: r.gloss ?? "",
				source: r.source ?? "",
			} as Record<string, unknown>;

			// Add per-syllable fields for simple equality filters (e.g., consonant1, rhyme1)
			const cList = Array.isArray(r.consonants) ? r.consonants : [];
			const rList = Array.isArray(r.rhymes) ? r.rhymes : [];
			for (let i = 0; i < Math.max(cList.length, rList.length); i++) {
				if (cList[i]) (metadata as any)[`consonant${i + 1}`] = cList[i];
				if (rList[i]) (metadata as any)[`rhyme${i + 1}`] = rList[i];
			}

			out.push(JSON.stringify({ id, document, metadata }));
			producedIds.add(id);
		}
	}
	return out.join("\n");
}

async function main() {
	const args = Deno.args;
	const charsIn = args[0] || "data/normalized/normalized-chars.jsonl";
	const vocabIn = args[1] || "data/normalized/normalized-vocab.jsonl";
	const charsOut = args[2] || "data/vector/chroma-chars.jsonl";
	const vocabOut = args[3] || "data/vector/chroma-vocab.jsonl";
	const allOut = args[4] || "data/vector/chroma-all.jsonl";

	try {
		await Deno.stat(charsIn);
	} catch {
		logger.error(`❌ Missing input file: ${charsIn}`);
		Deno.exit(1);
	}
	try {
		await Deno.stat(vocabIn);
	} catch {
		logger.error(`❌ Missing input file: ${vocabIn}`);
		Deno.exit(1);
	}

	logger.info(`🔄 Reading: ${charsIn}`);
	const charsRaw = await Deno.readTextFile(charsIn);
	logger.info(`🔄 Reading: ${vocabIn}`);
	const vocabRaw = await Deno.readTextFile(vocabIn);

	logger.info(`🧪 Converting chars -> Chroma JSONL`);
	const producedIds = new Set<string>();
	const charsChroma = toChromaJSONLines(charsRaw, "char", producedIds);

	logger.info(`🧪 Converting vocab -> Chroma JSONL`);
	const vocabChroma = toChromaJSONLines(vocabRaw, "vocab", producedIds);

	await ensureDirFor(charsOut);
	await ensureDirFor(vocabOut);
	await ensureDirFor(allOut);

	await Deno.writeTextFile(charsOut, charsChroma + (charsChroma ? "\n" : ""));
	logger.info(
		`✅ Wrote ${charsOut} (${
			charsChroma.split(/\n/).filter(Boolean).length
		} lines)`
	);

	await Deno.writeTextFile(vocabOut, vocabChroma + (vocabChroma ? "\n" : ""));
	logger.info(
		`✅ Wrote ${vocabOut} (${
			vocabChroma.split(/\n/).filter(Boolean).length
		} lines)`
	);

	const merged = [charsChroma, vocabChroma].filter(Boolean).join("\n");
	await Deno.writeTextFile(allOut, merged + (merged ? "\n" : ""));
	logger.info(
		`✅ Wrote ${allOut} (${merged.split(/\n/).filter(Boolean).length} lines)`
	);

	// Show a few samples
	const show = (label: string, s: string) => {
		const lines = s.split(/\n/).filter(Boolean);
		logger.info(`\n📋 Sample (${label}):`);
		for (const [i, line] of lines.slice(0, 3).entries()) {
			try {
				const j = JSON.parse(line);
				logger.info(
					`${i + 1}. id=${j.id} document=${j.document.substring(0, 80)}…`
				);
			} catch {
				logger.info(`${i + 1}. ${line.substring(0, 80)}…`);
			}
		}
	};
	show("chars", charsChroma);
	show("vocab", vocabChroma);
}

if (import.meta.main) {
	main();
}
