import { PrismaClient } from "../../../../../prisma/generated/client.ts";
import type {
  LyricFilterOptionsDTO,
  LyricLineDTO,
  LyricSearchParams,
  LyricsRepo,
  LyricTokenDTO,
  MatchedSyllableDTO,
} from "../../../../application/ports/LyricsRepo.ts";

const TONE_DIGIT_MAP: Record<number, number> = { 1: 3, 2: 9, 3: 4, 4: 0, 5: 5, 6: 2 };
const TONE_RAW_PATTERN = /([1-6])$/u;
const HAN_REGEX = /\p{Script=Han}/u;
const LETTER_REGEX = /\p{Letter}/u;
const NUMBER_REGEX = /\p{Number}/u;

interface RhymeContext {
  clause: Record<string, unknown>;
  targets: Set<string>;
  position?: number;
  sequenceValue?: string;
  sequenceLength?: number;
  requireSequence: boolean;
  inputs: string[];
  variantGroups?: string[][];
}

function deriveToneValues(
  jyutping: string,
  rawValue?: number | null,
  digitValue?: number | null,
): { toneRaw: number | null; toneDigit: number | null } {
  const normalizedJyutping = typeof jyutping === "string" ? jyutping : "";
  const rawCandidate = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;

  if (rawCandidate && rawCandidate >= 1 && rawCandidate <= 6) {
    const mappedDigit = typeof digitValue === "number" && Number.isFinite(digitValue)
      ? digitValue
      : TONE_DIGIT_MAP[rawCandidate] ?? null;
    return { toneRaw: rawCandidate, toneDigit: mappedDigit ?? null };
  }

  const matched = TONE_RAW_PATTERN.exec(normalizedJyutping);
  const derivedRaw = matched ? Number(matched[1]) : null;
  const mappedDigit = derivedRaw !== null
    ? TONE_DIGIT_MAP[derivedRaw] ?? null
    : (typeof digitValue === "number" && Number.isFinite(digitValue) ? digitValue : null);

  return { toneRaw: derivedRaw, toneDigit: mappedDigit ?? null };
}

function isSyllabicChar(char: string): boolean {
  return HAN_REGEX.test(char) || LETTER_REGEX.test(char) || NUMBER_REGEX.test(char);
}

// Map syllables onto tokens in reading order so that multi-character tokens expose
// all contributing syllables. This relies on the corpus guarantee that every
// syllabic character (Han, letters, digits) is represented sequentially in the
// syllable list returned from the database.
function attachSyllablesToTokens(
  syllables: MatchedSyllableDTO[],
  rawTokens: Array<{ position: number; text: string; pos: string | null }>,
): LyricTokenDTO[] {
  if (rawTokens.length === 0) return [];

  const total = syllables.length;
  let cursor = 0;

  const mapped = rawTokens.map((token) => {
    const graphemes = Array.from(typeof token.text === "string" ? token.text : "");
    const syllabicCount = graphemes.reduce(
      (count, char) => count + (isSyllabicChar(char) ? 1 : 0),
      0,
    );

    const takeCount = Math.min(Math.max(syllabicCount, 0), Math.max(total - cursor, 0));
    const assigned = takeCount > 0 ? syllables.slice(cursor, cursor + takeCount) : [];
    cursor += assigned.length;

    const syllableList = assigned.length > 0 ? assigned : undefined;
    return {
      position: token.position,
      text: token.text,
      pos: token.pos,
      syllables: syllableList,
    } satisfies LyricTokenDTO;
  });

  if (cursor < total && mapped.length > 0) {
    const remainder = syllables.slice(cursor);
    for (let index = mapped.length - 1; index >= 0; index--) {
      const candidate = mapped[index];
      const existing = Array.isArray(candidate.syllables) ? candidate.syllables : [];
      if (existing.length > 0 || index === 0) {
        candidate.syllables = [...existing, ...remainder];
        break;
      }
    }
  }

  return mapped;
}

/**
 * Prisma implementation for Lyrics read operations (CQRS read side)
 */
export class LyricsReadRepository implements LyricsRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async searchLyricLines(params: LyricSearchParams): Promise<LyricLineDTO[]> {
    const {
      pronunciation,
      pronunciationPosition,
      rhyme,
      rhymePosition,
      rhymeSequence,
      themes,
      keywords,
      limit = 50,
      offset = 0,
    } = params;

    const rhymeContext = this.buildRhymeContext(rhyme, rhymePosition, rhymeSequence);
    const where = this.buildWhereClause(params, rhymeContext);

    const normalizedPronunciation = typeof pronunciation === "string" ? pronunciation.trim() : "";
    const toneLength = normalizedPronunciation.length;

    const rows = await this.prisma.lyricLine.findMany({
      where,
      include: {
        song: {
          select: {
            id: true,
            docId: true,
            title: true,
            year: true,
            artists: {
              include: { artist: { select: { name: true } } },
            },
            lyricists: {
              include: { lyricist: { select: { name: true } } },
            },
          },
        },
        toneNgrams: normalizedPronunciation
          ? {
            where: {
              value: normalizedPronunciation,
              ...(toneLength > 0 ? { n: toneLength } : {}),
              ...(pronunciationPosition ? { position: pronunciationPosition } : {}),
            },
            select: { value: true, position: true, n: true },
          }
          : false,
        themes: themes?.length ? { select: { theme: { select: { name: true } } } } : false,
        keywords: keywords?.length ? { select: { keyword: { select: { word: true } } } } : false,
        tokens: {
          orderBy: { position: "asc" },
          select: { position: true, text: true, pos: true },
        },
        syllables: {
          orderBy: { position: "asc" },
          select: {
            position: true,
            jyutping: true,
            jyutpingNormalized: true,
            consonant: true,
            rhyme: true,
            toneRaw: true,
            toneDigit: true,
            char: true,
          },
        },
        rhymeNgrams: rhymeContext?.sequenceValue
          ? {
            where: {
              value: rhymeContext.sequenceValue,
              ...(rhymeContext.sequenceLength ? { n: rhymeContext.sequenceLength } : {}),
              ...(typeof rhymeContext.position === "number"
                ? { position: rhymeContext.position }
                : {}),
            },
            select: { value: true, position: true, n: true },
          }
          : false,
      },
      orderBy: [{ songId: "asc" }, { lineIndex: "asc" }],
      take: limit,
      skip: offset,
    });

    return rows.map((r) => {
      const allSyllablesRaw = Array.isArray(r.syllables) ? r.syllables : [];
      const allSyllables: MatchedSyllableDTO[] = allSyllablesRaw.map((s) => {
        const { toneRaw, toneDigit } = deriveToneValues(s.jyutping, s.toneRaw, s.toneDigit);
        return {
          position: s.position,
          jyutping: s.jyutping,
          jyutpingNormalized: s.jyutpingNormalized ?? null,
          consonant: s.consonant ?? null,
          rhyme: s.rhyme ?? null,
          toneRaw,
          toneDigit,
          char: typeof s.char === "string" && s.char.length > 0 ? s.char : null,
        } satisfies MatchedSyllableDTO;
      });
      const matchedSyllables = rhymeContext
        ? allSyllables.filter((s) => {
          const key = (s.rhyme ?? s.jyutpingNormalized ?? "").toLowerCase();
          if (!key || !rhymeContext.targets.has(key)) {
            return false;
          }
          if (
            typeof rhymeContext.position === "number" &&
            s.position !== rhymeContext.position
          ) {
            return false;
          }
          return true;
        })
        : undefined;
      const tokens: LyricTokenDTO[] | undefined = Array.isArray(r.tokens)
        ? attachSyllablesToTokens(
          allSyllables,
          r.tokens.map((t) => ({
            position: t.position,
            text: t.text,
            pos: t.pos ?? null,
          })),
        )
        : undefined;
      const toneMatches = Array.isArray(r.toneNgrams)
        ? r.toneNgrams.map((t) => {
          const length = typeof t.n === "number" && Number.isFinite(t.n) ? Math.trunc(t.n) : 0;
          const normalizedLength = length > 0 ? length : Math.max(t.value?.length ?? 0, 0);
          const upperBound = t.position + normalizedLength;
          const slice = allSyllables.filter((s) =>
            s.position >= t.position && s.position < upperBound
          );
          const characters = slice.map((s) => s.char ?? "").join("");
          return {
            value: t.value,
            position: t.position,
            length: normalizedLength,
            characters: characters.length > 0 ? characters : undefined,
          };
        }).filter((match) => match.length > 0 && typeof match.position === "number")
        : undefined;
      const rhymeMatches = Array.isArray(r.rhymeNgrams)
        ? r.rhymeNgrams.map((ngram) => {
          const length = typeof ngram.n === "number" && Number.isFinite(ngram.n)
            ? Math.trunc(ngram.n)
            : 0;
          const normalizedLength = length > 0
            ? length
            : Math.max(ngram.value?.split(",").length ?? 0, 0);
          const upperBound = ngram.position + normalizedLength;
          const slice = allSyllables.filter((s) =>
            s.position >= ngram.position && s.position < upperBound
          );
          const characters = slice.map((s) => s.char ?? "").join("");
          return {
            value: ngram.value,
            position: ngram.position,
            length: normalizedLength,
            characters: characters.length > 0 ? characters : undefined,
          };
        }).filter((match) => match.length > 0 && typeof match.position === "number")
        : undefined;
      const syntaxNotesRaw = typeof r.syntaxNotes === "string" ? r.syntaxNotes.trim() : null;
      const syntaxNotes = syntaxNotesRaw && syntaxNotesRaw.length > 0 ? syntaxNotesRaw : null;

      return {
        id: r.id,
        lyricId: r.lyricId,
        song: {
          id: r.song.id,
          docId: r.song.docId,
          title: r.song.title,
          year: r.song.year,
          artists: Array.isArray(r.song.artists)
            ? r.song.artists
              .map((entry) => entry?.artist?.name)
              .filter((name): name is string => Boolean(name))
            : undefined,
          lyricists: Array.isArray(r.song.lyricists)
            ? r.song.lyricists
              .map((entry) => entry?.lyricist?.name)
              .filter((name): name is string => Boolean(name))
            : undefined,
        },
        text: r.text,
        lineIndex: r.lineIndex,
        charCount: r.charCount,
        syllableCount: r.syllableCount,
        tokenCount: r.tokenCount,
        tonePatternText: r.tonePatternText,
        pronunciationBigrams: toneMatches && toneMatches.length > 0 ? toneMatches : undefined,
        rhymeMatches: rhymeMatches && rhymeMatches.length > 0 ? rhymeMatches : undefined,
        tokens,
        syntaxNotes,
        matchedSyllables: matchedSyllables && matchedSyllables.length > 0
          ? matchedSyllables
          : undefined,
        sentiment: r.sentiment,
        themes: Array.isArray(r.themes) ? r.themes.map((t: any) => t.theme.name) : undefined,
        keywords: Array.isArray(r.keywords)
          ? r.keywords.map((k: any) => k.keyword.word)
          : undefined,
        normalization: {
          isValid: Boolean(r.normalizationIsValid),
          originalText: r.normalizationOriginalText ?? null,
          notes: r.normalizationNotes ?? null,
        },
      } satisfies LyricLineDTO;
    });
  }
  async countLyricLines(
    params: Omit<LyricSearchParams, "limit" | "offset">,
  ): Promise<number> {
    const rhymeContext = this.buildRhymeContext(
      params.rhyme,
      params.rhymePosition,
      params.rhymeSequence,
    );
    const where = this.buildWhereClause(params, rhymeContext);
    return await this.prisma.lyricLine.count({ where });
  }

  async getLyricFilterOptions(): Promise<LyricFilterOptionsDTO> {
    const [themeRows, keywordRows, lyricistRows, artistRows, songRows, sentimentRows] =
      await Promise.all([
        this.prisma.theme.findMany({ select: { name: true } }),
        this.prisma.keyword.findMany({ select: { word: true } }),
        this.prisma.lyricist.findMany({ select: { name: true } }),
        this.prisma.artist.findMany({ select: { name: true } }),
        this.prisma.song.findMany({ select: { year: true } }),
        this.prisma.lyricLine.findMany({ select: { sentiment: true } }),
      ]);

    const toSortedUniqueStrings = (values: Array<string | null | undefined>): string[] =>
      Array.from(
        new Set(
          values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)),
        ),
      ).sort((a, b) => a.localeCompare(b));

    const themes = toSortedUniqueStrings(themeRows.map((row) => row.name));
    const keywords = toSortedUniqueStrings(keywordRows.map((row) => row.word));
    const lyricists = toSortedUniqueStrings(lyricistRows.map((row) => row.name));
    const artists = toSortedUniqueStrings(artistRows.map((row) => row.name));

    const years = Array.from(
      new Set(
        songRows
          .map((row) => row.year)
          .filter((year): year is number => typeof year === "number" && Number.isFinite(year)),
      ),
    ).sort((a, b) => a - b);

    const sentiments = toSortedUniqueStrings(
      sentimentRows.map((row: { sentiment: string | null }) => row.sentiment),
    );

    return { themes, keywords, lyricists, artists, years, sentiments };
  }

  private buildWhereClause(
    params: LyricSearchParams,
    rhymeContext?: RhymeContext,
  ): Record<string, unknown> | undefined {
    const {
      limit: _limit,
      offset: _offset,
      pronunciation,
      pronunciationPosition,
      themes,
      keywords,
      lyricist,
      artist,
      id,
      sentiment,
      year,
    } = params;

    const and: Array<Record<string, unknown>> = [{ normalizationIsValid: true }];
    if (id) and.push({ lyricId: id });
    if (sentiment) and.push({ sentiment });

    if (Array.isArray(themes) && themes.length) {
      and.push({ themes: { some: { theme: { name: { in: themes } } } } });
    }
    if (Array.isArray(keywords) && keywords.length) {
      and.push({ keywords: { some: { keyword: { word: { in: keywords } } } } });
    }

    const normalizedPronunciation = typeof pronunciation === "string" ? pronunciation.trim() : "";

    if (normalizedPronunciation.length > 0) {
      const toneLength = normalizedPronunciation.length;
      and.push({
        toneNgrams: {
          some: {
            value: normalizedPronunciation,
            ...(toneLength > 0 ? { n: toneLength } : {}),
            ...(pronunciationPosition ? { position: pronunciationPosition } : {}),
          },
        },
      });
    }

    const syllableClause = rhymeContext?.clause;
    const hasMultiInclusive = Boolean(
      rhymeContext &&
        !rhymeContext.requireSequence &&
        Array.isArray(rhymeContext.inputs) &&
        rhymeContext.inputs.length > 1,
    );

    if (syllableClause && !hasMultiInclusive) {
      and.push({ syllables: { some: syllableClause } });
    }

    if (hasMultiInclusive && rhymeContext && Array.isArray(rhymeContext.variantGroups)) {
      const normalizedPosition = typeof rhymeContext.position === "number" &&
          Number.isFinite(rhymeContext.position)
        ? rhymeContext.position
        : undefined;

      for (const variants of rhymeContext.variantGroups) {
        if (!Array.isArray(variants) || variants.length === 0) continue;
        const orClauses = variants.flatMap((variant) => [
          { rhyme: variant },
          { jyutpingNormalized: variant },
        ]);
        if (orClauses.length === 0) continue;

        const perInputClause: Record<string, unknown> = { OR: orClauses };
        if (normalizedPosition !== undefined) {
          perInputClause.position = normalizedPosition;
        }

        and.push({ syllables: { some: perInputClause } });
      }
    }

    if (rhymeContext?.requireSequence && rhymeContext.sequenceValue) {
      and.push({
        rhymeNgrams: {
          some: {
            value: rhymeContext.sequenceValue,
            ...(rhymeContext.sequenceLength ? { n: rhymeContext.sequenceLength } : {}),
            ...(typeof rhymeContext.position === "number"
              ? { position: rhymeContext.position }
              : {}),
          },
        },
      });
    }

    if (artist) {
      and.push({ song: { artists: { some: { artist: { name: artist } } } } });
    }
    if (lyricist) {
      and.push({
        song: { lyricists: { some: { lyricist: { name: lyricist } } } },
      });
    }
    if (typeof year === "number") {
      and.push({ song: { year } });
    }

    return and.length ? { AND: and } : undefined;
  }

  private buildRhymeContext(
    rhyme?: string | string[],
    rhymePosition?: number,
    requireSequence?: boolean,
  ): RhymeContext | undefined {
    const rawInputs = Array.isArray(rhyme)
      ? rhyme
      : typeof rhyme === "string"
      ? rhyme.split(",")
      : [];

    const normalizedInputs = rawInputs
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0);

    if (normalizedInputs.length === 0) {
      return undefined;
    }

    const targets = new Set<string>();
    const variantGroups: string[][] = [];
    for (const input of normalizedInputs) {
      const variants = new Set<string>();
      variants.add(input);
      const withoutTone = input.replace(/\d+$/u, "");
      if (withoutTone.length > 0) {
        variants.add(withoutTone);
      }
      for (const variant of variants) {
        targets.add(variant);
      }
      variantGroups.push(Array.from(variants));
    }

    const clauses = Array.from(targets).flatMap((target) => [
      { rhyme: target },
      { jyutpingNormalized: target },
    ]);

    if (clauses.length === 0) {
      return undefined;
    }

    const clause: Record<string, unknown> = { OR: clauses };
    const normalizedPosition = typeof rhymePosition === "number" && Number.isFinite(rhymePosition)
      ? rhymePosition
      : undefined;
    if (typeof normalizedPosition === "number") {
      clause.position = normalizedPosition;
    }

    const sequenceValue = requireSequence ? normalizedInputs.join(",") : undefined;
    const hasSequence = Boolean(requireSequence && sequenceValue && sequenceValue.length > 0);

    return {
      clause,
      targets,
      position: normalizedPosition,
      sequenceValue: hasSequence ? sequenceValue : undefined,
      sequenceLength: hasSequence ? normalizedInputs.length : undefined,
      requireSequence: hasSequence,
      inputs: normalizedInputs,
      variantGroups: variantGroups.length > 0 ? variantGroups : undefined,
    };
  }
}
