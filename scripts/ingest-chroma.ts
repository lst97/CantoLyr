#!/usr/bin/env tsx

/**
 * Proxy script: delegates Chroma ingestion to Python.
 *
 * Usage:
 *   tsx scripts/ingest-chroma.ts [inputJSONL] [collectionName]
 *
 * This script only invokes `chroma/ingest_chroma.py` with the given args.
 */

import { existsSync } from "fs";
import path from "path";
import { spawn } from "child_process";
import { loadEnvFile } from "../src/infrastructure/config/env.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function systemPython(): string {
	// Base interpreter used to create venv if needed
	const override =
		process.env["PYTHON_BASE"] ||
		process.env["PYTHON_BIN"] ||
		process.env["PYTHON"] ||
		"";
	if (override) return override;
	return process.platform === "win32" ? "python" : "python3";
}

async function run(
	cmd: string,
	args: string[],
	env: NodeJS.ProcessEnv = {}
): Promise<number> {
	return new Promise((resolve, reject) => {
		const p = spawn(cmd, args, {
			stdio: "inherit",
			env: { ...process.env, ...env },
		});
		p.on("exit", (code) => resolve(code ?? 1));
		p.on("error", (err) => reject(err));
	});
}

async function main() {
	// Load .env early and pass-through to Python
	loadEnvFile();

	const input = process.argv[2] || "data/vector/chroma-all.jsonl";
	const collection =
		process.argv[3] ||
		process.env["CHROMA_COLLECTION"] ||
		"cantolyr_lexicon_v1_768";

	const chromaDir = path.resolve(__dirname, "../chroma");
	const scriptPath = path.join(chromaDir, "ingest_chroma.py");
	const requirementsPath = path.join(chromaDir, "requirements.txt");

	if (!existsSync(scriptPath)) {
		console.error(`❌ Python ingest script not found: ${scriptPath}`);
		process.exit(1);
	}

	// Resolve venv location (default: chroma/.venv). Allow override via VENV_PATH.
	const venvDir = process.env["VENV_PATH"] || path.join(chromaDir, ".venv");
	const venvPython =
		process.platform === "win32"
			? path.join(venvDir, "Scripts", "python.exe")
			: path.join(venvDir, "bin", "python");

	// Ensure venv exists
	if (!existsSync(venvPython)) {
		console.log(`🐍 Creating virtual environment at ${venvDir} ...`);
		const basePy = systemPython();
		const createCode = await run(basePy, ["-m", "venv", venvDir]);
		if (createCode !== 0) {
			console.error("❌ Failed to create virtual environment.");
			process.exit(createCode);
		}
	}

	// Ensure dependencies installed
	if (existsSync(requirementsPath)) {
		console.log(
			"📦 Installing Python dependencies (pip install -r requirements.txt) ..."
		);
		const pipCode = await run(venvPython, [
			"-m",
			"pip",
			"install",
			"-r",
			requirementsPath,
		]);
		if (pipCode !== 0) {
			console.error("❌ Failed installing Python dependencies.");
			process.exit(pipCode);
		}
	} else {
		console.warn(
			`⚠️ requirements.txt not found at ${requirementsPath}. Skipping pip install.`
		);
	}

	// Delegate ingest to venv Python
	console.log(`🚀 Running ingest via venv: ${venvPython} ${scriptPath}`);
	const code = await run(venvPython, [scriptPath, input, collection]);
	if (code !== 0) {
		console.error(`❌ Python ingest exited with code ${code}`);
		process.exit(code);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) main();
