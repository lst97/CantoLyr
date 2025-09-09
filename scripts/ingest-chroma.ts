import { load } from "std/dotenv/mod.ts";
import * as path from "std/path/mod.ts";
import { exists } from "std/fs/exists.ts";

/**
 * Deno-native proxy script: delegates Chroma ingestion to Python.
 */

async function run(cmd: string, args: string[]): Promise<number> {
  const command = new Deno.Command(cmd, {
    args,
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await command.spawn().status;
  return status.code;
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
    console.error(`❌ Python ingest script not found: ${scriptPath}`);
    Deno.exit(1);
  }

  const venvDir = Deno.env.get("VENV_PATH") || path.join(chromaDir, ".venv");
  const venvPython = Deno.build.os === "windows"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");

  if (!(await exists(venvPython))) {
    console.error(
      `❌ Python virtual environment not found at ${venvDir}. Please run the setup script in the chroma directory.`,
    );
    Deno.exit(1);
  }

  console.log(`🚀 Running ingest via venv: ${venvPython} ${scriptPath}`);
  const code = await run(venvPython, [scriptPath, input, collection]);
  if (code !== 0) {
    console.error(`❌ Python ingest exited with code ${code}`);
    Deno.exit(code);
  }
  console.log("✅ Ingestion complete.");
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("❌ An unexpected error occurred:", err);
    Deno.exit(1);
  });
}
