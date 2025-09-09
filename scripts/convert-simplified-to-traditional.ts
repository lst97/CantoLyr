import { readTextFile, writeTextFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "std/path/mod.ts";
import chineseConv from "chinese-conv";

async function convertFile(inputPath: string, outputPath?: string) {
  const absIn = resolve(inputPath);
  const raw = await readTextFile(absIn, { encoding: "utf8" as any });

  // Convert entire file text to Traditional Chinese.
  // This avoids assumptions about JSON structure while preserving formatting.
  const converted = chineseConv.tify(raw);

  const outPath = outputPath ? resolve(outputPath) : join(
    dirname(absIn),
    basename(absIn).replace(/\.json$/i, ".json"),
  );

  await writeTextFile(outPath, converted, { encoding: "utf8" as any });
  return { in: absIn, out: outPath };
}

async function main() {
  const argv = [...Deno.args];
  const inPlace = argv.includes("--in-place") || argv.includes("-i");
  const args = argv.filter((a) => !a.startsWith("-"));

  const targets = args.length ? args : [
    "data/sample/word_detail.json",
    "data/sample/char_detail.json",
    "data/sample/char_freq.json",
  ];

  const results: Array<{ in: string; out: string }> = [];
  for (const t of targets) {
    const res = await convertFile(t, inPlace ? t : undefined);
    results.push(res);
  }

  for (const r of results) {
    console.log(`Converted: ${r.in} -> ${r.out}`);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Conversion failed:", err);
    Deno.exit(1);
  });
}
