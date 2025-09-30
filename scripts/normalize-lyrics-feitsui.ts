/**
 * Script to normalize lyrics data from feitsui source by:
 * 1. Removing symbols like (), [], {}, commas, periods, and spaces from text field
 * 2. Adding a validation field to indicate if tone_pattern length matches cleaned text character count
 * 3. Processing all JSONL files in data/preprocess/lyrics/feitsui/ recursively
 * 4. Saving normalized files with the same name in place
 * 5. Providing summary of invalid lyrics for manual review
 *
 * Usage: tsx scripts/normalize-lexicon-feitsui.ts [input-dir]
 *
 * Example:
 *   tsx scripts/normalize-lexicon-feitsui.ts data/preprocess/lyrics/feitsui
 */

import { join, relative } from "jsr:@std/path";
import { getLogger } from "jsr:@std/log";

const logger = getLogger();

interface LyricsEntry {
  id: string;
  text: string;
  structure: {
    line_index: number;
    char_count: number;
  };
  semantics?: any;
  prosody?: {
    tone_pattern?: number[];
    tone_pattern_cantonese_jyutping?: string[];
  };
  nlp?: any;
  source?: any;
  normalization?: {
    is_valid: boolean;
    original_text?: string;
    validation_notes?: string;
  };
}

/**
 * Remove symbols and spaces from text
 * Removes: (), [], {}, commas, periods, spaces, and other common punctuation
 */
function cleanText(text: string): string {
  // Remove all symbols and whitespace
  return text
    .replace(/[\(\)\[\]\{\}]/g, "") // Remove brackets
    .replace(/[,，.。、]/g, "") // Remove commas and periods
    .replace(/\s+/g, "") // Remove all whitespace
    .replace(/[！!？?；;：:「」『』""'']/g, "") // Remove other punctuation
    .replace(/[-–—]/g, "") // Remove dashes
    .replace(/[~～·•]/g, "") // Remove other symbols
    .trim();
}

/**
 * Count actual characters in text
 * This properly counts Chinese characters using Array.from
 */
function countChars(text: string): number {
  return Array.from(text).length;
}

/**
 * Validate that tone pattern matches text character count
 * Returns validation result with details
 */
function validateTonePattern(cleanedText: string, entry: LyricsEntry): {
  isValid: boolean;
  notes?: string;
} {
  const tonePattern = entry.prosody?.tone_pattern;

  if (!Array.isArray(tonePattern)) {
    // If no tone pattern, mark as valid but note it
    return { isValid: true, notes: "No tone pattern available" };
  }

  const charCount = countChars(cleanedText);
  const toneLength = tonePattern.length;

  if (charCount === toneLength) {
    return { isValid: true };
  }

  return {
    isValid: false,
    notes: `Char count (${charCount}) does not match tone pattern length (${toneLength})`,
  };
}

/**
 * Process a single JSONL file
 */
async function processLyricsFile(filePath: string): Promise<{
  totalLines: number;
  cleanedLines: number;
  invalidLines: number;
  unchangedLines: number;
  errors: number;
}> {
  // Read input file
  const content = await Deno.readTextFile(filePath);
  const lines = content.split("\n").filter((line) => line.trim());

  const outputLines: string[] = [];
  let cleaned = 0;
  let invalid = 0;
  let unchanged = 0;
  let errors = 0;

  for (const line of lines) {
    try {
      const entry: LyricsEntry = JSON.parse(line);

      // Clean the text
      const originalText = entry.text;
      const cleanedText = cleanText(originalText);

      // Skip completely empty text after cleaning (extremely rare edge case)
      if (!cleanedText) {
        logger.warn(`⚠️  Empty text after cleaning in ${filePath}, line id: ${entry.id}`);
        errors++;
        continue;
      }

      // Validate tone pattern matches character count
      const validation = validateTonePattern(cleanedText, entry);

      // Update entry with cleaned text, corrected char_count, and validation info
      const updatedEntry: LyricsEntry = {
        ...entry,
        text: cleanedText,
        structure: {
          ...entry.structure,
          char_count: countChars(cleanedText),
        },
        normalization: {
          is_valid: validation.isValid,
          ...(originalText !== cleanedText ? { original_text: originalText } : {}),
          ...(validation.notes ? { validation_notes: validation.notes } : {}),
        },
      };

      outputLines.push(JSON.stringify(updatedEntry));

      if (!validation.isValid) {
        invalid++;
      }

      if (originalText !== cleanedText) {
        cleaned++;
      } else {
        unchanged++;
      }
    } catch (error) {
      logger.warn(`⚠️  Failed to process line in ${filePath}: ${error}`);
      errors++;
    }
  }

  // Write output file (same location, atomic write with temp file)
  const tmpPath = filePath + ".tmp";
  await Deno.writeTextFile(tmpPath, outputLines.join("\n") + "\n");
  await Deno.rename(tmpPath, filePath);

  return {
    totalLines: lines.length,
    cleanedLines: cleaned,
    invalidLines: invalid,
    unchangedLines: unchanged,
    errors,
  };
}

/**
 * Recursively find all .jsonl files in a directory
 */
async function findJsonlFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  try {
    for await (const entry of Deno.readDir(dir)) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory) {
        // Recursively process subdirectories
        const subFiles = await findJsonlFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    logger.error(`❌ Error reading directory ${dir}: ${error}`);
  }

  return files;
}

/**
 * Process all JSONL files in a directory recursively
 */
async function processDirectory(dir: string): Promise<void> {
  logger.info(`🔍 Finding JSONL files in: ${dir}`);

  const files = await findJsonlFiles(dir);

  if (files.length === 0) {
    logger.warn(`⚠️  No JSONL files found in ${dir}`);
    return;
  }

  logger.info(`📊 Found ${files.length} JSONL files to process\n`);

  let totalProcessed = 0;
  let totalCleaned = 0;
  let totalInvalid = 0;
  let totalUnchanged = 0;
  let totalErrors = 0;
  let filesWithInvalidLines = 0;

  for (const file of files) {
    try {
      const result = await processLyricsFile(file);

      totalProcessed++;
      totalCleaned += result.cleanedLines;
      totalInvalid += result.invalidLines;
      totalUnchanged += result.unchangedLines;
      totalErrors += result.errors;

      if (result.invalidLines > 0) {
        filesWithInvalidLines++;
      }

      // Only log files that had changes or issues
      if (result.cleanedLines > 0 || result.invalidLines > 0 || result.errors > 0) {
        logger.info(
          `✅ ${
            relative(Deno.cwd(), file)
          }: cleaned=${result.cleanedLines}, invalid=${result.invalidLines}, unchanged=${result.unchangedLines}, errors=${result.errors}`,
        );
      }
    } catch (error) {
      logger.error(`❌ Failed to process ${file}: ${error}`);
      totalErrors++;
    }
  }

  logger.info(`\n${"=".repeat(80)}`);
  logger.info(`📈 NORMALIZATION SUMMARY`);
  logger.info(`${"=".repeat(80)}`);
  logger.info(`Files processed:              ${totalProcessed} / ${files.length}`);
  logger.info(`Files with invalid lines:     ${filesWithInvalidLines}`);
  logger.info(`Total lines cleaned:          ${totalCleaned}`);
  logger.info(`Total invalid lines:          ${totalInvalid} ⚠️`);
  logger.info(`Total unchanged lines:        ${totalUnchanged}`);
  logger.info(`Total errors:                 ${totalErrors}`);
  logger.info(`${"=".repeat(80)}`);

  if (totalInvalid > 0) {
    logger.info(
      `\n⚠️  ${totalInvalid} lines have validation issues (tone_pattern length mismatch)`,
    );
    logger.info(`   These lines are marked with normalization.is_valid=false for manual review`);
    logger.info(`   To find them, search for: "is_valid":false`);
  }
}

async function main() {
  try {
    const inputDir = Deno.args[0] || "data/preprocess/lyrics/feitsui";

    // Check if input directory exists
    try {
      const stat = await Deno.stat(inputDir);
      if (!stat.isDirectory) {
        logger.error(`❌ Input path is not a directory: ${inputDir}`);
        Deno.exit(1);
      }
    } catch {
      logger.error(`❌ Input directory not found: ${inputDir}`);
      Deno.exit(1);
    }

    await processDirectory(inputDir);
  } catch (error) {
    logger.error(`❌ Error normalizing lyrics: ${error}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
