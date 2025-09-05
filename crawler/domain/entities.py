from __future__ import annotations

from typing import List, Dict, Optional, TypedDict


class Structure(TypedDict):
    line_index: int
    char_count: int


class Semantics(TypedDict):
    themes: List[str]
    sentiment: str
    keywords: List[str]


class Prosody(TypedDict):
    tone_pattern: List[int]
    tone_pattern_cantonese_jyutping: List[str]


class Token(TypedDict):
    text: str
    pos: str


class Nlp(TypedDict):
    tokens: List[Token]
    syntax_notes: str


class Source(TypedDict):
    title: str
    artists: List[str]
    lyricists: List[str]
    year: int
    genre: List[str]


class ContextLinks(TypedDict):
    doc_id: str
    prev_line_id: Optional[str]
    next_line_id: Optional[str]
    paragraph_id: str


class Lyric(TypedDict):
    id: str
    text: str
    created_at: str
    structure: Structure
    semantics: Semantics
    prosody: Prosody
    nlp: Nlp
    source: Source
    context_links: ContextLinks


# Raw extraction structures used across ports
class RawLine(TypedDict):
    text_zh: str
    jyutping_tokens: List[str]
    paragraph_id: str
    line_index: int


class SongMeta(TypedDict, total=False):
    site: str
    title: str
    artists: List[str]
    lyricists: List[str]
    song_id: str
    doc_id: str
