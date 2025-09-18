/**
 * Preprocess chars.jsonl and vocab.jsonl to fill in correct POS and REGISTER using Gemini.
 *
 * - Batches up to 100 surfaces per LLM request (configurable via --batch).
 * - Only sends the surface string to the LLM.
 * - Caches results in .cache/pos-register-cache.json so the job is resumable.
 * - Writes updated files as <name>.posr.jsonl in the specified outDir via atomic rename.
 *
 * Usage (Deno):
 *   deno run -A scripts/preprocess-pos-register.ts \
 *     --files data/normalized/chars.jsonl,data/normalized/vocab.jsonl \
 *     --outDir data/preprocess/lexicon --model gemini-2.5-flash-lite --batch 100
 *
 * Requires env: GEMINI_API_KEY
 */

import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { basename, dirname, extname, join, resolve } from "node:path";
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from "@google/genai";
import process from "node:process";

// Minimal logger (avoid external deps)
const logger = {
  info: (...args: any[]) => console.log(...args),
  warn: (...args: any[]) => console.warn(...args),
  error: (...args: any[]) => console.error(...args),
};

function loadEnvFromDotenv() {
  try {
    const p = resolve(".env");
    if (!existsSync(p)) return;
    const raw = readFileSync(p, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      try {
        Deno.env.set(key, value);
      } catch { /* ignore outside Deno */ }
      try {
        (process.env as any)[key] = value;
      } catch { /* ignore */ }
    }
  } catch {
    // ignore
  }
}

type AnyRecord = Record<string, any>;

type Classification = {
  surface: string;
  pos: string; // UPPERCASE, e.g., NOUN, VERB, ADJ, NUM, ...
  register: string; // UPPERCASE, one of COLLOQUIAL, DEGREE, FORMAL, NEGATION, NEGATIVE, NEUTRAL, POSITIVE
};

const DEFAULT_ALLOWED_POS = [
  "ADJ",
  "ADV",
  "AUX",
  "CONJ",
  "DET",
  "INTJ",
  "NOUN",
  "NUM",
  "PART",
  "PRON",
  "PROPN",
  "PUNCT",
  "VERB",
  "ADP",
  "SCONJ",
  "X",
] as const;

const DEFAULT_ALLOWED_REGISTER = [
  "COLLOQUIAL",
  "DEGREE",
  "FORMAL",
  "NEGATION",
  "NEGATIVE",
  "NEUTRAL",
  "POSITIVE",
] as const;

type AllowedPOS = typeof DEFAULT_ALLOWED_POS[number];
type AllowedRegister = typeof DEFAULT_ALLOWED_REGISTER[number];

type CacheFormat = {
  version: number;
  updatedAt: string;
  data: Record<
    string,
    { pos: AllowedPOS | string; register: AllowedRegister | string }
  >; // keyed by surface
};

function loadCache(cachePath: string): CacheFormat {
  try {
    const raw = readFileSync(cachePath, "utf-8");
    const parsed = JSON.parse(raw) as CacheFormat;
    if (!parsed || typeof parsed !== "object" || !parsed.data) {
      throw new Error("invalid cache");
    }
    return parsed;
  } catch {
    return { version: 1, updatedAt: new Date().toISOString(), data: {} };
  }
}

function saveCache(cachePath: string, cache: CacheFormat): void {
  const dir = dirname(cachePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  cache.updatedAt = new Date().toISOString();
  writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildPrompt(
  surfaces: string[],
  allowedPOS = DEFAULT_ALLOWED_POS,
  allowedReg = DEFAULT_ALLOWED_REGISTER,
): string {
  const header = [
    "你是一個懂廣東話詞語詞性與語域(REGISTER)的專家。",
    "給你一批詞語(只提供詞面)，請為每個詞語判斷 POS 與 REGISTER。",
    "返回 JSON 陣列，每個元素包含 surface、pos、register 三個欄位。",
    "約束：",
    "- pos 必須為大寫，且只選以下其中之一：" + allowedPOS.join(", "),
    "- register 必須為大寫，且只選以下其中之一：" + allowedReg.join(", "),
    "- 若無法明確判斷，pos 用 'X'，register 用 'NEUTRAL'。",
    "- 只輸出 JSON，不要額外說明文字。",
  ].join("\n");

  const list = surfaces.map((s) => `- ${s}`).join("\n");
  const example = [
    "輸入詞語：",
    list,
  ].join("\n");

  const schemaHint = [
    "輸出格式：",
    "[",
    '  { "surface": string, "pos": string, "register": string },',
    "  ...",
    "]",
  ].join("\n");

  return [header, example, schemaHint].join("\n\n");
}

async function classifyBatch(
  genAI: GoogleGenAI,
  surfaces: string[],
  model: string,
  timeoutMs: number,
): Promise<Classification[]> {
  const prompt = buildPrompt(surfaces);

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Gemini API request timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
  );

  const responsePromise = genAI.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: 0.1,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 81920,
      responseModalities: ["TEXT"],
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            surface: { type: "string" },
            pos: { type: "string", enum: [...DEFAULT_ALLOWED_POS, "X"] },
            register: { type: "string", enum: [...DEFAULT_ALLOWED_REGISTER] },
          },
          required: ["surface", "pos", "register"],
        },
      },
      thinkingConfig: { thinkingBudget: 0 },
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    },
  });

  const res = await Promise.race([responsePromise, timeoutPromise]);
  const text = extractText(res);
  if (!text) {
    throw new Error(
      `No text content in Gemini response ${JSON.stringify(res)}`,
    );
  }
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  const payload = jsonMatch ? jsonMatch[0] : text;
  const parsed = JSON.parse(payload) as Classification[];
  // Normalize case and ensure enums
  return parsed.map((r) => ({
    surface: String(r.surface),
    pos: String(r.pos || "X").toUpperCase(),
    register: String(r.register || "NEUTRAL").toUpperCase(),
  }));
}

function extractText(response: any): string | undefined {
  try {
    if (!response) return undefined;
    if (typeof response.text === "string" && response.text.trim()) {
      return response.text;
    }
    const maybeResp = response.response ?? response;
    if (maybeResp && typeof maybeResp.text === "function") {
      const t = maybeResp.text();
      if (typeof t === "string" && t.trim()) return t;
    }
    const candidates = maybeResp?.candidates ?? response?.candidates;
    if (Array.isArray(candidates) && candidates.length) {
      for (const c of candidates) {
        const contentItems = c?.content ? (Array.isArray(c.content) ? c.content : [c.content]) : [];
        for (const content of contentItems) {
          const parts = content?.parts ?? c?.parts ?? [];
          if (Array.isArray(parts) && parts.length) {
            for (const p of parts) {
              if (typeof p?.text === "string" && p.text.trim()) return p.text;
            }
          }
        }
        if (typeof c?.text === "string" && c.text.trim()) return c.text;
      }
    }
    if (
      typeof maybeResp?.output_text === "string" && maybeResp.output_text.trim()
    ) {
      return maybeResp.output_text;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function classifyWithCache(
  genAI: GoogleGenAI,
  surfaces: string[],
  cachePath: string,
  opts: {
    model: string;
    batchSize: number;
    timeoutMs: number;
    maxRetries: number;
  },
): Promise<CacheFormat> {
  const cache = loadCache(cachePath);
  const pending = uniq(surfaces.filter((s) => s && !cache.data[s]));
  if (pending.length === 0) return cache;

  const batches = chunk(pending, Math.max(1, opts.batchSize));
  logger.info(
    `Classifying ${pending.length} surfaces in ${batches.length} batch(es)...`,
  );

  for (let i = 0; i < batches.length; i++) {
    const b = batches[i];
    let attempt = 0;
    for (; attempt <= opts.maxRetries; attempt++) {
      try {
        const results = await classifyBatch(
          genAI,
          b,
          opts.model,
          opts.timeoutMs,
        );
        for (const r of results) {
          if (!r?.surface) continue;
          cache.data[r.surface] = {
            pos: r.pos as AllowedPOS,
            register: r.register as AllowedRegister,
          };
        }
        saveCache(cachePath, cache);
        logger.info(
          `✔️  Batch ${i + 1}/${batches.length} cached (${results.length} items).`,
        );
        break; // success
      } catch (err) {
        if (attempt === opts.maxRetries) {
          logger.error(
            `❌ Batch ${i + 1} failed after retries: ${(err as Error).message}`,
          );
          // Persist partial cache (if any)
          saveCache(cachePath, cache);
          throw err;
        }
        const backoff = 500 * Math.pow(2, attempt) +
          Math.floor(Math.random() * 250);
        logger.warn(
          `Retrying batch ${i + 1}/${batches.length} in ${backoff}ms due to: ${
            (err as Error).message
          }`,
        );
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  return cache;
}

async function rewriteFileWithPOSRegister(
  inputPath: string,
  cache: CacheFormat,
  outDir: string,
): Promise<string> {
  if (!existsSync(inputPath)) throw new Error(`Input not found: ${inputPath}`);
  const baseName = basename(inputPath).replace(/\.jsonl$/i, ".posr.jsonl");
  const finalOut = join(outDir, baseName);
  const tmpOut = finalOut + ".tmp";

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const rl = createInterface({
    input: createReadStream(inputPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  const out = createWriteStream(tmpOut, { encoding: "utf-8" });

  let count = 0, touched = 0;
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    let obj: AnyRecord | null = null;
    try {
      obj = JSON.parse(t);
    } catch {
      continue;
    }
    if (!obj) {
      continue;
    }
    count++;
    const surface = String(obj?.surface ?? "");
    if (surface && cache.data[surface]) {
      const { pos, register } = cache.data[surface];
      if (Array.isArray(obj.readings)) {
        obj.readings = obj.readings.map((r: AnyRecord) => ({
          ...r,
          pos: String(pos || r?.pos || "X").toUpperCase(),
          register: String(register || r?.register || "NEUTRAL").toUpperCase(),
        }));
        touched++;
      } else {
        // If no readings array, add/override top-level fields safely
        if (surface) {
          obj.pos = String(pos || obj.pos || "X").toUpperCase();
          obj.register = String(register || obj.register || "NEUTRAL")
            .toUpperCase();
          touched++;
        }
      }
    }
    out.write(JSON.stringify(obj) + "\n");
    logger.info(`Processed ${count} lines, updated ${touched} so far...`);
  }
  out.end();
  await once(out, "close");

  renameSync(tmpOut, finalOut);
  logger.info(`✅ Wrote ${finalOut} (records: ${count}, updated: ${touched})`);
  return finalOut;
}

async function listSurfacesFromJsonl(inputPath: string): Promise<string[]> {
  const surfaces: string[] = [];
  const rl = createInterface({
    input: createReadStream(inputPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t) as AnyRecord;
      const s = obj?.surface;
      if (typeof s === "string" && s) surfaces.push(s);
    } catch {
      // skip invalid line
    }
  }
  return surfaces;
}

async function main() {
  loadEnvFromDotenv();
  const argMap = new Map<string, string>();
  for (let i = 0; i < Deno.args.length; i++) {
    const a = Deno.args[i];
    if (!a) continue;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = Deno.args[i + 1];
      if (next && !next.startsWith("--")) {
        argMap.set(key, next);
        i++;
      } else argMap.set(key, "true");
    }
  }

  const filesArg = argMap.get("files") ||
    "data/normalized/chars.jsonl,data/normalized/vocab.jsonl";
  const files = filesArg.split(",").map((s) => s.trim()).filter(Boolean);
  const model = (argMap.get("model") || Deno.env.get("LLM_MODEL") ||
    "gemini-2.5-flash-lite")
    .trim();
  const batchSize = Math.max(1, Number(argMap.get("batch") || 250));
  const outDir = resolve(argMap.get("outDir") || "data/preprocess/lexicon");
  const resume = !argMap.has("no-resume");
  const cachePath = resolve(".cache/pos-register-cache.json");
  const timeoutMs = Math.max(
    10000,
    Number(Deno.env.get("LLM_TIMEOUT_MS") || 180000),
  );
  const maxRetries = Math.max(0, Number(Deno.env.get("LLM_MAX_RETRIES") || 2));

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    logger.error("GEMINI_API_KEY is required in environment");
    Deno.exit(2);
  }
  const genAI = new GoogleGenAI({ apiKey });

  // Build the set of surfaces to classify across all files (dedup to save tokens)
  const allSurfaces: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) {
      logger.warn(`Skipping missing file: ${file}`);
      continue;
    }
    const ext = extname(file).toLowerCase();
    if (ext !== ".jsonl") {
      logger.warn(`Skipping non-JSONL file: ${file}`);
      continue;
    }
    const surfaces = await listSurfacesFromJsonl(file);
    allSurfaces.push(...surfaces);
  }
  const dedupSurfaces = uniq(allSurfaces);
  logger.info(
    `Loaded ${allSurfaces.length} surfaces (${dedupSurfaces.length} unique) from ${files.length} file(s).`,
  );

  let cache = loadCache(cachePath);
  if (!resume) {
    cache = { version: 1, updatedAt: new Date().toISOString(), data: {} };
    saveCache(cachePath, cache);
  }

  cache = await classifyWithCache(genAI, dedupSurfaces, cachePath, {
    model,
    batchSize,
    timeoutMs,
    maxRetries,
  });

  // Rewrite files with updated POS/REGISTER
  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      await rewriteFileWithPOSRegister(file, cache, outDir);
    } catch (e) {
      logger.error(`Failed to rewrite ${file}: ${(e as Error).message}`);
    }
  }

  logger.info("Done.");
  Deno.exit(0);
}

if (import.meta.main) {
  main().catch((e) => {
    logger.error(`❌ preprocess-pos-register failed: ${(e as Error).message}`);
    Deno.exit(1);
  });
}
