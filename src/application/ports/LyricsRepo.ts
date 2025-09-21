export interface LyricLineDTO {
  id: bigint;
  lyricId: string;
  song: { id: bigint; docId: string; title: string; year: number | null };
  text: string;
  lineIndex: number;
  charCount: number;
  syllableCount: number;
  tokenCount: number;
  tonePatternText: string; // comma-joined mapped digits
  pronunciationBigrams?: Array<{ value: string; position: number }>; // optional echo
  // For display/filters
  sentiment?: string | null;
  themes?: string[];
  keywords?: string[];
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

export interface LyricsRepo {
  searchLyricLines(params: LyricSearchParams): Promise<LyricLineDTO[]>;
  countLyricLines(
    params: Omit<LyricSearchParams, "limit" | "offset">,
  ): Promise<number>;
}
