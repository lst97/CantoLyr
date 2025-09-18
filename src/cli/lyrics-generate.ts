// lyrics-generate.ts (T040)
// CLI entry for generating one or more lines given tone sequences.
// Usage (Deno): deno run -A src/cli/lyrics-generate.ts \
//   --prompt "夕陽餘暉" --tones "12345,13524" --seed 42 --out session.json

import { parse } from "https://deno.land/std@0.202.0/flags/mod.ts";
import { load as loadEnv } from "jsr:@std/dotenv@0.224.0";
import SegmentationService from "../application/lyric/SegmentationService.ts";
import RetrievalService from "../application/lyric/RetrievalService.ts";
import GenerationService from "../application/lyric/GenerationService.ts";
import RankingService from "../application/lyric/RankingService.ts";
import SessionService, { SessionState } from "../application/lyric/SessionService.ts";
import { buildDefaultLinePipelineConfig } from "../application/lyric/default-config.ts";
import { saveToFile } from "../infrastructure/serialization/session-io.ts";

interface Args {
  prompt: string;
  tones: string; // comma separated sequences
  seed?: number;
  out?: string;
  json?: boolean; // output JSON to stdout
  top?: number; // number of top outputs (complete lyrics) to compose
}

function usage(): void {
  console.log("Cantonese Lyric Generator CLI\n");
  console.log("Required:");
  console.log("  --prompt <text>          High level scene/title prompt");
  console.log(
    "  --tones <seq[,seq...]>   Comma separated tone digit sequences (e.g. 123456,135246)",
  );
  console.log("Optional:");
  console.log("  --seed <n>               Seed for reproducibility");
  console.log("  --out <file>             Write JSON session export to file");
  console.log(
    "  --top <n>                Compose and include top-N full lyric outputs",
  );
  console.log("  --json                   Emit JSON export to stdout");
  console.log("  -h, --help               Show help");
}

if (import.meta.main) {
  try {
    // Load .env to populate DATABASE_URL, CHROMA_URL, GEMINI_API_KEY, etc.
    await loadEnv({ export: true });
    const raw = parse(Deno.args);
    if (raw.h || raw.help) {
      usage();
      Deno.exit(0);
    }
    const args: Args = {
      prompt: String(raw.prompt || ""),
      tones: String(raw.tones || ""),
      seed: raw.seed ? Number(raw.seed) : undefined,
      out: raw.out ? String(raw.out) : undefined,
      json: Boolean(raw.json),
      top: raw.top ? Number(raw.top) : undefined,
    };
    if (!args.prompt || !args.tones) {
      usage();
      console.error("Missing required --prompt or --tones");
      Deno.exit(1);
    }

    const seed = args.seed ?? Math.floor(Math.random() * 1_000_000);
    // Instantiate application services (direct, lightweight). In full system these come from DI container.
    const segmentation = new SegmentationService();
    const retrieval = new RetrievalService();
    const generation = new GenerationService();
    const ranking = new RankingService();
    const sessionService = new SessionService(
      segmentation,
      retrieval,
      generation,
      ranking,
    );

    const toneSequences = args.tones.split(",").map((s) => s.trim()).filter(
      Boolean,
    );
    const config = buildDefaultLinePipelineConfig();
    const sceneIntent = {
      title: args.prompt,
      emotions: [],
      microIntent: args.prompt,
      continuityNotes: "",
    };

    // Plan a coherent set of per-line story themes and sub-themes once
    const themePlan = await retrieval.generateStoryThemes(
      toneSequences.length,
      sceneIntent,
      toneSequences,
    );

    const state: SessionState = {
      sessionId: crypto.randomUUID(),
      seed,
      lines: [],
    };
    const previousLines: string[] = [];
    for (let i = 0; i < toneSequences.length; i++) {
      const toneSeq = toneSequences[i];
      // derive a deterministic per-line seed from session seed + tone sequence + index
      let perLineSeed = 1;
      {
        const s = `${seed}:${toneSeq}:${i}`;
        let h = 2166136261 >>> 0;
        for (let k = 0; k < s.length; k++) {
          h ^= s.charCodeAt(k);
          h = Math.imul(h, 16777619) >>> 0;
        }
        perLineSeed = (h & 0x7fffffff) + 1;
      }
      const lineResult = await sessionService.runLine(
        i,
        toneSeq,
        sceneIntent,
        config,
        previousLines,
        perLineSeed,
        themePlan[i]?.primary,
        themePlan[i]?.subThemes,
      );
      state.lines.push(lineResult);
      if (lineResult.topSentences[0]) {
        previousLines.push(lineResult.topSentences[0].text);
      }
    }

    // Optionally compose top-N complete lyric outputs using all lines' candidates
    const topN = args.top ?? 3;
    if (topN > 0) {
      const composed = await sessionService.composeParagraphs(
        state.lines,
        sceneIntent,
        config.ranking,
        topN,
      );
      state.topOutputs = composed.paragraphs;
    }

    if (args.out) {
      await saveToFile(state, args.out);
      console.log(`Session written to ${args.out}`);
    }
    if (args.json) {
      console.log(JSON.stringify(state, null, 2));
    } else if (!args.out) {
      // human-friendly summary
      for (const line of state.lines) {
        console.log(`Line ${line.lineIndex} (${line.toneSequence})`);
        if (line.error) console.log(`  ERROR: ${line.error}`);
        line.topSentences.forEach((ts) =>
          console.log(
            `  ${ts.finalRank}. ${ts.text} (score=${ts.mmrScore.toFixed(3)})`,
          )
        );
      }
      if (state.topOutputs && state.topOutputs.length) {
        console.log("\nTop outputs:");
        state.topOutputs.forEach((p, i) => {
          console.log(`\n#${i + 1}`);
          console.log(p);
        });
      }
    }
  } catch (err) {
    const msg = (err && typeof err === "object" && "message" in (err as any))
      ? (err as any).message
      : String(err);
    console.error("CLI failed:", msg);
    if (
      String(err).includes("Chroma collection") ||
      String(err).includes("ChromaNotFoundError")
    ) {
      console.error(
        "Hint: List collections with curl: curl -s ${Deno.env.get('CHROMA_URL') || 'http://localhost:8000'}/api/v1/collections | jq -r '.collections[].name'",
      );
      console.error(
        "Then set CHROMA_COLLECTION to one of the available names and re-run.",
      );
    }
    Deno.exit(1);
  }
}
