import { load } from "jsr:@std/dotenv";
import * as path from "jsr:@std/path";
import { exists } from "jsr:@std/fs/exists";
import { getLogger } from "jsr:@std/log";

const logger = getLogger();

/**
 * Deno-native proxy script: delegates Chroma ingestion to Python.
 */

async function run(cmd: string, args: string[]): Promise<number> {
  const command = new Deno.Command(cmd, {
    args,
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await command.output();
  return code;
}

async function main() {
  await load({ export: true });

  // Mode: 'lexicon' | 'lyrics' | 'all'
  const mode = (Deno.args[0] || Deno.env.get("INGEST_MODE") || "all").toLowerCase();

  // Inputs/collections: allow override via args, else env, else defaults
  const _lexiconInput = Deno.env.get("LEXICON_INPUT") || "data/vector/chroma-lexicon.jsonl";
  const _lyricsInput = Deno.env.get("LYRICS_INPUT") || "data/vector/chroma-lyrics.jsonl";

  const _lexiconCollection = Deno.env.get("CHROMA_COLLECTION_LEXICON") || Deno.env.get("CHROMA_COLLECTION") || "cantolyr_lexicon_v1_1024";
  const _lyricsCollection = Deno.env.get("CHROMA_COLLECTION_LYRICS") || "cantolyr_lyrics_v1_1024";

  const scriptDir = path.dirname(path.fromFileUrl(import.meta.url));
  const chromaDir = path.resolve(scriptDir, "../chroma");
  const entryScript = path.join(chromaDir, "ingest_chroma.py");

  if (!(await exists(entryScript))) {
    logger.error(`❌ Python ingest script not found: ${entryScript}`);
    Deno.exit(1);
  }

  const venvDir = Deno.env.get("VENV_PATH") || path.join(chromaDir, ".venv");
  const venvPython = Deno.build.os === "windows"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");

  if (!(await exists(venvPython))) {
    logger.error(
      `❌ Python virtual environment not found at ${venvDir}. Please run the setup script in the chroma directory.`,
    );
    Deno.exit(1);
  }

  const args: string[] = [entryScript];
  if (mode === "lexicon") {
    args.push("lexicon");
    if (Deno.args[1]) args.push(Deno.args[1]); // optional input override
    if (Deno.args[2]) args.push(Deno.args[2]); // optional collection override
  } else if (mode === "lyrics") {
    args.push("lyrics");
    if (Deno.args[1]) args.push(Deno.args[1]);
    if (Deno.args[2]) args.push(Deno.args[2]);
  } else if (mode === "all") {
    // 'all' mode needs no extra args; the Python script will read env defaults
  } else if (mode.endsWith('.jsonl')) {
    // Back-compat: allow direct file
    args.push(mode);
    if (Deno.args[1]) args.push(Deno.args[1]);
  } else {
    // Fallback to 'all'
    logger.warn(`⚠️ Unknown mode '${mode}', defaulting to 'all'`);
  }

  logger.info(`🚀 Running ingest (${mode}) via venv: ${venvPython} ${args.join(" ")}`);
  const code = await run(venvPython, args);
  if (code !== 0) {
    logger.error(`❌ Python ingest exited with code ${code}`);
    Deno.exit(code);
  }
  logger.info("✅ Ingestion complete.");
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error("❌ An unexpected error occurred:", err);
    Deno.exit(1);
  });
}
