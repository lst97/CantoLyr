#!/usr/bin/env tsx

/**
 * Normalize JSONL (chars + vocab) into Chroma-ready documents.
 *
 * Input (defaults):
 *  - data/normalized/normalized-chars.jsonl
 *  - data/normalized/normalized-vocab.jsonl
 *
 * Output (defaults):
 *  - data/vector/chroma-chars.jsonl
 *  - data/vector/chroma-vocab.jsonl
 *  - data/vector/chroma-all.jsonl (merged)
 *
 * Each output line is a JSON object:
 *  {
 *    id: string,
 *    document: string,
 *    metadata: { ...original fields flattened per reading... }
 *  }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

type Reading = {
  jyutping?: string;
  toneOriginal?: string | number;
  toneMapped?: string | number;
  syllables?: number;
  freq?: number;
  pos?: string;
  register?: string;
  gloss?: string;
  source?: string;
};

type NormalizedLine = {
  surface: string;
  type: "char" | "vocab" | string;
  lang?: string;
  readings?: Reading[];
};

function ensureDirFor(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function toNumberSafe(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function sanitizeForId(s: string | undefined): string {
  if (!s) return "";
  // Avoid whitespace in IDs; keep pipes as delimiters
  return s.trim().replace(/\s+/g, "_");
}

function buildId(type: string, surface: string, r: Reading): string {
  const jp = sanitizeForId(r.jyutping || "");
  const toneOrig =
    toNumberSafe(r.toneOriginal) ?? toNumberSafe(r.toneMapped) ?? undefined;
  const toneToken = toneOrig !== undefined ? `tone${toneOrig}` : "tone";
  return `${type}|${surface}|${jp}|${toneToken}`;
}

function buildDocument(n: NormalizedLine, r: Reading): string {
  const prefix = n.type === "char" ? "字" : "詞";
  const surface = n.surface;
  const jyutping = r.jyutping ?? "";
  const toneMapped =
    toNumberSafe(r.toneMapped) ?? (typeof r.toneMapped === "string" ? r.toneMapped : "");
  const pos = r.pos ?? "";
  const register = r.register ?? "";
  const gloss = r.gloss ?? "";

  // Use full-width parentheses for the first block and ASCII for the rest, per example
  // Example target:
  // 字：余（粵音：jyu4, 韻:0）(詞性：ADJ), (情感: NEUTRAL)。意：(… )。
  return `${prefix}：${surface}（粵音：${jyutping}, 韻:${toneMapped}）(詞性：${pos}), (情感: ${register})。意：(${gloss})。`;
}

function toChromaJSONLines(inputJsonl: string, typeHint: "char" | "vocab", producedIds: Set<string>) {
  const lines = inputJsonl.split(/\r?\n/).filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    let obj: NormalizedLine | undefined;
    try {
      obj = JSON.parse(line) as NormalizedLine;
    } catch {
      continue; // skip invalid JSON lines
    }
    if (!obj || typeof obj.surface !== "string") continue;
    const type = (obj.type as string) || typeHint || "vocab";
    const base: NormalizedLine = { ...obj, type };
    if (!Array.isArray(base.readings) || base.readings.length === 0) continue;

    for (const r of base.readings) {
      const id = buildId(type, base.surface, r);
      if (producedIds.has(id)) continue; // skip duplicates
      const document = buildDocument(base, r);
      const metadata = {
        surface: base.surface,
        type: type,
        lang: base.lang ?? "",
        jyutping: r.jyutping ?? "",
        toneOriginal: toNumberSafe(r.toneOriginal),
        toneMapped: toNumberSafe(r.toneMapped),
        syllables: r.syllables,
        pos: r.pos ?? "",
        register: r.register ?? "",
        freq: r.freq,
        source: r.source ?? "",
      } as Record<string, unknown>;

      out.push(JSON.stringify({ id, document, metadata }));
      producedIds.add(id);
    }
  }
  return out.join("\n");
}

async function main() {
  const charsIn = process.argv[2] || "data/normalized/normalized-chars.jsonl";
  const vocabIn = process.argv[3] || "data/normalized/normalized-vocab.jsonl";
  const charsOut = process.argv[4] || "data/vector/chroma-chars.jsonl";
  const vocabOut = process.argv[5] || "data/vector/chroma-vocab.jsonl";
  const allOut = process.argv[6] || "data/vector/chroma-all.jsonl";

  if (!existsSync(charsIn)) {
    console.error(`❌ Missing input file: ${charsIn}`);
    process.exit(1);
  }
  if (!existsSync(vocabIn)) {
    console.error(`❌ Missing input file: ${vocabIn}`);
    process.exit(1);
  }

  console.log(`🔄 Reading: ${charsIn}`);
  const charsRaw = readFileSync(charsIn, "utf-8");
  console.log(`🔄 Reading: ${vocabIn}`);
  const vocabRaw = readFileSync(vocabIn, "utf-8");

  console.log(`🧪 Converting chars -> Chroma JSONL`);
  const producedIds = new Set<string>();
  const charsChroma = toChromaJSONLines(charsRaw, "char", producedIds);

  console.log(`🧪 Converting vocab -> Chroma JSONL`);
  const vocabChroma = toChromaJSONLines(vocabRaw, "vocab", producedIds);

  ensureDirFor(charsOut);
  ensureDirFor(vocabOut);
  ensureDirFor(allOut);

  writeFileSync(charsOut, charsChroma + (charsChroma ? "\n" : ""), "utf-8");
  console.log(`✅ Wrote ${charsOut} (${charsChroma.split(/\n/).filter(Boolean).length} lines)`);

  writeFileSync(vocabOut, vocabChroma + (vocabChroma ? "\n" : ""), "utf-8");
  console.log(`✅ Wrote ${vocabOut} (${vocabChroma.split(/\n/).filter(Boolean).length} lines)`);

  const merged = [charsChroma, vocabChroma].filter(Boolean).join("\n");
  writeFileSync(allOut, merged + (merged ? "\n" : ""), "utf-8");
  console.log(`✅ Wrote ${allOut} (${merged.split(/\n/).filter(Boolean).length} lines)`);

  // Show a few samples
  const show = (label: string, s: string) => {
    const lines = s.split(/\n/).filter(Boolean);
    console.log(`\n📋 Sample (${label}):`);
    for (const [i, line] of lines.slice(0, 3).entries()) {
      try {
        const j = JSON.parse(line);
        console.log(`${i + 1}. id=${j.id} document=${j.document.substring(0, 80)}…`);
      } catch {
        console.log(`${i + 1}. ${line.substring(0, 80)}…`);
      }
    }
  };
  show("chars", charsChroma);
  show("vocab", vocabChroma);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
