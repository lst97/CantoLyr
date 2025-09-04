/**
 * Normalizer for charlist.json data format
 * Converts character frequency data to standardized Entry/Reading format
 */

import { extractTones, countSyllables, normalizeJyutping } from "./jyutping.js";
import { ToneMap } from "../../domain/value-objects/ToneMap.js";

export interface CharlistData {
	[surface: string]: {
		[jyutping: string]: number; // frequency
	};
}

export interface NormalizedReading {
	jyutping: string;
	toneOriginal: string;
	toneMapped: string;
	syllables: number;
	freq: number;
	pos: string;
	register: string;
	gloss: string;
	source: string;
}

export interface NormalizedEntry {
	surface: string;
	type: "char" | "vocab";
	lang: string;
	readings: NormalizedReading[];
}

/**
 * Determines if a surface text should be classified as 'char' or 'vocab'
 */
function determineEntryType(surface: string): "char" | "vocab" {
	// Single character entries are 'char', multi-character are 'vocab'
	return surface.length === 1 ? "char" : "vocab";
}

/**
 * Determines the language based on surface text characteristics
 */
function determineLanguage(surface: string): string {
	// ASCII letters and digits
	if (/^[A-Za-z0-9]$/.test(surface)) {
		return "misc";
	}

	// Chinese characters (CJK Unified Ideographs and extensions)
	// Only match actual Chinese characters, not punctuation or symbols
	if (/^[\u4e00-\u9fff\u3400-\u4dbf]$/.test(surface)) {
		return "zh-HK";
	}

	// Default to misc for other characters (punctuation, symbols, etc.)
	return "misc";
}

/**
 * Determines part of speech based on surface text
 */
function determinePOS(surface: string): string {
	// Numbers
	if (/^[0-9]$/.test(surface)) {
		return "NUM";
	}

	// ASCII letters
	if (/^[A-Za-z]$/.test(surface)) {
		return "LETTER";
	}

	// For Chinese characters, default to NOUN
	// In a real system, this would require linguistic analysis
	return "NOUN";
}

/**
 * Generates a gloss (definition) for the character
 */
function generateGloss(surface: string, _pos: string): string {
	// Numbers
	if (/^[0-9]$/.test(surface)) {
		const digitNames = {
			"0": "zero",
			"1": "one",
			"2": "two",
			"3": "three",
			"4": "four",
			"5": "five",
			"6": "six",
			"7": "seven",
			"8": "eight",
			"9": "nine",
		};
		return `digit ${digitNames[surface as keyof typeof digitNames] || surface}`;
	}

	// ASCII letters
	if (/^[A-Za-z]$/.test(surface)) {
		return `Latin letter ${surface.toUpperCase()}`;
	}

	// For Chinese characters, use a generic description
	// In a real system, this would come from a dictionary
	return `Chinese character ${surface}`;
}

/**
 * Normalizes charlist data to standardized Entry format
 */
export function normalizeCharlistData(
	data: CharlistData,
	sourceVersion: string = "words_hk_v28042025"
): NormalizedEntry[] {
	const entries: NormalizedEntry[] = [];

	for (const [surface, jyutpingFreqs] of Object.entries(data)) {
		const entryType = determineEntryType(surface);
		const lang = determineLanguage(surface);
		const pos = determinePOS(surface);

		const readings: NormalizedReading[] = [];

		for (const [jyutping, freq] of Object.entries(jyutpingFreqs)) {
			try {
				// Normalize jyutping
				const normalizedJyutping = normalizeJyutping(jyutping);

				// Extract tones
				const toneOriginal = extractTones(normalizedJyutping);

				// Map tones
				const toneMap = ToneMap.mapTones(toneOriginal);
				const toneMapped = toneMap.value;

				// Count syllables
				const syllables = countSyllables(normalizedJyutping);

				readings.push({
					jyutping: normalizedJyutping,
					toneOriginal,
					toneMapped,
					syllables,
					freq,
					pos,
					register: "NEUTRAL", // Default register for character data
					gloss: generateGloss(surface, pos),
					source: sourceVersion,
				});
			} catch (error) {
				console.warn(
					`Failed to normalize reading "${jyutping}" for character "${surface}":`,
					error
				);
				continue;
			}
		}

		// Sort readings by frequency (descending)
		readings.sort((a, b) => b.freq - a.freq);

		// Skip entries that have no valid readings (invalid jyutping)
		if (readings.length === 0) {
			continue;
		}

		entries.push({
			surface,
			type: entryType,
			lang,
			readings,
		});
	}

	return entries;
}

/**
 * Converts normalized entries to JSONL format
 */
export function entriesToJSONL(entries: NormalizedEntry[]): string {
	return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

/**
 * Main function to process charlist.json and output JSONL
 */
export function processCharlistToJSONL(
	charlistData: CharlistData,
	sourceVersion: string = "words_hk_v28042025"
): string {
	const normalizedEntries = normalizeCharlistData(charlistData, sourceVersion);
	return entriesToJSONL(normalizedEntries);
}
