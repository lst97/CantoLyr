import { PrismaClient } from "../../../../../prisma/generated/client.ts";
import type {
  LyricLineDTO,
  LyricSearchParams,
  LyricsRepo,
} from "../../../../application/ports/LyricsRepo.ts";

/**
 * Prisma implementation for Lyrics read operations (CQRS read side)
 */
export class LyricsReadRepository implements LyricsRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async searchLyricLines(params: LyricSearchParams): Promise<LyricLineDTO[]> {
    const {
      pronunciation,
      pronunciationPosition,
      themes,
      keywords,
      limit = 50,
      offset = 0,
    } = params;

    const where = this.buildWhereClause(params);

    const rows = await (this.prisma as any).lyricLine.findMany({
      where,
      include: {
        song: { select: { id: true, docId: true, title: true, year: true } },
        toneNgrams: pronunciation
          ? {
            where: {
              n: 2,
              value: pronunciation,
              ...(pronunciationPosition ? { position: pronunciationPosition } : {}),
            },
            select: { value: true, position: true },
          }
          : false,
        themes: themes?.length ? { include: { theme: true } } : false,
      keywords: keywords?.length ? { include: { keyword: true } } : false,
      },
      orderBy: [{ songId: "asc" }, { lineIndex: "asc" }],
      take: limit,
      skip: offset,
    });

    return rows.map((r: any) => ({
      id: r.id,
      lyricId: r.lyricId,
      song: r.song,
      text: r.text,
      lineIndex: r.lineIndex,
      charCount: r.charCount,
      syllableCount: r.syllableCount,
      tokenCount: r.tokenCount,
      tonePatternText: r.tonePatternText,
      pronunciationBigrams: Array.isArray(r.toneNgrams)
        ? r.toneNgrams.map((t: any) => ({
          value: t.value,
          position: t.position,
        }))
        : undefined,
      sentiment: r.sentiment,
      themes: Array.isArray(r.themes) ? r.themes.map((t: any) => t.theme.name) : undefined,
      keywords: Array.isArray(r.keywords) ? r.keywords.map((k: any) => k.keyword.word) : undefined,
    }));
  }

  async countLyricLines(
    params: Omit<LyricSearchParams, "limit" | "offset">,
  ): Promise<number> {
    const where = this.buildWhereClause(params);
    return await (this.prisma as any).lyricLine.count({ where });
  }

  private buildWhereClause(params: LyricSearchParams): any {
    const {
      limit: _limit,
      offset: _offset,
      pronunciation,
      pronunciationPosition,
      rhyme,
      rhymePosition,
      themes,
      keywords,
      lyricist,
      artist,
      id,
      sentiment,
      year,
    } = params;

    const and: any[] = [];
    if (id) and.push({ lyricId: id });
    if (sentiment) and.push({ sentiment });

    if (Array.isArray(themes) && themes.length) {
      and.push({ themes: { some: { theme: { name: { in: themes } } } } });
    }
    if (Array.isArray(keywords) && keywords.length) {
      and.push({ keywords: { some: { keyword: { word: { in: keywords } } } } });
    }

    if (pronunciation) {
      and.push({
        toneNgrams: {
          some: {
            n: 2,
            value: pronunciation,
            ...(pronunciationPosition ? { position: pronunciationPosition } : {}),
          },
        },
      });
    }

    if (rhyme) {
      and.push({
        syllables: {
          some: {
            rhyme,
            ...(rhymePosition ? { position: rhymePosition } : {}),
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
}
