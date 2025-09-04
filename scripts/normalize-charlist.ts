#!/usr/bin/env tsx

/**
 * Script to normalize charlist.json data to JSONL format
 * Usage: tsx scripts/normalize-charlist.ts [input-file] [output-file]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import {
	processCharlistToJSONL,
	type CharlistData,
} from "../src/shared/utils/charlistNormalizer.js";

async function main() {
	try {
		const inputFile = process.argv[2] || "data/sample/charlist.json";
		const outputFile = process.argv[3] || "data/normalized/chars.jsonl";
		const charDetailFile = process.argv[4] || "data/sample/char_detail.json";
		const charFreqFile = process.argv[5] || "data/sample/char_freq.json";

		console.log(`🔄 Normalizing charlist data from: ${inputFile}`);

		// Check if input file exists
		if (!existsSync(inputFile)) {
			console.error(`❌ Input file not found: ${inputFile}`);
			process.exit(1);
		}

		// Read and parse the charlist data
		const rawData = readFileSync(inputFile, "utf-8");
		const charlistData: CharlistData = JSON.parse(rawData);

		console.log(
			`📊 Processing ${Object.keys(charlistData).length} characters...`
		);

		// Process the data
		let jsonlOutput = processCharlistToJSONL(
			charlistData,
			"words_hk_v28042025"
		);

		// If char_detail.json exists, enrich gloss and adjust lang
		let enrichedCount = 0;
		let skippedCount = 0;
		if (existsSync(charDetailFile)) {
			console.log(`🔎 Enriching with details from: ${charDetailFile}`);
			const rawDetail = readFileSync(charDetailFile, "utf-8");
			type CharDetailItem = {
				char: string;
				pronunciations?: Array<{
					explanations?: Array<{
						content?: string;
						words?: Array<{ word: string; text?: string }>;
					}>;
				}>;
			};
			let charDetails: CharDetailItem[] = [];
			try {
				// Try as a normal JSON array first
				const parsed = JSON.parse(rawDetail);
				charDetails = Array.isArray(parsed)
					? (parsed as CharDetailItem[])
					: [parsed as CharDetailItem];
			} catch {
				// Fallback: parse as concatenated JSON objects (not an array)
				const objs: string[] = [];
				let depth = 0;
				let inStr = false;
				let esc = false;
				let start = -1;
				for (let i = 0; i < rawDetail.length; i++) {
					const ch = rawDetail[i];
					if (inStr) {
						if (esc) {
							esc = false;
						} else if (ch === "\\") {
							esc = true;
						} else if (ch === '"') {
							inStr = false;
						}
					} else {
						if (ch === '"') {
							inStr = true;
						} else if (ch === "{") {
							if (depth === 0) start = i;
							depth++;
						} else if (ch === "}") {
							depth--;
							if (depth === 0 && start >= 0) {
								objs.push(rawDetail.slice(start, i + 1));
								start = -1;
							}
						}
					}
				}
				charDetails = objs
					.map((s, idx) => {
						try {
							return JSON.parse(s) as CharDetailItem;
						} catch (e) {
							console.warn(
								`Skipping invalid JSON object #${idx + 1} in detail file`
							);
							return null as unknown as CharDetailItem;
						}
					})
					.filter(
						(x): x is CharDetailItem =>
							!!x && typeof (x as any).char === "string"
					);
			}
			const glossMap = new Map<string, string>();

			for (const item of charDetails) {
				if (!item || typeof item.char !== "string") continue;
				const contents: string[] = [];
				for (const p of item.pronunciations || []) {
					for (const ex of p.explanations || []) {
						if (ex && typeof ex.content === "string" && ex.content.trim()) {
							contents.push(ex.content.trim());
						}
					}
				}
				if (contents.length > 0) {
					// Gloss is the concatenation of all explanation contents
					const gloss = contents.join("； ");
					glossMap.set(item.char, gloss);
				}
			}

			// Post-process JSONL entries
			const lines = jsonlOutput.split("\n").filter(Boolean);
			const updatedLines: string[] = [];
			for (const line of lines) {
				try {
					const entry = JSON.parse(line);
					const gloss = glossMap.get(entry.surface);
					if (gloss) {
						// Mark written style and inject gloss for all readings
						entry.lang = "zh-TW";
						if (Array.isArray(entry.readings)) {
							for (const r of entry.readings) {
								r.gloss = gloss;
							}
						}
						enrichedCount++;
						updatedLines.push(JSON.stringify(entry));
					} else {
						// Keep unmatched entries untouched (do not remove)
						updatedLines.push(line);
					}
				} catch {
					// If a line can't be parsed, keep it untouched
					skippedCount++;
					updatedLines.push(line);
				}
			}
			jsonlOutput = updatedLines.join("\n");
			console.log(
				`🧴 Enriched ${enrichedCount} entries with gloss from details (${skippedCount} skipped).`
			);
		} else {
			console.log(
				`ℹ️  Detail file not found, skipping enrichment: ${charDetailFile}`
			);
		}


		// Apply char frequency overrides if provided
		if (existsSync(charFreqFile)) {
			console.log(`📐 Applying frequency overrides from: ${charFreqFile}`);
			const rawFreq = readFileSync(charFreqFile, "utf-8");
			type CharFreqItem = { [k: string]: any };
			let items: CharFreqItem[] = [];
			try {
				const parsed = JSON.parse(rawFreq);
				items = Array.isArray(parsed)
					? (parsed as CharFreqItem[])
					: [parsed as CharFreqItem];
			} catch {
				// Try parsing concatenated JSON objects
				const objs: string[] = [];
				let depth = 0,
					inStr = false,
					esc = false,
					start = -1;
				for (let i = 0; i < rawFreq.length; i++) {
					const ch = rawFreq[i];
					if (inStr) {
						if (esc) esc = false;
						else if (ch === "\\") esc = true;
						else if (ch === '"') inStr = false;
					} else {
						if (ch === '"') inStr = true;
						else if (ch === "{") { if (depth === 0) start = i; depth++; }
						else if (ch === "}") { depth--; if (depth === 0 && start >= 0) { objs.push(rawFreq.slice(start, i + 1)); start = -1; } }
					}
				}
				items = objs
					.map((s) => { try { return JSON.parse(s) as CharFreqItem; } catch { return null as unknown as CharFreqItem; } })
					.filter((x): x is CharFreqItem => !!x);
			}

			// Build map of char -> frequency (prefer per-million if present)
			const freqMap = new Map<string, number>();
			for (const it of items) {
				const char = (it["character"] ?? it["char"] ?? it["surface"]) as string | undefined;
				if (!char || typeof char !== "string") continue;
				let freq: number | undefined = undefined;
				// Look for keys that look like frequency per million first
				const keys = Object.keys(it);
				const perMillionKey = keys.find((k) => k.toLowerCase().includes("frequency") || k.toLowerCase().includes("ferquency"));
				if (perMillionKey && typeof it[perMillionKey] === "number") {
					freq = it[perMillionKey] as number;
				} else if (typeof it["token"] === "number") {
					freq = it["token"] as number;
				}
				if (typeof freq === "number") freqMap.set(char, freq);
			}

			if (freqMap.size > 0) {
				const lines = jsonlOutput.split("\n").filter(Boolean);
				const updated: string[] = [];
				let changed = 0;
				for (const line of lines) {
					try {
						const entry = JSON.parse(line);
						if (entry && entry.type === "char") {
							const override = freqMap.get(entry.surface);
							if (typeof override === "number" && Array.isArray(entry.readings)) {
								for (const r of entry.readings) r.freq = override;
								changed++;
							}
						}
						updated.push(JSON.stringify(entry));
					} catch {
						updated.push(line);
					}
				}
				jsonlOutput = updated.join("\n");
				console.log(`🎚️  Frequency overrides applied to ${changed} char entries.`);
			}
		} else {
			console.log(
				`ℹ️  Char frequency file not found, keeping original freqs: ${charFreqFile}`
			);
		}


		// Apply sentiment-based register/POS updates (coarse then detailed)
		const coarseSentPath = "data/sample/sentiment_dict/sentiment_dictionary.json";
		const detailedSentPath = "data/sample/sentiment_dict/大連理工情感詞彙本體/sentiments.json";
		let coarseMap = new Map<string, string>();
		let detailedRegMap = new Map<string, string>();
		let detailedPosMap = new Map<string, string>();
		if (existsSync(coarseSentPath)) {
			try {
				const raw = readFileSync(coarseSentPath, "utf-8");
				const obj = JSON.parse(raw) as Record<string, string[]>;
				for (const [k, arr] of Object.entries(obj)) {
					const keyUpper = k.toUpperCase();
					if (Array.isArray(arr)) {
						for (const w of arr) {
							if (typeof w === "string" && w.trim()) coarseMap.set(w.trim(), keyUpper);
						}
					}
				}
				console.log(`🧭 Loaded coarse sentiments for ${coarseMap.size} terms.`);
			} catch {
				console.warn(`⚠️  Failed to parse coarse sentiment dictionary at ${coarseSentPath}`);
			}
		} else {
			console.log(`ℹ️  Coarse sentiment dictionary not found: ${coarseSentPath}`);
		}

		if (existsSync(detailedSentPath)) {
			try {
				const raw = readFileSync(detailedSentPath, "utf-8");
				const arr = JSON.parse(raw) as Array<Record<string, any>>;
				for (const it of arr) {
					if (!it) continue;
					const w = (it["詞語"] ?? it["word"] ?? it["surface"]) as string | undefined;
					if (typeof w !== "string" || !w.trim()) continue;
					const reg = (it["情感分類"] ?? it["register"]) as string | undefined;
					const pos = (it["詞性種類"] ?? it["pos"]) as string | undefined;
					if (typeof reg === "string" && reg.trim()) detailedRegMap.set(w.trim(), reg.trim().toUpperCase());
					if (typeof pos === "string" && pos.trim()) detailedPosMap.set(w.trim(), pos.trim().toUpperCase());
				}
				console.log(`🧭 Loaded detailed sentiments for ${detailedRegMap.size} terms; POS for ${detailedPosMap.size}.`);
			} catch {
				console.warn(`⚠️  Failed to parse detailed sentiment dictionary at ${detailedSentPath}`);
			}
		} else {
			console.log(`ℹ️  Detailed sentiment dictionary not found: ${detailedSentPath}`);
		}

		if (coarseMap.size > 0 || detailedRegMap.size > 0 || detailedPosMap.size > 0) {
			const lines = jsonlOutput.split("\n").filter(Boolean);
			const updated: string[] = [];
			let coarseApplied = 0, regReplaced = 0, posReplaced = 0;
			for (const line of lines) {
				try {
					const entry = JSON.parse(line);
					const surface = entry?.surface as string | undefined;
					if (surface && Array.isArray(entry?.readings)) {
						const c = coarseMap.get(surface);
						if (typeof c === "string") {
							for (const r of entry.readings) r.register = c;
							coarseApplied++;
						}
						const dReg = detailedRegMap.get(surface);
						if (typeof dReg === "string") {
							for (const r of entry.readings) r.register = dReg;
							regReplaced++;
						}
						const dPos = detailedPosMap.get(surface);
						if (typeof dPos === "string") {
							for (const r of entry.readings) r.pos = dPos;
							posReplaced++;
						}
					}
					updated.push(JSON.stringify(entry));
				} catch {
					updated.push(line);
				}
			}
			jsonlOutput = updated.join("\n");
			console.log(`🧾 Sentiment updates -> coarse: ${coarseApplied}, detailed register: ${regReplaced}, POS: ${posReplaced}`);
		}

		// Ensure output directory exists
		mkdirSync(dirname(outputFile), { recursive: true });

		// Write to output file
		writeFileSync(outputFile, jsonlOutput, "utf-8");

		console.log(`✅ Normalized data written to: ${outputFile}`);
		const outLines = jsonlOutput.split("\n").filter(Boolean);
		console.log(`📊 Generated ${outLines.length} entries`);

		// Show sample output
		console.log("\n📋 Sample normalized entries:");
		outLines.slice(0, 5).forEach((line, index) => {
			const entry = JSON.parse(line);
			console.log(
				`${index + 1}. ${entry.surface} (${entry.type}, ${entry.lang}) - ${
					entry.readings.length
				} reading(s)`
			);
		});

		if (outLines.length > 5) {
			console.log(`... and ${outLines.length - 5} more entries`);
		}

		// Show statistics
		const entries = outLines.map((line) => JSON.parse(line));
		const charEntries = entries.filter((e: any) => e.type === "char").length;
		const vocabEntries = entries.filter((e: any) => e.type === "vocab").length;
		const zhHKEntries = entries.filter((e: any) => e.lang === "zh-HK").length;
		const zhTWEntries = entries.filter((e: any) => e.lang === "zh-TW").length;
		const miscEntries = entries.filter((e: any) => e.lang === "misc").length;

		console.log("\n📈 Statistics:");
		console.log(`   Characters: ${charEntries}`);
		console.log(`   Vocabulary: ${vocabEntries}`);
		console.log(`   Chinese (zh-HK): ${zhHKEntries}`);
		console.log(`   Chinese (zh-TW): ${zhTWEntries}`);
		console.log(`   Miscellaneous: ${miscEntries}`);
	} catch (error) {
		console.error("❌ Error normalizing charlist data:", error);
		process.exit(1);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
