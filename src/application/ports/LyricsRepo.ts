export interface LyricSongDTO {
  id: bigint;
  docId: string;
  title: string;
  year: number | null;
  artists?: string[];
  lyricists?: string[];
}

export interface LyricTokenDTO {
  position: number;
  text: string;
  pos?: string | null;
  syllables?: MatchedSyllableDTO[];
}

export interface LyricLineDTO {
  id: bigint;
  lyricId: string;
  song: LyricSongDTO;
  text: string;
  lineIndex: number;
  charCount: number;
  syllableCount: number;
  tokenCount: number;
  tonePatternText: string; // comma-joined mapped digits
  pronunciationBigrams?: Array<{ value: string; position: number }>; // optional echo
  matchedSyllables?: MatchedSyllableDTO[];
  tokens?: LyricTokenDTO[];
  syntaxNotes?: string | null;
  // For display/filters
  sentiment?: string | null;
  themes?: string[];
  keywords?: string[];
}

export interface MatchedSyllableDTO {
  position: number;
  jyutping: string;
  jyutpingNormalized?: string | null;
  consonant?: string | null;
  rhyme?: string | null;
  toneRaw?: number | null;
  toneDigit?: number | null;
}

export interface LyricSearchParams {
  // mapped tone bigram (pronunciation) like "03"
  pronunciation?: string;
  // optional position constraint (1-based start index)
  pronunciationPosition?: number;
  // rhyme token and optional position
  rhyme?: string;
  rhymePosition?: number;
  // metadata filters
  themes?: string[];
  keywords?: string[];
  lyricist?: string;
  artist?: string;
  id?: string; // lyricId
  sentiment?: string;
  year?: number;
  genres?: string[]; // future extension if genres are added to Song
  limit?: number;
  offset?: number;
}

export interface LyricFilterOptionsDTO {
  themes: string[];
  keywords: string[];
  lyricists: string[];
  artists: string[];
  years: number[];
  sentiments: string[];
}

export interface LyricsRepo {
  searchLyricLines(params: LyricSearchParams): Promise<LyricLineDTO[]>;
  countLyricLines(
    params: Omit<LyricSearchParams, "limit" | "offset">,
  ): Promise<number>;
  getLyricFilterOptions(): Promise<LyricFilterOptionsDTO>;
}
