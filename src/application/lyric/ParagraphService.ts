// ParagraphService (Application Layer)
// Wraps domain paragraph assembly (beam search) for higher-level orchestration.

import { assembleParagraphs } from "../../domain/lyric/paragraph-assembly.ts";
import { LineResult, ParagraphVariant } from "../../domain/lyric/entities.ts";

export interface ParagraphRequest {
  lines: LineResult[];
  beamWidth: number;
}
export interface ParagraphResult {
  variants: ParagraphVariant[];
  primary?: ParagraphVariant;
}

export class ParagraphService {
  assemble(req: ParagraphRequest): ParagraphResult {
    const variants = assembleParagraphs(req.lines, req.beamWidth);
    return { variants, primary: variants[0] };
  }
}

export default ParagraphService;
