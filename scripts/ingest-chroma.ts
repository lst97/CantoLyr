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

  const input = Deno.args[0] || "data/vector/chroma-all.jsonl";
  const collection = Deno.args[1] ||
    Deno.env.get("CHROMA_COLLECTION") ||
    "cantolyr_lexicon_v1_1024";

  const scriptDir = path.dirname(path.fromFileUrl(import.meta.url));
  const chromaDir = path.resolve(scriptDir, "../chroma");
  const scriptPath = path.join(chromaDir, "ingest_chroma.py");

  if (!(await exists(scriptPath))) {
    logger.error(`❌ Python ingest script not found: ${scriptPath}`);
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

  logger.info(`🚀 Running ingest via venv: ${venvPython} ${scriptPath}`);
  const code = await run(venvPython, [scriptPath, input, collection]);
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
