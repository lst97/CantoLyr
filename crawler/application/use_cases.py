from __future__ import annotations

from datetime import datetime
import time
from pathlib import Path
from typing import List, Optional, Iterable
import base64
import re

from domain.entities import Lyric
from domain.ports import CrawlerPort, TokenizerPort, AnnotatorPort, StoragePort
from shared.utils import slugify, stable_id


def _now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _count_chars_zh(text: str) -> int:
    return len("".join(ch for ch in text if not ch.isspace()))


def _tone_from_jp(syl: str) -> int:
    import re

    m = re.search(r"(\d)$", syl)
    if not m:
        return 0
    tone = int(m.group(1))
    mapping = {1: 3, 2: 9, 3: 4, 4: 0, 5: 5, 6: 2}
    return mapping.get(tone, 0)


def _b64url(s: str) -> str:
    return base64.urlsafe_b64encode(s.encode("utf-8")).decode("ascii").rstrip("=")


def _derive_file_id(meta: dict, song_url: str) -> str:
    raw_sid = (meta.get("song_id") or "").strip()
    digits_sid = "".join(ch for ch in raw_sid if ch.isdigit())
    if digits_sid:
        return digits_sid
    m = re.search(r"(\d+)(?:\D*)$", song_url)
    if m:
        return m.group(1)
    return stable_id(song_url)


def _build_docs(
    *,
    meta: dict,
    rows: list,
    tokenizer: TokenizerPort,
    annotator: AnnotatorPort,
    storage: StoragePort,
    song_url: str,
    out_prefix: str,
    song_file_id: str,
    max_lines: Optional[int] = None,
) -> int:
    count = 0
    docs: List[Lyric] = []
    for i, row in enumerate(rows, start=1):
        if max_lines and count >= max_lines:
            break
        text = row["text_zh"]
        tokens = tokenizer.tokenize(text)
        semantics, nlp_tokens, syntax_notes = annotator.annotate(text=text, tokens=tokens)
        tone_pattern = [_tone_from_jp(s) for s in row["jyutping_tokens"]]
        song_enc = _b64url(song_file_id)
        artist_name = " ".join(meta.get("artists", [])) if meta.get("artists") else "unknown"
        artist_enc = _b64url(artist_name)
        line_id = f"{out_prefix}_{artist_enc}_{song_enc}_{i:04d}"
        doc: Lyric = {
            "id": line_id,
            "text": text,
            "structure": {
                "line_index": row["line_index"],
                "char_count": _count_chars_zh(text),
            },
            "semantics": {
                "themes": semantics.get("themes", []),
                "sentiment": semantics.get("sentiment", "neutral"),
                "keywords": semantics.get("keywords", []),
            },
            "prosody": {
                "tone_pattern": tone_pattern,
                "tone_pattern_cantonese_jyutping": row["jyutping_tokens"],
            },
            "nlp": {
                "tokens": nlp_tokens,
                "syntax_notes": syntax_notes,
            },
            "source": {
                    "title": meta.get("title", ""),
                    "artists": meta.get("artists", []),
                    "lyricists": meta.get("lyricists", []),
                    "year": 0,
                    "genre": [],
                },
            "context_links": {
                "doc_id": meta.get("doc_id", meta.get("song_id", "")) or "",
                "prev_line_id": None,  # fill below
                "next_line_id": None,  # fill below
                "paragraph_id": row["paragraph_id"],
            },
        }
        docs.append(doc)
        count += 1

    # link prev/next
    for idx, doc in enumerate(docs):
        doc["context_links"]["prev_line_id"] = docs[idx - 1]["id"] if idx > 0 else None
        doc["context_links"]["next_line_id"] = docs[idx + 1]["id"] if idx < len(docs) - 1 else None

    for doc in docs:
        storage.save(doc)
    return count


class CrawlSingleSongUseCase:
    def __init__(
        self,
        *,
        crawler: CrawlerPort,
        tokenizer: TokenizerPort,
        annotator: AnnotatorPort,
        storage: StoragePort,
    ) -> None:
        self.crawler = crawler
        self.tokenizer = tokenizer
        self.annotator = annotator
        self.storage = storage

    def execute(self, *, song_url: str, out_prefix: str = "lyr", max_lines: Optional[int] = None) -> int:
        meta, rows = self.crawler.extract_song(song_url)
        return _build_docs(
            meta=meta,
            rows=rows,
            tokenizer=self.tokenizer,
            annotator=self.annotator,
            storage=self.storage,
            song_url=song_url,
            out_prefix=out_prefix,
            song_file_id=_derive_file_id(meta, song_url),
            max_lines=max_lines,
        )


class CrawlFirstSingerFirstSongUseCase:
    def __init__(
        self,
        *,
        crawler: CrawlerPort,
        tokenizer: TokenizerPort,
        annotator: AnnotatorPort,
        storage: StoragePort,
    ) -> None:
        self.crawler = crawler
        self.tokenizer = tokenizer
        self.annotator = annotator
        self.storage = storage

    def execute(self, *, singers_index_url: str, out_prefix: str = "lyr", max_lines: Optional[int] = None) -> int:
        singers = self.crawler.discover_singers(singers_index_url)
        if not singers:
            return 0
        _singer_name, singer_url = singers[0]
        songs = self.crawler.discover_songs(singer_url)
        if not songs:
            return 0
        _song_title, song_url = songs[0]
        meta, rows = self.crawler.extract_song(song_url)
        return _build_docs(
            meta=meta,
            rows=rows,
            tokenizer=self.tokenizer,
            annotator=self.annotator,
            storage=self.storage,
            song_url=song_url,
            out_prefix=out_prefix,
            song_file_id=_derive_file_id(meta, song_url),
            max_lines=max_lines,
        )


class CrawlAllSongsUseCase:
    def __init__(
        self,
        *,
        crawler: CrawlerPort,
        tokenizer: TokenizerPort,
        annotator: AnnotatorPort,
        storage_factory,
        state_store,
        delay_sec: float = 1.0,
    ) -> None:
        self.crawler = crawler
        self.tokenizer = tokenizer
        self.annotator = annotator
        self.storage_factory = storage_factory  # callable(path) -> StoragePort
        self.state_store = state_store
        self.delay_sec = delay_sec

    def execute(
        self,
        *,
        singers_index_url: str,
        out_dir: str,
        out_prefix: str = "lyr",
        max_lines: Optional[int] = None,
        limit_singers: Optional[int] = None,
        limit_songs: Optional[int] = None,
    ) -> int:
        processed_total = 0
        singers = self.crawler.discover_singers(singers_index_url)
        if limit_singers is not None:
            singers = singers[:limit_singers]
        for singer_name, singer_url in singers:
            songs = self.crawler.discover_songs(singer_url)
            if limit_songs is not None:
                songs = songs[:limit_songs]
            for _title, song_url in songs:
                if self.state_store.is_done(song_url):
                    continue
                meta, rows = self.crawler.extract_song(song_url)
                artist_slug = slugify(
                    meta.get("artists", [singer_name])[0] if meta.get("artists") else singer_name
                )
                # choose file id: prefer numeric song id, else digits from URL, else stable hash
                file_id = _derive_file_id(meta, song_url)
                out_path = Path(out_dir) / self.crawler.site / artist_slug / f"{file_id}.jsonl"
                out_path.parent.mkdir(parents=True, exist_ok=True)
                storage = self.storage_factory(str(out_path))
                processed = _build_docs(
                    meta=meta,
                    rows=rows,
                    tokenizer=self.tokenizer,
                    annotator=self.annotator,
                    storage=storage,
                    song_url=song_url,
                    out_prefix=out_prefix,
                    song_file_id=file_id,
                    max_lines=max_lines,
                )
                self.state_store.mark_done(song_url)
                processed_total += processed
                time.sleep(self.delay_sec)
        self.state_store.flush()
        return processed_total


class CrawlAllByLyricistUseCase:
    def __init__(
        self,
        *,
        crawler: CrawlerPort,
        tokenizer: TokenizerPort,
        annotator: AnnotatorPort,
        storage_factory,
        state_store,
        delay_sec: float = 1.0,
    ) -> None:
        self.crawler = crawler
        self.tokenizer = tokenizer
        self.annotator = annotator
        self.storage_factory = storage_factory
        self.state_store = state_store
        self.delay_sec = delay_sec

    def execute(
        self,
        *,
        singers_index_url: str,
        out_dir: str,
        out_prefix: str = "lyr",
        max_lines: Optional[int] = None,
        limit_tags: Optional[int] = None,
        limit_songs: Optional[int] = None,
    ) -> int:
        processed_total = 0
        tags = self.crawler.discover_lyricist_tags(singers_index_url)
        if limit_tags is not None:
            tags = tags[:limit_tags]
        for tag_name, tag_url in tags:
            songs = self.crawler.discover_songs(tag_url)
            if limit_songs is not None:
                songs = songs[:limit_songs]
            for _title, song_url in songs:
                if self.state_store.is_done(song_url):
                    continue
                meta, rows = self.crawler.extract_song(song_url)
                lyricist_slug = slugify(
                    meta.get("lyricists", [tag_name])[0] if meta.get("lyricists") else tag_name
                )
                file_id = _derive_file_id(meta, song_url)
                out_path = Path(out_dir) / self.crawler.site / lyricist_slug / f"{file_id}.jsonl"
                out_path.parent.mkdir(parents=True, exist_ok=True)
                storage = self.storage_factory(str(out_path))
                processed = _build_docs(
                    meta=meta,
                    rows=rows,
                    tokenizer=self.tokenizer,
                    annotator=self.annotator,
                    storage=storage,
                    song_url=song_url,
                    out_prefix=out_prefix,
                    song_file_id=file_id,
                    max_lines=max_lines,
                )
                self.state_store.mark_done(song_url)
                processed_total += processed
                time.sleep(self.delay_sec)
        self.state_store.flush()
        return processed_total
