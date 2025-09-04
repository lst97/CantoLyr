#!/usr/bin/env tsx
import { PrismaClient } from "@prisma/client";
import { readFileSync, existsSync } from "fs";
import {
	normalizeCharlistData,
	type CharlistData,
} from "../src/shared/utils/charlistNormalizer.js";
import {
	normalizeWordslistData,
	type WordslistData,
} from "../src/shared/utils/wordslistNormalizer.js";

async function populateMainDatabase() {
	console.log("🚀 Starting main database population...");

	// Use main database
	const databaseUrl = process.env["DATABASE_URL"];
	if (!databaseUrl) {
		throw new Error("DATABASE_URL environment variable is not set");
	}

	const prisma = new PrismaClient({
		datasources: {
			db: {
				url: databaseUrl,
			},
		},
	});

	try {
		await prisma.$connect();
		console.log("✅ Connected to main database");

		// Check if data already exists
		const existingCount = await prisma.entry.count();
		if (existingCount > 0) {
			console.log(
				`⚠️  Database already contains ${existingCount} entries. Skipping population.`
			);
			console.log("   To repopulate, first run: npm run db:reset");
			return;
		}

		// Load and normalize sample data
		console.log("📖 Loading sample data...");

		// Load charlist data
		const charlistRaw = readFileSync("data/sample/charlist.json", "utf-8");
		const charlistData: CharlistData = JSON.parse(charlistRaw);
		let charEntries = normalizeCharlistData(
			charlistData,
			"words_hk_charlist_v28042025"
		);
		const charSurfaces = new Set(charEntries.map((e) => e.surface));

		// Apply char frequency overrides if provided
		const charFreqPath = "data/sample/char_freq.json";
		if (existsSync(charFreqPath)) {
			console.log(`📐 Applying frequency overrides from: ${charFreqPath}`);
			const freqMap = loadCharFrequency(charFreqPath);
			if (freqMap.size > 0) {
				let changed = 0;
				for (const entry of charEntries) {
					if (entry.type !== "char") continue;
					const override = freqMap.get(entry.surface);
					if (typeof override === "number") {
						for (const r of entry.readings) r.freq = override;
						changed++;
					}
				}
				console.log(
					`🎚️  Frequency overrides applied to ${changed} char entries.`
				);
			} else {
				console.log("ℹ️  No valid frequency overrides found. Skipping.");
			}
		} else {
			console.log(
				`ℹ️  Char frequency file not found, keeping original freqs: ${charFreqPath}`
			);
		}

		// Enrich char gloss/lang from char_detail.json if present
		const charDetailPath = "data/sample/char_detail.json";
		if (existsSync(charDetailPath)) {
			console.log(`🔎 Enriching characters from: ${charDetailPath}`);
			const glossMap = loadCharDetail(charDetailPath);
			let enriched = 0;
			for (const entry of charEntries) {
				const gloss = glossMap.get(entry.surface);
				if (gloss) {
					entry.lang = "zh-TW";
					for (const r of entry.readings) r.gloss = gloss;
					enriched++;
				}
			}
			console.log(`🧴 Enriched ${enriched} char entries with gloss.`);
		}

		// Load wordslist data
		const wordslistRaw = readFileSync("data/sample/wordslist.json", "utf-8");
		const wordslistData: WordslistData = JSON.parse(wordslistRaw);
		let vocabEntries = normalizeWordslistData(
			wordslistData,
			"words_hk_wordslist_v28042025"
		);
		// Dedup vocab entries that are present in charlist
		const beforeVocab = vocabEntries.length;
		vocabEntries = vocabEntries.filter((e) => !charSurfaces.has(e.surface));
		const afterVocab = vocabEntries.length;
		const removedVocab = beforeVocab - afterVocab;
		if (removedVocab > 0) {
			console.log(
				`🧹 Removed ${removedVocab} duplicated vocab entries present in charlist (${beforeVocab} -> ${afterVocab}).`
			);
		}

		// Enrich word gloss/lang from word_detail.json if present
		const wordDetailPath = "data/sample/word_detail.json";
		if (existsSync(wordDetailPath)) {
			console.log(`🔎 Enriching vocabulary from: ${wordDetailPath}`);
			const glossMap = loadWordDetail(wordDetailPath);
			let enriched = 0;
			for (const entry of vocabEntries) {
				const gloss = glossMap.get(entry.surface);
				if (gloss) {
					entry.lang = "zh-TW";
					for (const r of entry.readings) r.gloss = gloss;
					enriched++;
				}
			}
			console.log(`🧴 Enriched ${enriched} vocab entries with gloss.`);
		}

		// Apply book-driven word frequency overrides (after enrichment)
		const bookWordFreqPath = "data/sample/book_word_freq.js";
		if (existsSync(bookWordFreqPath)) {
			console.log(
				`📐 Applying word frequency overrides from: ${bookWordFreqPath}`
			);
			const freqMap = loadWordFreqPerMillion(bookWordFreqPath);
			if (freqMap.size > 0) {
				const values = Array.from(freqMap.values()).filter(
					(v) => Number.isFinite(v) && v > 0
				);
				const minPositive = values.length ? Math.min(...values) : undefined;
				const baseline =
					minPositive !== undefined ? Math.max(1e-6, minPositive / 2) : 1e-6;
				console.log(
					`   ↳ Using baseline freq for missing words: ${baseline.toFixed(6)}`
				);

				let changed = 0;
				let baselineApplied = 0;
				let skippedZhHK = 0;
				for (const entry of vocabEntries) {
					if (entry.type !== "vocab") continue;
					if (typeof entry.surface !== "string" || entry.surface.length <= 1)
						continue; // skip singles
					if (entry.lang === "zh-HK") {
						skippedZhHK++;
						continue;
					}
					const override = freqMap.get(entry.surface);
					if (typeof override === "number") {
						for (const r of entry.readings) r.freq = override;
						changed++;
					} else {
						for (const r of entry.readings) r.freq = baseline;
						baselineApplied++;
					}
				}
				console.log(
					`🎚️  Word frequency overrides applied to ${changed} vocab entries; baseline set on ${baselineApplied}; skipped zh-HK: ${skippedZhHK}.`
				);
			} else {
				console.log("ℹ️  No valid word frequency overrides found. Skipping.");
			}
		} else {
			console.log(
				`ℹ️  Word frequency file not found, keeping default vocab freqs: ${bookWordFreqPath}`
			);
		}

		// Apply sentiment dictionaries (coarse then detailed) for register and POS
		const coarseSentPath =
			"data/sample/sentiment_dict/sentiment_dictionary.json";
		const detailedSentPath =
			"data/sample/sentiment_dict/大連理工情感詞彙本體/sentiments.json";
		let coarseSentMap: Map<string, string> | undefined;
		let detailedRegMap: Map<string, string> | undefined;
		let detailedPosMap: Map<string, string> | undefined;

		if (existsSync(coarseSentPath)) {
			coarseSentMap = loadCoarseSentimentMap(coarseSentPath);
			console.log(
				`🧭 Loaded coarse sentiments for ${coarseSentMap.size} terms.`
			);
		} else {
			console.log(
				`ℹ️  Coarse sentiment dictionary not found: ${coarseSentPath}`
			);
		}

		if (existsSync(detailedSentPath)) {
			const detailed = loadDetailedSentimentMaps(detailedSentPath);
			detailedRegMap = detailed.regMap;
			detailedPosMap = detailed.posMap;
			console.log(
				`🧭 Loaded detailed sentiments for ${detailedRegMap.size} terms; POS for ${detailedPosMap.size}.`
			);
		} else {
			console.log(
				`ℹ️  Detailed sentiment dictionary not found: ${detailedSentPath}`
			);
		}

		if (
			(coarseSentMap && coarseSentMap.size) ||
			(detailedRegMap && detailedRegMap.size) ||
			(detailedPosMap && detailedPosMap.size)
		) {
			let coarseApplied = 0,
				regReplaced = 0,
				posReplaced = 0;
			const applyTo = (entry: any) => {
				const surface: string | undefined = entry?.surface;
				if (!surface || !Array.isArray(entry?.readings)) return;
				const c = coarseSentMap?.get(surface);
				if (typeof c === "string") {
					for (const r of entry.readings) r.register = c;
					coarseApplied++;
				}
				const dReg = detailedRegMap?.get(surface);
				if (typeof dReg === "string") {
					for (const r of entry.readings) r.register = dReg;
					regReplaced++;
				}
				const dPos = detailedPosMap?.get(surface);
				if (typeof dPos === "string") {
					for (const r of entry.readings) r.pos = dPos;
					posReplaced++;
				}
			};
			for (const e of charEntries) applyTo(e);
			for (const e of vocabEntries) applyTo(e);
			console.log(
				`🧾 Sentiment updates -> coarse: ${coarseApplied}, detailed register: ${regReplaced}, POS: ${posReplaced}`
			);
		}

		// Combine all entries
		const allEntries = [...charEntries, ...vocabEntries];
		console.log(
			`📊 Loaded ${allEntries.length} entries (${charEntries.length} chars, ${vocabEntries.length} vocab)`
		);

		// Insert data in batches
		console.log("💾 Inserting data into main database...");
		let insertedCount = 0;
		let skippedCount = 0;

		for (const entry of allEntries) {
			try {
				// Create entry
				const createdEntry = await prisma.entry.create({
					data: {
						surface: entry.surface,
						type: entry.type,
						lang: entry.lang,
					},
				});

				// Create readings for this entry
				for (const reading of entry.readings) {
					await prisma.reading.create({
						data: {
							entryId: createdEntry.id,
							jyutping: reading.jyutping,
							toneOriginal: reading.toneOriginal,
							toneMapped: reading.toneMapped,
							syllables: reading.syllables,
							freq: reading.freq,
							pos: reading.pos,
							register: reading.register,
							gloss: reading.gloss,
							source: reading.source,
						},
					});
				}

				insertedCount++;
				if (insertedCount % 1000 === 0) {
					console.log(
						`   Inserted ${insertedCount}/${allEntries.length} entries...`
					);
				}
			} catch (error) {
				skippedCount++;
				if (skippedCount <= 10) {
					// Only log first 10 errors
					console.warn(
						`⚠️  Skipped entry ${entry.surface}:`,
						error instanceof Error ? error.message : error
					);
				}
			}
		}

		console.log(`✅ Database population completed!`);
		console.log(`   📊 Inserted: ${insertedCount} entries`);
		console.log(`   ⚠️  Skipped: ${skippedCount} entries`);

		// Verify final counts
		const finalEntryCount = await prisma.entry.count();
		const finalReadingCount = await prisma.reading.count();
		console.log(
			`   🔍 Final counts: ${finalEntryCount} entries, ${finalReadingCount} readings`
		);
	} catch (error) {
		console.error("❌ Error populating database:", error);
		process.exit(1);
	} finally {
		await prisma.$disconnect();
	}
}

// Helpers to parse potentially concatenated JSON objects files
function parseConcatenatedJsonObjects(raw: string): any[] {
	const objs: string[] = [];
	let depth = 0,
		inStr = false,
		esc = false,
		start = -1;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (inStr) {
			if (esc) esc = false;
			else if (ch === "\\") esc = true;
			else if (ch === '"') inStr = false;
		} else {
			if (ch === '"') inStr = true;
			else if (ch === "{") {
				if (depth === 0) start = i;
				depth++;
			} else if (ch === "}") {
				depth--;
				if (depth === 0 && start >= 0) {
					objs.push(raw.slice(start, i + 1));
					start = -1;
				}
			}
		}
	}
	return objs
		.map((s) => {
			try {
				return JSON.parse(s);
			} catch {
				return null;
			}
		})
		.filter(Boolean);
}

function loadCharFrequency(filePath: string): Map<string, number> {
	const raw = readFileSync(filePath, "utf-8");
	type CharFreqItem = { [k: string]: any };
	let items: CharFreqItem[] = [];
	try {
		const parsed = JSON.parse(raw);
		items = Array.isArray(parsed)
			? (parsed as CharFreqItem[])
			: [parsed as CharFreqItem];
	} catch {
		const objs: string[] = [];
		let depth = 0,
			inStr = false,
			esc = false,
			start = -1;
		for (let i = 0; i < raw.length; i++) {
			const ch = raw[i];
			if (inStr) {
				if (esc) esc = false;
				else if (ch === "\\") esc = true;
				else if (ch === '"') inStr = false;
			} else {
				if (ch === '"') inStr = true;
				else if (ch === "{") {
					if (depth === 0) start = i;
					depth++;
				} else if (ch === "}") {
					depth--;
					if (depth === 0 && start >= 0) {
						objs.push(raw.slice(start, i + 1));
						start = -1;
					}
				}
			}
		}
		items = objs
			.map((s) => {
				try {
					return JSON.parse(s) as CharFreqItem;
				} catch {
					return null as unknown as CharFreqItem;
				}
			})
			.filter((x): x is CharFreqItem => !!x);
	}
	const freqMap = new Map<string, number>();
	for (const it of items) {
		const char = (it["character"] ?? it["char"] ?? it["surface"]) as
			| string
			| undefined;
		if (!char || typeof char !== "string") continue;
		let freq: number | undefined = undefined;
		const keys = Object.keys(it);
		const perMillionKey = keys.find(
			(k) =>
				k.toLowerCase().includes("frequency") ||
				k.toLowerCase().includes("ferquency")
		);
		if (perMillionKey && typeof it[perMillionKey] === "number") {
			freq = it[perMillionKey] as number;
		} else if (typeof it["token"] === "number") {
			freq = it["token"] as number;
		}
		if (typeof freq === "number") freqMap.set(char, freq);
	}
	return freqMap;
}

function loadCharDetail(filePath: string): Map<string, string> {
	const raw = readFileSync(filePath, "utf-8");
	type CharDetailItem = {
		char: string;
		pronunciations?: Array<{ explanations?: Array<{ content?: string }> }>;
	};
	let items: CharDetailItem[] = [];
	try {
		const parsed = JSON.parse(raw);
		items = Array.isArray(parsed) ? parsed : [parsed];
	} catch {
		items = parseConcatenatedJsonObjects(raw) as CharDetailItem[];
	}
	const map = new Map<string, string>();
	for (const item of items) {
		if (!item || typeof item.char !== "string") continue;
		const contents: string[] = [];
		for (const p of item.pronunciations || []) {
			for (const ex of p.explanations || []) {
				if (ex && typeof ex.content === "string" && ex.content.trim())
					contents.push(ex.content.trim());
			}
		}
		if (contents.length) map.set(item.char, contents.join("； "));
	}
	return map;
}

function loadWordDetail(filePath: string): Map<string, string> {
	const raw = readFileSync(filePath, "utf-8");
	type WordDetailItem = { word: string; explanation?: string };
	let items: WordDetailItem[] = [];
	try {
		const parsed = JSON.parse(raw);
		items = Array.isArray(parsed) ? parsed : [parsed];
	} catch {
		items = parseConcatenatedJsonObjects(raw) as WordDetailItem[];
	}
	const map = new Map<string, string>();
	for (const item of items) {
		if (!item || typeof item.word !== "string") continue;
		const gloss = (item.explanation || "").trim();
		if (gloss) map.set(item.word, gloss);
	}
	return map;
}

// Parse word raw counts from book_word_freq.js-like file and return per-million frequencies.
function loadWordFreqPerMillion(filePath: string): Map<string, number> {
	const raw = readFileSync(filePath, "utf-8");
	const lines = raw.split(/\r?\n/);
	const pairs: Array<{ w: string; c: number }> = [];

	// Prefer TSV/whitespace rows: <word> <count>
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (
			trimmed.startsWith("//") ||
			trimmed.startsWith("/*") ||
			trimmed.startsWith("*")
		)
			continue;
		const clean = trimmed.replace(/[;,]$/, "");
		const match = clean.match(/^(.*?)\s+(\d+(?:\.\d+)?)(?:\s*)$/);
		if (match) {
			const w = match[1]?.trim();
			const c = Number(match[2]);
			if (w && Number.isFinite(c)) pairs.push({ w, c });
		}
	}

	if (pairs.length === 0) {
		// Fallback: try JSON formats
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				for (const it of parsed as any[]) {
					if (!it) continue;
					const w = (it.word ?? it.surface ?? it.w ?? it[0]) as
						| string
						| undefined;
					const c = (it.count ?? it.freq ?? it.c ?? it[1]) as
						| number
						| undefined;
					if (
						typeof w === "string" &&
						typeof c === "number" &&
						Number.isFinite(c)
					)
						pairs.push({ w, c });
				}
			} else if (parsed && typeof parsed === "object") {
				for (const [k, v] of Object.entries(parsed as Record<string, any>)) {
					const c = Number(v);
					if (k && Number.isFinite(c)) pairs.push({ w: k, c });
				}
			}
		} catch {
			// ignore
		}
	}

	if (pairs.length === 0) return new Map();

	const total = pairs.reduce((acc, p) => acc + p.c, 0);
	if (!Number.isFinite(total) || total <= 0) return new Map();

	const map = new Map<string, number>();
	for (const { w, c } of pairs) {
		// Skip single-character tokens; we only want multi-character words
		if (typeof w === "string" && w.length > 1) {
			const perMillion = (c / total) * 1_000_000;
			map.set(w, perMillion);
		}
	}
	return map;
}

function loadCoarseSentimentMap(filePath: string): Map<string, string> {
	const raw = readFileSync(filePath, "utf-8");
	const map = new Map<string, string>();
	try {
		const obj = JSON.parse(raw) as Record<string, any>;
		for (const [k, v] of Object.entries(obj)) {
			const keyUpper = k.toUpperCase();
			if (Array.isArray(v)) {
				for (const term of v) {
					if (typeof term === "string" && term.trim())
						map.set(term.trim(), keyUpper);
				}
			}
		}
	} catch {
		// ignore
	}
	return map;
}

function loadDetailedSentimentMaps(filePath: string): {
	regMap: Map<string, string>;
	posMap: Map<string, string>;
} {
	const raw = readFileSync(filePath, "utf-8");
	const regMap = new Map<string, string>();
	const posMap = new Map<string, string>();
	try {
		const arr = JSON.parse(raw) as Array<Record<string, any>>;
		if (Array.isArray(arr)) {
			for (const it of arr) {
				if (!it) continue;
				const w = (it["詞語"] ?? it["word"] ?? it["surface"]) as
					| string
					| undefined;
				if (typeof w !== "string" || !w.trim()) continue;
				const reg = (it["情感分類"] ?? it["register"]) as string | undefined;
				const pos = (it["詞性種類"] ?? it["pos"]) as string | undefined;
				if (typeof reg === "string" && reg.trim())
					regMap.set(w.trim(), reg.trim().toUpperCase());
				if (typeof pos === "string" && pos.trim())
					posMap.set(w.trim(), pos.trim().toUpperCase());
			}
		}
	} catch {
		// ignore
	}
	return { regMap, posMap };
}

// Run the script
populateMainDatabase().catch(console.error);
