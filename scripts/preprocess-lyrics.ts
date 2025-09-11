/**
 * Preprocess lyrics JSONL by annotating semantics fields per line and song genre using Gemini.
 *
 * Usage:
 *   tsx scripts/preprocess-lyrics.ts <input-jsonl-or-dir> [--outDir data/preprocess/lyrics] [--provider gemini|dummy] [--model gemini-2.5-flash|gemini-2.5-flash-lite]
 *
 * Notes:
 * - Preserves folder structure under data/preprocess/lyrics.
 * - Only fills required fields (line.semantics and source.genre) by merging LLM output back into original data.
 */

import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	readdirSync,
	renameSync,
	statSync,
} from "node:fs";
import { once } from "node:events";
import { dirname, join, relative, resolve } from "jsr:@std/path";
import { createInterface } from "node:readline";
import type {
	LyricsAnnotator,
	LyricsAnnotatorInput,
} from "../src/application/ports/LyricsAnnotator.ts";
import { GeminiLyricsAnnotator } from "../src/infrastructure/adapters/llm/GeminiLyricsAnnotator.ts";
import { load } from "jsr:@std/dotenv";
import { getLogger } from "jsr:@std/log";

const logger = getLogger();

type AnyRecord = Record<string, any>;

function outputPathFor(
	inputFile: string,
	outRoot: string
): { outPath: string; outDir: string } {
	const rel = relative(resolve("data/sample/lyrics"), resolve(inputFile));
	const outPath = join(outRoot, rel);
	const outDir = dirname(outPath);
	return { outPath, outDir };
}

async function annotateFile(
	inputFile: string,
	outRoot: string,
	annotator: LyricsAnnotator,
	opts: { resume: boolean }
): Promise<boolean> {
	if (!existsSync(inputFile)) {
		throw new Error(`Input file not found: ${inputFile}`);
	}

	// Early skip check before any heavy IO/LLM calls
	const { outPath, outDir } = outputPathFor(inputFile, outRoot);
	if (opts.resume && existsSync(outPath)) {
		logger.info(`⏭️  Skipped (already processed): ${outPath}`);
		return true;
	}

	const rl = createInterface({
		input: createReadStream(inputFile, { encoding: "utf8" }),
		crlfDelay: Infinity,
	});

	const rawLines: AnyRecord[] = [];
	for await (const line of rl) {
		if (!line.trim()) continue;
		try {
			rawLines.push(JSON.parse(line));
		} catch (e) {
			logger.warn(`Skipping invalid JSONL line: ${e}`);
		}
	}

	if (rawLines.length === 0) {
		logger.warn(`No lines parsed from ${inputFile}, skipping.`);
		return true;
	}

	const first = rawLines[0] || {};
	const input: LyricsAnnotatorInput = {
		title: first["source"]?.["title"],
		artists: first["source"]?.["artists"],
		lyricists: first["source"]?.["lyricists"],
		language: "zh-Hant",
		lines: rawLines.map((r) => {
			const base = { id: String(r["id"]), text: String(r["text"]) } as {
				id: string;
				text: string;
				tokens?: { text: string }[];
			};
			if (Array.isArray(r?.["nlp"]?.["tokens"])) {
				base.tokens = r["nlp"]["tokens"].map((t: any) => ({
					text: String(t.text),
				}));
			}
			return base;
		}),
	};

	const result = await annotator.annotate(input);
	const semById = new Map(
		result.lines.map((l) => [l.id, l.semantics] as const)
	);
	const toksById = new Map(result.lines.map((l) => [l.id, l.tokens] as const));
	const synById = new Map(
		result.lines.map((l) => [l.id, l.syntax_notes] as const)
	);

	if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

	const tmpPath = outPath + ".tmp";
	const out = createWriteStream(tmpPath, { encoding: "utf8" });
	for (const r of rawLines) {
		const semantics = semById.get(r["id"]) ||
			r["semantics"] || { themes: [], sentiment: "NEUTRAL", keywords: [] };
		const genre =
			result.songGenre && Array.isArray(result.songGenre)
				? result.songGenre
				: r?.["source"]?.["genre"] || [];

		// Merge tokens POS if provided
		let mergedTokens = r?.["nlp"]?.["tokens"];
		const newTokens = toksById.get(r["id"]);
		if (
			Array.isArray(mergedTokens) &&
			Array.isArray(newTokens) &&
			mergedTokens.length === newTokens.length
		) {
			mergedTokens = mergedTokens.map((tok: any, idx: number) => ({
				...tok,
				pos: String(newTokens[idx]?.pos || tok.pos || "X").toUpperCase(),
			}));
		} else if (Array.isArray(mergedTokens) && Array.isArray(newTokens)) {
			// Fallback: map by text
			const mapByText = new Map(
				newTokens.map((t) => [t.text, t.pos?.toUpperCase?.() || "X"] as const)
			);
			mergedTokens = mergedTokens.map((tok: any) => ({
				...tok,
				pos: mapByText.get(String(tok.text)) || tok.pos || "X",
			}));
		}

		const syntaxNotes = synById.get(r["id"]);

		const merged = {
			...r,
			semantics,
			nlp: {
				...(r["nlp"] || {}),
				tokens: mergedTokens || r?.["nlp"]?.["tokens"],
				syntax_notes:
					typeof syntaxNotes === "string"
						? syntaxNotes
						: r?.["nlp"]?.["syntax_notes"],
			},
			source: {
				...(r["source"] || {}),
				genre,
			},
		};
		out.write(JSON.stringify(merged, null, 0) + "\n");
	}
	out.end();
	await once(out, "close");

	// Atomic rename
	renameSync(tmpPath, outPath);
	logger.info(`✅ Annotated -> ${outPath}`);
	return true;
}

// Batch processing removed per request.

function listJsonlFiles(pathOrDir: string): string[] {
	const full = resolve(pathOrDir);
	const st = statSync(full);
	if (st.isFile()) return [full];
	if (!st.isDirectory()) return [];
	const files: string[] = [];
	const stack: string[] = [full];
	while (stack.length) {
		const dir = stack.pop();
		if (!dir) continue;
		for (const name of readdirSync(dir)) {
			const p = join(dir, name);
			const s = statSync(p);
			if (s.isDirectory()) stack.push(p);
			else if (s.isFile() && name.endsWith(".jsonl")) files.push(p);
		}
	}
	return files;
}

async function main() {
	// Ensure .env is loaded so GEMINI_API_KEY and related vars are available
	await load({ export: true });
	const [maybeInput, ...rest] = Deno.args;

	const args = new Map<string, string>();
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i];
		if (!a) continue;
		if (a.startsWith("--")) {
			const key = a.replace(/^--/, "");
			const nextVal = rest[i + 1];
			if (nextVal && !nextVal.startsWith("--")) {
				args.set(key, nextVal);
				i++; // consume next value
			} else {
				args.set(key, "true");
			}
		}
	}

	const outDir = args.get("outDir") || resolve("data/preprocess/lyrics");
	const provider = (
		args.get("provider") ||
		Deno.env.get("LLM_PROVIDER") ||
		(Deno.env.get("GEMINI_API_KEY") ? "gemini" : "dummy")
	).toLowerCase();
	const modelArg = args.get("model");
	const resume = args.has("no-resume") ? false : true;
	const allFeitsui = args.has("all-feitsui");

	let annotator: LyricsAnnotator;
	if (provider === "gemini") {
		const apiKey = Deno.env.get("GEMINI_API_KEY");
		if (!apiKey) {
			logger.error("GEMINI_API_KEY is required for provider=gemini");
			Deno.exit(2);
		}
		annotator = new GeminiLyricsAnnotator({
			apiKey,
			model: modelArg || Deno.env.get("LLM_MODEL") || "gemini-2.5-flash-lite",
			timeoutMs: Number(Deno.env.get("LLM_TIMEOUT_MS") || 600000),
			maxRetries: Number(Deno.env.get("LLM_MAX_RETRIES") || 2),
			enableFallback: Deno.env.get("LLM_ENABLE_FALLBACK") !== "false",
		});
	} else {
		logger.error("Invalid provider");
		return;
	}

	const targetPath = allFeitsui
		? resolve("data/sample/lyrics/feitsui")
		: maybeInput;
	if (!targetPath) {
		logger.error(
			"Usage: tsx scripts/preprocess-lyrics.ts <input-jsonl-or-dir> [--outDir data/preprocess/lyrics] [--provider gemini|dummy] [--model gemini-2.5-flash|gemini-2.5-flash-lite] [--no-resume] [--all-feitsui]"
		);
		Deno.exit(1);
	}
	const files = listJsonlFiles(targetPath);
	if (files.length === 0) {
		logger.error("No .jsonl files found to process.");
		Deno.exit(3);
	}
	const filesToProcess = resume
		? files.filter((f) => !existsSync(outputPathFor(f, outDir).outPath))
		: files;

	if (resume) {
		const skipped = files.length - filesToProcess.length;
		if (skipped > 0) {
			logger.info(`⏭️  Pre-skip ${skipped} already processed files.`);
		}
	}

	for (const file of filesToProcess) {
		try {
			await annotateFile(file, outDir, annotator, { resume });
		} catch (e) {
			logger.error(`❌ Failed: ${file} \n\t ${(e as Error).message}`);
		}
	}
	// Ensure clean termination even if any handles remain open (e.g., SDK keep-alives)
	Deno.exit(0);
}

if (import.meta.main) {
	main().catch((e) => {
		logger.error(`❌ Preprocess failed: ${(e as Error).message}`);
		Deno.exit(1);
	});
}
