import { basename, dirname, join, resolve } from "jsr:@std/path";
import * as OpenCC from "opencc-js";
import { getLogger } from "jsr:@std/log";

const logger = getLogger();

async function convertFile(inputPath: string, outputPath?: string) {
  const absIn = resolve(inputPath);
  const raw = await Deno.readTextFile(absIn);

  // Initialize the converter for Simplified Chinese to Traditional Chinese (s2t.json).
  const converter = OpenCC.Converter({ from: "cn", to: "hk" });
  const converted = converter(raw);

  const outPath = outputPath
    ? resolve(outputPath)
    : join(dirname(absIn), basename(absIn).replace(/\.json$/i, ".json"));

  await Deno.writeTextFile(outPath, converted);
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
    logger.info(`Converted: ${r.in} -> ${r.out}`);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error("Conversion failed:", err);
    Deno.exit(1);
  });
}
