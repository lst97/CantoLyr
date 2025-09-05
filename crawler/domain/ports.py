from __future__ import annotations

from typing import Protocol, List, Tuple

from .entities import RawLine, SongMeta, Lyric


class CrawlerPort(Protocol):
    site: str

    def extract_song(self, song_url: str) -> Tuple[SongMeta, List[RawLine]]:
        """Return song metadata and raw lyric lines (ZH + Jyutping tokens)."""

    # New discovery helpers for multi-level crawl
    def discover_singers(self, index_url: str) -> List[Tuple[str, str]]:
        """Return list of (singer_name, singer_url) discovered from index page."""

    def discover_songs(self, artist_url: str) -> List[Tuple[str, str]]:
        """Return list of (song_title, song_url) from a singer page."""

    def discover_lyricist_tags(self, index_url: str) -> List[Tuple[str, str]]:
        """Return list of (lyricist_name, tag_url) from the index page aside tags list."""


class TokenizerPort(Protocol):
    def tokenize(self, text: str) -> List[str]:
        """Return token list for the given text."""


class AnnotatorPort(Protocol):
    def annotate(self, *, text: str, tokens: List[str]) -> Tuple[dict, List[dict], str]:
        """Return (semantics, nlp_tokens, syntax_notes).

        - semantics: {themes:[], sentiment:str, keywords:[]}
        - nlp_tokens: [{text,pos}, ...]
        - syntax_notes: str
        """


class StoragePort(Protocol):
    def save(self, doc: Lyric) -> None:
        """Persist a lyric line document (e.g., JSONL)."""
