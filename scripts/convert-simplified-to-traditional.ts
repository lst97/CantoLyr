import { promises as fs } from "fs";
import path from "path";
import process from "process";
// @ts-ignore Ignore the type error for chinese-conv, no types are provided
import chineseConv from "chinese-conv";

async function convertFile(inputPath: string, outputPath?: string) {
	const absIn = path.resolve(inputPath);
	const raw = await fs.readFile(absIn, "utf8");

	// Convert entire file text to Traditional Chinese.
	// This avoids assumptions about JSON structure while preserving formatting.
	const converted = chineseConv.tify(raw);

	const outPath = outputPath
		? path.resolve(outputPath)
		: path.join(
				path.dirname(absIn),
				path.basename(absIn).replace(/\.json$/i, ".json")
		  );

	await fs.writeFile(outPath, converted, "utf8");
	return { in: absIn, out: outPath };
}

async function main() {
	const argv = process.argv.slice(2);
	const inPlace = argv.includes("--in-place") || argv.includes("-i");
	const args = argv.filter((a) => !a.startsWith("-"));

	const targets = args.length
		? args
		: [
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

main().catch((err) => {
	console.error("Conversion failed:", err);
	process.exit(1);
});
