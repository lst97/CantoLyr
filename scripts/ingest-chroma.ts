#!/usr/bin/env tsx

/**
 * Ingest Chroma-ready JSONL into a Chroma collection with multilingual (Chinese) embeddings.
 *
 * Usage:
 *   tsx scripts/ingest-chroma.ts [inputJSONL] [collectionName]
 *
 * Defaults:
 *   inputJSONL: data/vector/chroma-all.jsonl
 *   collection: cantolyr_lexicon_v1
 *
 * Env:
 *   CHROMA_URL=http://localhost:8000
 *   (Embedding Provider)
 *     GOOGLE_API_KEY=...  -> uses Google text-embedding-004
 *   EMBEDDING_MODEL=text-embedding-004
 */

import { createReadStream } from "fs";
import { existsSync } from "fs";
import readline from "readline";
import { ChromaClient } from "chromadb";
import { GoogleGenAI } from "@google/genai";

type ChromaInput = {
	id: string;
	document: string;
	metadata?: Record<string, unknown>;
};

// Minimal embedding function wrapper compatible with Chroma v1/v3

class GoogleEmbeddingFunction {
	private ai: GoogleGenAI;
	private model: string;
	private dim: number;
	constructor(apiKey: string, model = "text-embedding-004") {
		this.ai = new GoogleGenAI({ apiKey });
		this.model = model;
		this.dim = Number(
			process.env["EMBED_DIM"] || process.env["EMBEDDING_DIM"] || 768
		);
	}
	async embedDocuments(texts: string[]): Promise<number[][]> {
		const out: number[][] = [];
		const chunkSize = 96;
		for (let i = 0; i < texts.length; i += chunkSize) {
			const chunk = texts.slice(i, i + chunkSize);
			const res = await (this.ai.models as any).embedContent({
				model: this.model,
				contents: chunk,
				outputDimensionality: this.dim,
			});
			const vecs = res.embeddings?.map((e: any) => e.values ?? []) ?? [];
			for (const v of vecs) out.push(v);
		}
		return out;
	}
	async embedQuery(text: string): Promise<number[]> {
		const res = await (this.ai.models as any).embedContent({
			model: this.model,
			contents: [text],
			outputDimensionality: this.dim,
		});
		const first = res.embeddings?.[0]?.values ?? [];
		return first;
	}

	// Chroma v3 expects a `generate(texts)` method on custom embedding functions
	async generate(texts: string[]): Promise<number[][]> {
		return this.embedDocuments(texts);
	}
}

async function main() {
	const input = process.argv[2] || "data/vector/chroma-all.jsonl";
	const collectionName = process.argv[3] || "cantolyr_lexicon_v1";
	const chromaUrl = process.env["CHROMA_URL"] || "http://localhost:8000";

	if (!existsSync(input)) {
		console.error(`❌ Input not found: ${input}`);
		process.exit(1);
	}

	console.log(`🔗 Connecting to Chroma at: ${chromaUrl}`);
	const client = new ChromaClient({ path: chromaUrl });

	// Choose embedding provider
	const googleKey = process.env["GOOGLE_API_KEY"];
	const model = process.env["EMBEDDING_MODEL"] || "text-embedding-004";

	if (!googleKey) {
		console.error("❌ No embedding provider configured. Set GOOGLE_API_KEY.");
		process.exit(1);
	}
	console.log(`🧠 Using Google embeddings: ${model}`);
	const embeddingFunction = new GoogleEmbeddingFunction(googleKey, model);

	const collection = await client.getOrCreateCollection({
		name: collectionName,
		embeddingFunction,
		metadata: { domain: "cantolyr", lang: "zh" },
	});
	console.log(`📚 Ready collection: ${collectionName}`);

	// Stream JSONL and batch upsert
	const rl = readline.createInterface({
		input: createReadStream(input, { encoding: "utf-8" }),
		crlfDelay: Infinity,
	});

	const BATCH = 128;
	let ids: string[] = [];
	let docs: string[] = [];
	let metas: Record<string, unknown>[] = [];
	let total = 0;
	let processedLines = 0;
	let duplicatesSkipped = 0;
	let batchesUpserted = 0;
	let perRecordRetries = 0;
	let perRecordFailures = 0;
	const seenIds = new Set<string>();

	async function flush() {
		if (ids.length === 0) return;
		// Dedup within batch
		const idxById = new Map<string, number>();
		const uniqIds: string[] = [];
		const uniqDocs: string[] = [];
		const uniqMetas: Record<string, unknown>[] = [];
		for (let i = 0; i < ids.length; i++) {
			const id = ids[i];
			if (idxById.has(id!)) continue;
			idxById.set(id!, i);
			uniqIds.push(id!);
			uniqDocs.push(docs[i]!);
			uniqMetas.push(metas[i]!);
		}

		// Sanitize metadata values to string|number|boolean for widest compatibility
		const cleanMetas = uniqMetas.map((m) => {
			const out: Record<string, string | number | boolean> = {};
			for (const [k, v] of Object.entries(m)) {
				if (
					typeof v === "string" ||
					typeof v === "number" ||
					typeof v === "boolean"
				) {
					out[k] = v;
				} else if (v != null) {
					out[k] = String(v);
				}
			}
			return out;
		});

		let addedThis = 0;
		try {
			await collection.upsert({
				ids: uniqIds,
				documents: uniqDocs,
				metadatas: cleanMetas as any,
			});
			addedThis = uniqIds.length;
		} catch (err: any) {
			console.warn(
				`⚠️  Batch upsert failed (${uniqIds.length}): ${err?.message || err}`
			);
			console.warn("   ↳ Falling back to per-record upserts.");
			for (let i = 0; i < uniqIds.length; i++) {
				try {
					await collection.upsert({
						ids: [uniqIds[i]!],
						documents: [uniqDocs[i]!],
						metadatas: [cleanMetas[i]!],
					});
					addedThis += 1;
					perRecordRetries += 1;
				} catch (e) {
					perRecordFailures += 1;
					console.warn(
						`   ↳ Skipped id=${uniqIds[i]} due to error: ${
							(e as any)?.message || e
						}`
					);
				}
			}
		}

		total += addedThis;
		batchesUpserted += 1;
		console.log(`⬆️  Upserted batch: +${addedThis} (total ${total})`);
		ids = [];
		docs = [];
		metas = [];
	}

	for await (const line of rl) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const obj = JSON.parse(trimmed) as ChromaInput;
			if (!obj.id || !obj.document) continue;
			processedLines += 1;
			if (seenIds.has(obj.id)) {
				duplicatesSkipped += 1;
				continue;
			}
			seenIds.add(obj.id);
			ids.push(obj.id);
			docs.push(obj.document);
			metas.push(obj.metadata || {});
			if (ids.length >= BATCH) await flush();
		} catch {
			// skip invalid line
		}
	}

	await flush();

	console.log("\n📈 Ingestion Report:");
	console.log(`   Lines processed: ${processedLines}`);
	console.log(`   Unique IDs seen: ${seenIds.size}`);
	console.log(`   Batches upserted: ${batchesUpserted}`);
	console.log(`   Records upserted: ${total}`);
	console.log(`   Duplicates skipped (within run): ${duplicatesSkipped}`);
	console.log(`   Per-record retries: ${perRecordRetries}`);
	console.log(`   Per-record failures: ${perRecordFailures}`);
	console.log("✅ Ingestion complete.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
