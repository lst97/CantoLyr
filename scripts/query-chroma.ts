#!/usr/bin/env tsx

/**
 * Quick query example against Chroma
 * Usage: tsx scripts/query-chroma.ts "你的查詢內容"
 */

import { ChromaClient } from "chromadb";
import { GoogleGenAI } from "@google/genai";

class GoogleEmbeddingFunction {
    private ai = new GoogleGenAI({ apiKey: process.env["GOOGLE_API_KEY"]! });
    private model = process.env["EMBEDDING_MODEL"] || "text-embedding-004";
    private dim = Number(process.env["EMBED_DIM"] || process.env["EMBEDDING_DIM"] || 768);
    private supportsOutputDim(): boolean { return !/embedding-001$/i.test(this.model); }
    async embedDocuments(texts: string[]): Promise<number[][]> {
        const params: any = { model: this.model, contents: texts };
        if (this.supportsOutputDim()) params.outputDimensionality = this.dim;
        const res = await (this.ai.models as any).embedContent(params);
        return (res.embeddings || []).map((e: any) => e.values || []);
    }
    async embedQuery(text: string): Promise<number[]> {
        const params: any = { model: this.model, contents: [text] };
        if (this.supportsOutputDim()) params.outputDimensionality = this.dim;
        const res = await (this.ai.models as any).embedContent(params);
        return res.embeddings?.[0]?.values || [];
    }
    async generate(texts: string[]): Promise<number[][]> { return this.embedDocuments(texts); }
}

async function main() {
	const chromaUrl = process.env["CHROMA_URL"] || "http://localhost:8000";
	const collectionName =
		process.env["CHROMA_COLLECTION"] || "cantolyr_lexicon_v1";
	const query = process.argv[2] || "粵語 余 的意思";

	// Options parsed later (single parser to avoid redeclaration)

    if (!process.env["GOOGLE_API_KEY"]) {
        console.error("Set GOOGLE_API_KEY to run queries.");
        process.exit(1);
    }

    // Parse optional filters and options
    const extraArgs = process.argv.slice(3);
    const where: Record<string, any> = {};
    let whereDocument: Record<string, any> | undefined;
    let nResults = Number(process.env["N_RESULTS"] || 5);
    const toNumberIfNumeric = (v: string) => (/^-?\d+(?:\.\d+)?$/.test(v) ? Number(v) : v);
    for (const a of extraArgs) {
        if (a.startsWith("--tone=") || a.startsWith("--toneMapped=")) {
            const val = a.split("=", 2)[1] ?? "";
            where["toneMapped"] = toNumberIfNumeric(val);
        } else if (a.startsWith("--where=")) {
            try { Object.assign(where, JSON.parse(a.split("=", 2)[1] ?? "{}")); } catch {}
        } else if (a.startsWith("--whereDocContains=") || a.startsWith("--contains=")) {
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
    const envTone = process.env["TONE_MAPPED"];
    if (envTone !== undefined) {
        where["toneMapped"] = toNumberIfNumeric(envTone);
    }

    const url = new URL(chromaUrl);
    const client = new ChromaClient({
        ssl: url.protocol === "https:",
        host: url.hostname,
        port: Number(url.port || (url.protocol === "https:" ? 443 : 8000)),
    });

    const embeddingFunction = new GoogleEmbeddingFunction();
    const collection = await client.getCollection({
        name: collectionName,
        embeddingFunction: embeddingFunction as any,
    });
    const res = await collection.query({ queryTexts: [query], nResults, where, whereDocument: whereDocument as any });
	console.log(JSON.stringify(res, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
