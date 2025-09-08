#!/usr/bin/env tsx

/**
 * Quick query example against Chroma
 * Usage: tsx scripts/query-chroma.ts "你的查詢內容"
 */

import { ChromaClient } from "chromadb";
import { pipeline, env } from "@huggingface/transformers";
import {
	loadEnvFile,
	getOptionalEnv,
	getEnvAsNumber,
	getSecret,
} from "../src/infrastructure/config/env.js";

class LocalHuggingFaceEmbeddingFunction {
	private modelId = getOptionalEnv(
		"HF_EMBEDDING_MODEL",
		"onnx-community/embeddinggemma-300m-ONNX"
	);
	private dim = getEnvAsNumber(
		"EMBED_DIM",
		getEnvAsNumber("EMBEDDING_DIM", 768)
	);
	private extractorPromise: Promise<any>;

	constructor() {
		const hfToken = getSecret("HF_TOKEN", { required: false });
		if (hfToken) {
			// @ts-ignore
			(env as any).HF_TOKEN = hfToken;
		}
			const cacheDir = getOptionalEnv(
				"TRANSFORMERS_CACHE",
				getOptionalEnv("HF_HOME", "")
			);
			if (cacheDir) {
				(env as any).cacheDir = cacheDir;
			}
			const onnxBackend = getOptionalEnv("EMBED_ONNX_BACKEND", "");
			if (onnxBackend) {
				// @ts-ignore
				(env as any).backends = { onnx: onnxBackend };
			}
			const localDir = getOptionalEnv("HF_EMBEDDING_LOCAL_DIR", "");
			if (localDir) {
				// @ts-ignore
				(env as any).allowRemoteModels = false;
				// @ts-ignore
				(env as any).localModelPath = localDir;
			}
		const dtype = getOptionalEnv("EMBED_DTYPE", "fp32") as any;
		this.extractorPromise = pipeline("feature-extraction", this.modelId, { dtype });
	}

	private toQuery(text: string): string {
		return `task: search result | query: ${text}`;
	}
	private toDocument(text: string, title?: string): string {
		return `title: ${title ?? "none"} | text: ${text}`;
	}
  private truncateAndNormalize(vec: number[] | Float32Array): number[] {
    const base: number[] = Array.from(vec as ArrayLike<number>);
    const target = this.dim;
    const sliced: number[] = target < base.length ? base.slice(0, target) : base;
    const norm: number = Math.sqrt(sliced.reduce((s: number, v: number) => s + v * v, 0)) || 1;
    return sliced.map((v: number) => v / norm);
  }
  private toVectors(output: any): number[][] {
    if (output && typeof (output as any).tolist === 'function') {
      const t = (output as any).tolist() as unknown;
      if (Array.isArray(t)) {
        const first = (t as any[])[0];
        return Array.isArray(first) ? (t as number[][]) : [t as number[]];
      }
    }
    if (Array.isArray(output)) {
      const outArr = output as any[];
      if (outArr.length > 0 && typeof outArr[0] === 'number') return [outArr as number[]];
      return outArr as number[][];
    }
    return [];
  }
	async embedDocuments(texts: string[]): Promise<number[][]> {
		const extractor = await this.extractorPromise;
    const embeddings = await extractor(texts.map((t) => this.toDocument(t)), { pooling: "mean", normalize: true });
    const lists = this.toVectors(embeddings);
    return lists.map((v: any) => this.truncateAndNormalize(v));
  }
  async embedQuery(text: string): Promise<number[]> {
    const extractor = await this.extractorPromise;
    const emb = await extractor(this.toQuery(text), { pooling: "mean", normalize: true });
    const vectors = this.toVectors(emb);
    const vec = vectors[0] || [];
    return this.truncateAndNormalize(vec);
  }
	async generate(texts: string[]): Promise<number[][]> {
		return this.embedDocuments(texts);
	}
}

async function main() {
	loadEnvFile();
	const chromaUrl = getOptionalEnv("CHROMA_URL", "http://localhost:8000");
	const collectionName = getOptionalEnv(
		"CHROMA_COLLECTION",
		"cantolyr_lexicon_v1_768"
	);
	const query = process.argv[2] || "粵語 余 的意思";

	// Options parsed later (single parser to avoid redeclaration)

	if (!getSecret("HF_TOKEN", { required: false })) {
		console.warn(
			"HF_TOKEN not set. If the model is gated, downloads will fail."
		);
	}

	// Parse optional filters and options
	const extraArgs = process.argv.slice(3);
	const where: Record<string, any> = {};
	let whereDocument: Record<string, any> | undefined;
	let nResults = getEnvAsNumber("N_RESULTS", 5);
	for (const a of extraArgs) {
		if (a.startsWith("--tone=")) {
			const val = a.split("=", 2)[1] ?? "";
			// Treat tone as string to preserve leading zeros
			where["tone"] = val;
		} else if (a.startsWith("--toneMapped=")) {
			// Back-compat alias: map to new `tone` field (as string)
			const val = a.split("=", 2)[1] ?? "";
			where["tone"] = val;
		} else if (a.startsWith("--pronunciation=")) {
			// Allow filtering by pronunciation (string)
			const val = a.split("=", 2)[1] ?? "";
			where["pronunciation"] = val;
		} else if (a.startsWith("--where=")) {
			try {
				Object.assign(where, JSON.parse(a.split("=", 2)[1] ?? "{}"));
			} catch {}
		} else if (
			a.startsWith("--whereDocContains=") ||
			a.startsWith("--contains=")
		) {
			const val = a.split("=", 2)[1] ?? "";
			whereDocument = { $contains: val };
		} else if (a.startsWith("--whereDocRegex=")) {
			const val = a.split("=", 2)[1] ?? "";
			whereDocument = { $regex: val };
		} else if (a.startsWith("--n=") || a.startsWith("--k=")) {
			const val = Number(a.split("=", 2)[1]);
			if (!Number.isNaN(val) && val > 0) nResults = val;
		}
	}
	// Prefer TONE, support TONE_MAPPED for back-compat; treat as string
	const envTone = process.env["TONE"] ?? process.env["TONE_MAPPED"];
	if (envTone !== undefined) {
		where["tone"] = String(envTone);
	}
	// Optional pronunciation from env (string)
	const envPron = process.env["PRONUNCIATION"];
	if (envPron !== undefined) {
		where["pronunciation"] = String(envPron);
	}

	const url = new URL(chromaUrl);
	const client = new ChromaClient({
		ssl: url.protocol === "https:",
		host: url.hostname,
		port: Number(url.port || (url.protocol === "https:" ? 443 : 8000)),
	});

	const embeddingFunction = new LocalHuggingFaceEmbeddingFunction();
	const collection = await client.getCollection({
		name: collectionName,
		embeddingFunction: embeddingFunction as any,
	});
	const res = await collection.query({
		queryTexts: [query],
		nResults,
		where,
		whereDocument: whereDocument as any,
	});
	console.log(JSON.stringify(res, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
