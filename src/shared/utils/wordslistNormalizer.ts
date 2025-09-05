/**
 * Utilities for normalizing wordslist data to JSONL format
 */

import { extractTones, countSyllables, normalizeJyutping } from "./jyutping.js";
import { ToneMap } from "../../domain/value-objects/ToneMap.js";

/**
 * Raw wordslist data structure - maps words to arrays of jyutping pronunciations
 */
export interface WordslistData {
	[word: string]: string[]; // array of jyutping pronunciations
}

/**
 * Normalized reading structure for wordslist
 */
export interface WordslistReading {
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

/**
 * Normalized entry structure for wordslist
 */
export interface WordslistEntry {
	surface: string;
	type: "vocab";
	lang: string;
	readings: WordslistReading[];
}

/**
 * Normalize wordslist data to structured entries
 *
 * @param data - Raw wordslist data
 * @param source - Source identifier for the data
 * @returns Array of normalized entries
 */
export function normalizeWordslistData(
	data: WordslistData,
	source: string = "words_hk_v28042025"
): WordslistEntry[] {
	const entries: WordslistEntry[] = [];

	for (const [word, jyutpingArray] of Object.entries(data)) {
		if (!word || typeof word !== "string" || !Array.isArray(jyutpingArray)) {
			continue;
		}

    const normalizedReadings: WordslistReading[] = [];
    const seen = new Set<string>();

		for (const jyutping of jyutpingArray) {
        try {
            // Sanitize and normalize jyutping
            const sanitized = sanitizeJyutping(jyutping);
            if (!sanitized.trim()) {
                // Skip if empty after sanitization
                continue;
            }
            const normalizedJyutping = normalizeJyutping(sanitized);

            // Extract tones
            const toneOriginal = extractTones(normalizedJyutping);

            // Map tones
            const toneMap = ToneMap.mapTones(toneOriginal);
            const toneMapped = toneMap.value;

            // Count syllables
            const syllables = countSyllables(normalizedJyutping);

            // Create normalized reading
            const reading: WordslistReading = {
                jyutping: normalizedJyutping,
                toneOriginal,
                toneMapped,
                syllables,
                freq: 1, // Default frequency since wordslist doesn't provide frequency data
                pos: inferPartOfSpeech(word, syllables),
                register: inferRegister(word, syllables),
                gloss: generateGloss(word),
                source,
            };

            // Deduplicate readings by jyutping + toneOriginal signature
            const sig = `${reading.jyutping}|${reading.toneOriginal}`;
            if (!seen.has(sig)) {
                normalizedReadings.push(reading);
                seen.add(sig);
            }
        } catch (error) {
            console.warn(
                `Failed to normalize reading "${jyutping}" for word "${word}":`,
                error
            );
            continue;
        }
    }

		if (normalizedReadings.length > 0) {
			entries.push({
				surface: word.trim(),
				type: "vocab",
				lang: determineLanguage(word),
				readings: normalizedReadings,
			});
		}
	}

	return entries;
}

/**
 * Convert normalized entries to JSONL format
 *
 * @param entries - Array of normalized entries
 * @returns JSONL string
 */
export function entriesToJSONL(entries: WordslistEntry[]): string {
	return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

/**
 * Process wordslist data and convert to JSONL format
 *
 * @param data - Raw wordslist data
 * @param source - Source identifier
 * @returns JSONL string
 */
export function processWordslistToJSONL(
	data: WordslistData,
	source: string = "words_hk_v28042025"
): string {
	const entries = normalizeWordslistData(data, source);
	return entriesToJSONL(entries);
}

/**
 * Determine language based on word characteristics
 *
 * @param word - The word to analyze
 * @returns Language code
 */
function determineLanguage(word: string): string {
	// Check if word contains Chinese characters
	const chineseRegex =
		/[\u4e00-\u9fff\u3400-\u4dbf\u20000-\u2a6df\u2a700-\u2b73f\u2b740-\u2b81f\u2b820-\u2ceaf]/;

	if (chineseRegex.test(word)) {
		return "zh-HK";
	}

	// Check for other character types
	const englishRegex = /^[a-zA-Z\s\-']+$/;
	if (englishRegex.test(word)) {
		return "en";
	}

	return "misc";
}

/**
 * Infer part of speech based on word characteristics
 *
 * @param word - The word to analyze
 * @param syllables - Number of syllables
 * @returns Part of speech
 */
function inferPartOfSpeech(word: string, syllables: number): string {
	// Simple heuristics for part of speech inference

	// Single character words are often particles or function words
	if (word.length === 1) {
		return "PART";
	}

	// Two-character words are often nouns or adjectives
	if (word.length === 2) {
		return syllables === 2 ? "NOUN" : "ADJ";
	}

	// Three or more characters are likely nouns or verbs
	if (word.length >= 3) {
		return syllables >= 3 ? "NOUN" : "VERB";
	}

	return "UNKNOWN";
}

/**
 * Infer register based on word characteristics
 *
 * @param word - The word to analyze
 * @param syllables - Number of syllables
 * @returns Register level
 */
function inferRegister(word: string, syllables: number): string {
	// Simple heuristics for register inference

	// Longer words tend to be more formal
	if (word.length >= 4 || syllables >= 4) {
		return "FORMAL";
	}

	// Single character words are often colloquial
	if (word.length === 1) {
		return "COLLOQUIAL";
	}

	return "NEUTRAL";
}

/**
 * Generate a basic gloss (English translation) for the word
 *
 * @param word - The word to generate gloss for
 * @returns Basic gloss
 */
function generateGloss(word: string): string {
	// This is a placeholder - in a real implementation, you'd have
	// a dictionary or translation service
	return `[${word}]`;
}

/**
 * Sanitize raw jyutping string inputs from wordslist
 * - Removes disruptive symbols like '!' (ASCII) and '！' (full-width)
 */
function sanitizeJyutping(input: string): string {
	if (!input) return "";
	return input.replace(/[!！]/g, "").trim();
}
