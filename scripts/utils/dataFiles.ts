import { readFileSync } from "node:fs";

export function parseConcatenatedJsonObjects(raw: string): any[] {
  const objs: string[] = [];
  let depth = 0, inStr = false, esc = false, start = -1;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && start >= 0) {
          objs.push(raw.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return objs.map((s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

export function loadCharDetail(filePath: string): Map<string, string> {
  type CharDetailItem = {
    char: string;
    pronunciations?: Array<{ explanations?: Array<{ content?: string }> }>;
  };
  const raw = readFileSync(filePath, "utf-8");
  let items: CharDetailItem[] = [];
  try {
    const parsed = JSON.parse(raw);
    items = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    items = parseConcatenatedJsonObjects(raw) as CharDetailItem[];
  }
  const map = new Map<string, string>();
  for (const item of items) {
    if (!item || typeof item.char !== "string") continue;
    const contents: string[] = [];
    for (const p of item.pronunciations || []) {
      for (const ex of p.explanations || []) {
        if (ex && typeof ex.content === "string" && ex.content.trim()) {
          contents.push(ex.content.trim());
        }
      }
    }
    if (contents.length) map.set(item.char, contents.join("； "));
  }
  return map;
}

export function loadWordDetail(filePath: string): Map<string, string> {
  type WordDetailItem = { word: string; explanation?: string };
  const raw = readFileSync(filePath, "utf-8");
  let items: WordDetailItem[] = [];
  try {
    const parsed = JSON.parse(raw);
    items = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    items = parseConcatenatedJsonObjects(raw) as WordDetailItem[];
  }
  const map = new Map<string, string>();
  for (const item of items) {
    if (!item || typeof item.word !== "string") continue;
    const gloss = (item.explanation || "").trim();
    if (gloss) map.set(item.word, gloss);
  }
  return map;
}

export function loadCharFrequency(filePath: string): Map<string, number> {
  type CharFreqItem = { [k: string]: any };
  const raw = readFileSync(filePath, "utf-8");
  let items: CharFreqItem[] = [];
  try {
    const parsed = JSON.parse(raw);
    items = Array.isArray(parsed) ? (parsed as CharFreqItem[]) : [parsed as CharFreqItem];
  } catch {
    const objs = parseConcatenatedJsonObjects(raw);
    items = objs.filter(Boolean) as CharFreqItem[];
  }
  const freqMap = new Map<string, number>();
  for (const it of items) {
    const char = (it["character"] ?? it["char"] ?? it["surface"]) as
      | string
      | undefined;
    if (!char || typeof char !== "string") continue;
    let freq: number | undefined = undefined;
    const keys = Object.keys(it);
    const perMillionKey = keys.find((k) =>
      k.toLowerCase().includes("frequency") ||
      k.toLowerCase().includes("ferquency")
    );
    if (perMillionKey && typeof it[perMillionKey] === "number") {
      freq = it[perMillionKey] as number;
    } else if (typeof it["token"] === "number") {
      freq = it["token"] as number;
    }
    if (typeof freq === "number") freqMap.set(char, freq);
  }
  return freqMap;
}

// Parse word raw counts and convert to per-million frequencies.
export function loadWordFreqPerMillion(filePath: string): Map<string, number> {
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split(/\r?\n/);
  const pairs: Array<{ w: string; c: number }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (
      trimmed.startsWith("//") || trimmed.startsWith("/*") ||
      trimmed.startsWith("*")
    ) continue;
    const clean = trimmed.replace(/[;,]$/, "");
    const match = clean.match(/^(.*?)\s+(\d+(?:\.\d+)?)(?:\s*)$/);
    if (match) {
      const w = match[1]?.trim();
      const c = Number(match[2]);
      if (w && Number.isFinite(c)) pairs.push({ w, c });
    }
  }

  if (pairs.length === 0) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const it of parsed as any[]) {
          if (!it) continue;
          const w = (it.word ?? it.surface ?? it.w ?? it[0]) as
            | string
            | undefined;
          const c = (it.count ?? it.freq ?? it.c ?? it[1]) as
            | number
            | undefined;
          if (
            typeof w === "string" && typeof c === "number" && Number.isFinite(c)
          ) {
            pairs.push({ w, c });
          }
        }
      } else if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed as Record<string, any>)) {
          const c = Number(v);
          if (k && Number.isFinite(c)) pairs.push({ w: k, c });
        }
      }
    } catch {
      // ignore
    }
  }

  if (pairs.length === 0) return new Map();
  const total = pairs.reduce((acc, p) => acc + p.c, 0);
  if (!Number.isFinite(total) || total <= 0) return new Map();

  const map = new Map<string, number>();
  for (const { w, c } of pairs) {
    if (typeof w === "string" && w.length > 1) {
      const perMillion = (c / total) * 1_000_000;
      map.set(w, perMillion);
    }
  }
  return map;
}

export function loadCoarseSentimentMap(filePath: string): Map<string, string> {
  const raw = readFileSync(filePath, "utf-8");
  const map = new Map<string, string>();
  try {
    const obj = JSON.parse(raw) as Record<string, any>;
    for (const [k, v] of Object.entries(obj)) {
      const keyUpper = k.toUpperCase();
      if (Array.isArray(v)) {
        for (const term of v) {
          if (typeof term === "string" && term.trim()) {
            map.set(term.trim(), keyUpper);
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return map;
}

export function loadDetailedSentimentMaps(
  filePath: string,
): { regMap: Map<string, string>; posMap: Map<string, string> } {
  const raw = readFileSync(filePath, "utf-8");
  const regMap = new Map<string, string>();
  const posMap = new Map<string, string>();
  try {
    const arr = JSON.parse(raw) as Array<Record<string, any>>;
    if (Array.isArray(arr)) {
      for (const it of arr) {
        if (!it) continue;
        const w = (it["詞語"] ?? it["word"] ?? it["surface"]) as
          | string
          | undefined;
        if (typeof w !== "string" || !w.trim()) continue;
        const reg = (it["情感分類"] ?? it["register"]) as string | undefined;
        const pos = (it["詞性種類"] ?? it["pos"]) as string | undefined;
        if (typeof reg === "string" && reg.trim()) {
          regMap.set(w.trim(), reg.trim().toUpperCase());
        }
        if (typeof pos === "string" && pos.trim()) {
          posMap.set(w.trim(), pos.trim().toUpperCase());
        }
      }
    }
  } catch {
    // ignore
  }
  return { regMap, posMap };
}
