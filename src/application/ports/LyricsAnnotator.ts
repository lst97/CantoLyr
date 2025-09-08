export type LineSemantics = {
  themes: string[]; // Traditional Chinese terms
  sentiment: 'VERY_NEGATIVE' | 'NEGATIVE' | 'NEUTRAL' | 'POSITIVE' | 'VERY_POSITIVE';
  keywords: string[]; // Traditional Chinese terms
};

export type LyricsAnnotatorInput = {
  title?: string;
  artists?: string[];
  lyricists?: string[];
  language?: string;
  lines: Array<{
    id: string;
    text: string;
    tokens?: Array<{ text: string }>; // optional: provide tokens to tag POS
  }>;
};

export type LyricsAnnotatorOutput = {
  songGenre: string[];
  lines: Array<{
    id: string;
    semantics: LineSemantics;
    tokens?: Array<{ text: string; pos: string }>; // UPPERCASE POS
    syntax_notes?: string; // brief Traditional Chinese notes
  }>;
};

export interface LyricsAnnotatorConfig {
  apiKey?: string;
  model?: string; // default: gemini-2.5-flash
  timeoutMs?: number; // default: 600000
  maxRetries?: number; // not used yet but kept for parity
  enableFallback?: boolean; // if true, may switch to a lighter model on rate limit
}

export interface LyricsAnnotator {
  annotate(input: LyricsAnnotatorInput): Promise<LyricsAnnotatorOutput>;
  validateConfig(): Promise<void>;
}
