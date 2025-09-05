from __future__ import annotations

import argparse
from infrastructure.container import (
    build_crawl_song_usecase,
    build_crawl_first_singer_first_song_usecase,
    build_crawl_all_usecase,
    build_crawl_by_lyricist_usecase,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Lyrics crawler CLI")
    parser.add_argument("--site", required=True, choices=["feitsui"], help="Target site adapter")
    parser.add_argument("--out", required=True, help="Output path (file for single, directory for --crawl-all)")
    parser.add_argument(
        "--max-lines",
        nargs="?",
        const=None,
        type=int,
        default=None,
        help="Max number of lines to output (omit value for all)",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--song-url", help="Song page URL to crawl")
    group.add_argument("--singers-index", help="Singers index URL (crawl first singer -> first song or all)")
    parser.add_argument("--crawl-all", action="store_true", help="Crawl all singers and all songs (use --out as directory)")
    parser.add_argument("--crawl-tags", action="store_true", help="Crawl by lyricist tags from the index aside tags list")
    parser.add_argument("--delay", type=float, default=1.0, help="Delay seconds between songs (rate limiting)")
    parser.add_argument("--no-llm", action="store_true", help="Disable LLM semantics/POS (use defaults)")
    args = parser.parse_args()

    if args.song_url and not args.crawl_all:
        usecase = build_crawl_song_usecase(site=args.site, out_path=args.out, no_llm=args.no_llm)
        total = usecase.execute(song_url=args.song_url, max_lines=args.max_lines)
    elif args.singers_index and not args.crawl_all and not args.crawl_tags:
        usecase = build_crawl_first_singer_first_song_usecase(site=args.site, out_path=args.out, no_llm=args.no_llm)
        total = usecase.execute(singers_index_url=args.singers_index, max_lines=args.max_lines)
    else:
        if not args.singers_index:
            raise SystemExit("--singers-index is required when using --crawl-all or --crawl-tags")
        if args.crawl_all:
            usecase = build_crawl_all_usecase(site=args.site, out_dir=args.out, no_llm=args.no_llm, delay_sec=args.delay)
            total = usecase.execute(singers_index_url=args.singers_index, out_dir=args.out, max_lines=args.max_lines)
        else:
            usecase = build_crawl_by_lyricist_usecase(site=args.site, out_dir=args.out, no_llm=args.no_llm, delay_sec=args.delay)
            total = usecase.execute(singers_index_url=args.singers_index, out_dir=args.out, max_lines=args.max_lines)

    print(f"Crawled {total} line(s) -> {args.out}")


if __name__ == "__main__":
    main()
