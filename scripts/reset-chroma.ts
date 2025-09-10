/**
 * Reset Chroma collections.
 *
 * Usage:
 *   tsx scripts/reset-chroma.ts [--all] [--collection=name]
 *
 * Defaults:
 *   CHROMA_URL=http://localhost:8000
 *   CHROMA_COLLECTION=cantolyr_lexicon_v1
 */

import { ChromaClient } from "chromadb";
import { load } from "jsr:@std/dotenv";
import { getLogger } from "jsr:@std/log";

const logger = getLogger();

function parseArgFlag(name: string): boolean {
	return Deno.args.some((a) => a === `--${name}`);
}

function parseArgKV(name: string): string | undefined {
	const found = Deno.args.find((a) => a.startsWith(`--${name}=`));
	return found ? found.split("=", 2)[1] : undefined;
}

async function main() {
	await load({ export: true });
	const chromaUrl = Deno.env.get("CHROMA_URL") || "http://localhost:8000";
	const collectionName =
		parseArgKV("collection") ||
		Deno.env.get("CHROMA_COLLECTION") ||
		"cantolyr_lexicon_v1_1024";
	const resetAll =
		parseArgFlag("all") ||
		/^(1|true|yes)$/i.test(String(Deno.env.get("CHROMA_RESET_ALL") || ""));

	const u = new URL(chromaUrl);
	const client = new ChromaClient({
		ssl: u.protocol === "https:",
		host: u.hostname,
		port: Number(u.port || (u.protocol === "https:" ? 443 : 8000)),
	});
	logger.info(`🔗 Chroma: ${chromaUrl}`);

	if (resetAll) {
		logger.info("🧨 Resetting entire Chroma DB (all collections)…");
		try {
			await client.reset();
			logger.info("✅ Reset complete.");
			return;
		} catch (err: any) {
			const msg = err?.message || String(err);
			logger.warn(`⚠️  Reset endpoint denied: ${msg}`);
			logger.warn(
				"   ↳ Falling back to deleting all collections individually…"
			);
			try {
				const cols = await client.listCollections();
				let deleted = 0;
				for (const c of cols) {
					try {
						await client.deleteCollection({ name: (c as any).name });
						deleted += 1;
						logger.info(`   • Deleted: ${(c as any).name}`);
					} catch (e) {
						logger.warn(
							`   • Skip ${(c as any).name}: ${(e as any)?.message || e}`
						);
					}
				}
				logger.info(
					`✅ Fallback delete complete. Collections removed: ${deleted}`
				);
				return;
			} catch (e) {
				logger.error(`❌ Fallback delete failed: ${(e as any)?.message || e}`);
				Deno.exit(1);
			}
		}
	}

	logger.info(`🗑️  Deleting collection: ${collectionName}`);
	try {
		await client.deleteCollection({ name: collectionName });
		logger.info("✅ Collection deleted.");
	} catch (err: any) {
		const msg = err?.message || String(err);
		if (/not found/i.test(msg)) {
			logger.info("ℹ️  Collection did not exist; nothing to delete.");
		} else {
			logger.error(`❌ Failed to delete collection: ${msg}`);
			Deno.exit(1);
		}
	}
}

if (import.meta.main) main();
