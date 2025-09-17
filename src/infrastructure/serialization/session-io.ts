// session-io.ts (T042)
// Utility helpers to export/import lyric generation session state to/from JSON.
// Keeps format stable for examples and reproducibility tests.

import type { LinePipelineResult, SessionState } from "../../application/lyric/SessionService.ts";

export interface SessionExportMeta {
  feature: string; // feature name or spec id
  version: number; // schema version
  createdAt: string; // ISO timestamp
  seed: number;
  lineCount: number;
}

export interface SessionExport {
  meta: SessionExportMeta;
  lines: LinePipelineResult[];
  topOutputs?: string[];
}

export function toExport(
  state: SessionState,
  feature = "lyrics-generation",
): SessionExport {
  return {
    meta: {
      feature,
      version: 1,
      createdAt: new Date().toISOString(),
      seed: state.seed,
      lineCount: state.lines.length,
    },
    lines: state.lines,
    topOutputs: state.topOutputs,
  };
}

export function serialize(state: SessionState, feature?: string): string {
  return JSON.stringify(toExport(state, feature), null, 2);
}

export function saveToFile(state: SessionState, path: string, feature?: string): Promise<void> {
  const data = serialize(state, feature);
  return Deno.writeTextFile(path, data);
}

export async function loadFromFile(path: string): Promise<SessionExport> {
  const txt = await Deno.readTextFile(path);
  const parsed = JSON.parse(txt);
  // Basic shape validation (lightweight to avoid zod runtime cost here)
  if (!parsed?.meta || !Array.isArray(parsed?.lines)) {
    throw new Error("Invalid session export format");
  }
  return parsed as SessionExport;
}
