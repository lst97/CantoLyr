from __future__ import annotations

import re
from typing import List, Tuple

import requests
from bs4 import BeautifulSoup, NavigableString  # type: ignore

from domain.entities import RawLine, SongMeta
from domain.ports import CrawlerPort


AD_TEXT = "翡翠粤语歌词"


class FeitsuiCrawler(CrawlerPort):
    site = "feitsui"

    def __init__(self, *, user_agent: str = "") -> None:
        self.session = requests.Session()
        if user_agent:
            self.session.headers.update({"User-Agent": user_agent})

    def extract_song(self, song_url: str) -> Tuple[SongMeta, List[RawLine]]:
        html = self._get(song_url)
        soup = BeautifulSoup(html, "html.parser")

        main = soup.select_one("main") or soup
        article = main.select_one("article") or main

        # Metadata: title, artists, lyricists (from first <p> block), song_id
        # Prefer article h5 with ruby (strip rt tags)
        h5 = article.select_one("h5")
        title = ""
        if h5:
            # remove all <rt> pronunciations
            for rt in h5.select("rt"):
                rt.decompose()
            title = h5.get_text(strip=True)
        if not title:
            title = _first_text(article.select_one("h1"), main.select_one("h1"), soup.title) or ""

        singer_block = main.select_one("p")
        artists: List[str] = []
        lyricists: List[str] = []
        if singer_block:
            anchors = [a for a in singer_block.select("a")]
            if anchors:
                artists = [anchors[0].get_text(strip=True)] if anchors[0].get_text(strip=True) else []
                others = [a.get_text(strip=True) for a in anchors[1:]]
                lyricists = [t for t in others if t]

        song_id = _extract_song_id(song_url)
        meta: SongMeta = {
            "site": self.site,
            "title": title,
            "artists": artists,
            "lyricists": lyricists,
            "song_id": song_id or "",
            "doc_id": f"{self.site}_{song_id}" if song_id else song_url,
        }

        rows: List[RawLine] = []
        para_index = 0
        line_index = 0
        for p in article.select("p"):
            para_index += 1
            paragraph_id = f"para_{para_index:02d}"
            # Clean out hidden spans
            for sp in p.select("span.d-none, span.d-sm-inline"):
                sp.decompose()

            parts: List[str] = _split_by_br(p)
            # Remove ad literal lines
            parts = [s for s in (s.strip() for s in parts) if s and s != AD_TEXT]
            i = 0
            while i < len(parts):
                zh = parts[i]
                jp = parts[i + 1] if i + 1 < len(parts) else ""
                if _looks_like_jyutping(jp):
                    jp_tokens = _normalize_jyutping_tokens(jp)
                    if zh and jp_tokens:
                        line_index += 1
                        rows.append(
                            RawLine(text_zh=zh, jyutping_tokens=jp_tokens, paragraph_id=paragraph_id, line_index=line_index)
                        )
                    i += 2
                else:
                    i += 1

        return meta, rows

    def _get(self, url: str) -> str:
        r = self.session.get(url, timeout=30)
        r.raise_for_status()
        r.encoding = r.apparent_encoding or r.encoding
        return r.text

    def discover_singers(self, index_url: str) -> List[Tuple[str, str]]:
        html = self._get(index_url)
        soup = BeautifulSoup(html, "html.parser")
        links: List[Tuple[str, str]] = []
        # Some pages have multiple UL groups; collect across all
        for a in soup.select("main ul li a"):
            name = (a.get_text() or "").strip()
            href = a.get("href") or ""
            if not href or not name:
                continue
            url = href if href.startswith("http") else _urljoin(index_url, href)
            links.append((name, url))
        return links

    def discover_songs(self, artist_url: str) -> List[Tuple[str, str]]:
        html = self._get(artist_url)
        soup = BeautifulSoup(html, "html.parser")
        links: List[Tuple[str, str]] = []
        # Tag and singer pages can have multiple UL groups
        for a in soup.select("main ul li a"):
            title = (a.get_text() or "").strip()
            href = a.get("href") or ""
            if not href or not title:
                continue
            url = href if href.startswith("http") else _urljoin(artist_url, href)
            links.append((title, url))
        return links

    def discover_lyricist_tags(self, index_url: str) -> List[Tuple[str, str]]:
        html = self._get(index_url)
        soup = BeautifulSoup(html, "html.parser")
        tags: List[Tuple[str, str]] = []
        for a in soup.select("aside ol.tags-s li a"):
            name = (a.get_text() or "").strip()
            href = a.get("href") or ""
            if not href or not name:
                continue
            url = href if href.startswith("http") else _urljoin(index_url, href)
            tags.append((name, url))
        return tags


def _first_text(*els) -> str | None:
    for el in els:
        if not el:
            continue
        txt = (el.get_text() if hasattr(el, "get_text") else getattr(el, "string", "")) or ""
        txt = txt.strip()
        if txt:
            return txt
    return None


def _extract_song_id(url: str) -> str | None:
    m = re.search(r"/(lyrics|song)[/\-]?([0-9A-Za-z\-]+)", url)
    return m.group(2) if m else None


def _split_by_br(p) -> List[str]:
    lines: List[str] = []
    buf: List[str] = []
    for node in p.children:
        if isinstance(node, NavigableString):
            s = str(node)
            if s:
                buf.append(s)
        elif getattr(node, "name", None) == "br":
            line = "".join(buf).strip()
            lines.append(line)
            buf = []
        else:
            txt = node.get_text("", strip=True)
            if txt:
                buf.append(txt)
    if buf:
        lines.append("".join(buf).strip())
    return lines


def _looks_like_jyutping(s: str) -> bool:
    # Heuristic: contains spaces and many syllables with trailing tone digits
    if not s or " " not in s:
        return False
    tokens = s.split()
    score = sum(1 for t in tokens if re.search(r"[a-z]{1,}[1-6](?:/[a-z]{1,}[1-6])*$", t))
    return score >= max(2, len(tokens) // 3)


def _normalize_jyutping_tokens(s: str) -> List[str]:
    out: List[str] = []
    for raw in s.split():
        # choose first variant before '/'
        t = raw.split("/")[0]
        # strip punctuation
        t = t.strip().strip(",.?!;:，。！？；：…—")
        if re.match(r"^[a-z]{1,}[1-6]$", t):
            out.append(t)
    return out


def _urljoin(base: str, href: str) -> str:
    if href.startswith("/"):
        from urllib.parse import urlparse, urlunparse

        p = urlparse(base)
        return urlunparse((p.scheme, p.netloc, href, "", "", ""))
    else:
        from urllib.parse import urljoin

        return urljoin(base, href)
