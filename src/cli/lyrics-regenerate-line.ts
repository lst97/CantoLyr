// lyrics-regenerate-line.ts (T041)
// CLI to regenerate a single line from an existing session export.
// Usage: deno run -A src/cli/lyrics-regenerate-line.ts --session session.json --index 1 --seed 999 --json

import { parse } from "https://deno.land/std@0.202.0/flags/mod.ts";
import SegmentationService from "../application/lyric/SegmentationService.ts";
import RetrievalService from "../application/lyric/RetrievalService.ts";
import GenerationService from "../application/lyric/GenerationService.ts";
import RankingService from "../application/lyric/RankingService.ts";
import SessionService, { LinePipelineConfig } from "../application/lyric/SessionService.ts";
import { loadFromFile, saveToFile } from "../infrastructure/serialization/session-io.ts";

function buildDefaultConfig(): LinePipelineConfig {
  return {
    retrieval: { semanticTarget: 0.8, freqTop: 100, freqRandom: 50, minSemanticThreshold: 0.3 },
    generation: { variantsPerPattern: 5, maxRetriesPerSentence: 2 },
    ranking: { topKSize: 3, mmrLambda: 0.5, similarityThreshold: 0.7 },
  };
}

function usage(): void {
  console.log("Regenerate a specific line in a session export\n");
  console.log("Required:");
  console.log("  --session <file>   Path to existing session export JSON");
  console.log("  --index <n>        Line index to regenerate (0-based)");
  console.log("Optional:");
  console.log("  --seed <n>         New seed (placeholder, may affect future stochastic steps)");
  console.log("  --out <file>       Overwrite/write updated session export");
  console.log("  --json             Emit updated session to stdout");
  console.log("  -h, --help         Show help");
}

if (import.meta.main) {
  const raw = parse(Deno.args);
  if (raw.h || raw.help) {
    usage();
    Deno.exit(0);
  }
  const sessionPath = raw.session ? String(raw.session) : undefined;
  const index = raw.index !== undefined ? Number(raw.index) : undefined;
  if (!sessionPath || index === undefined || Number.isNaN(index)) {
    usage();
    console.error("Missing required --session or --index");
    Deno.exit(1);
  }
  const seed = raw.seed ? Number(raw.seed) : Math.floor(Math.random() * 1_000_000);

  loadFromFile(sessionPath).then(async (exp) => {
    if (index < 0 || index >= exp.lines.length) {
      console.error(`Index ${index} out of range (lines=${exp.lines.length})`);
      Deno.exit(1);
    }
    // Instantiate services
    const segmentation = new SegmentationService();
    const retrieval = new RetrievalService();
    const generation = new GenerationService();
    const ranking = new RankingService();
    const sessionService = new SessionService(segmentation, retrieval, generation, ranking);
    const config = buildDefaultConfig();
    const sceneIntent = {
      title: exp.meta.feature,
      emotions: [],
      microIntent: exp.meta.feature,
      continuityNotes: "",
    };
    const previousLines = exp.lines.filter((l) => l.lineIndex < index && l.topSentences[0]).map(
      (l) => l.topSentences[0].text,
    );
    const updated = await sessionService.regenerateLine(
      exp.lines[index],
      sceneIntent,
      config,
      previousLines,
      seed,
    );
    exp.lines[index] = updated;
    if (raw.out) {
      await saveToFile({ sessionId: crypto.randomUUID(), seed, lines: exp.lines, topOutputs: exp.topOutputs }, String(raw.out));
      console.log(`Updated session written to ${raw.out}`);
    }
    if (raw.json) {
      console.log(JSON.stringify(exp, null, 2));
    } else if (!raw.out) {
      console.log(`Regenerated line ${index}`);
      updated.topSentences.forEach((ts) =>
        console.log(`  ${ts.finalRank}. ${ts.text} (score=${ts.mmrScore.toFixed(3)})`)
      );
    }
  }).catch((err) => {
    console.error("Failed to load session:", err.message);
    Deno.exit(1);
  });
}
