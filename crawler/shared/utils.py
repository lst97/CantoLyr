from __future__ import annotations

import hashlib
import re


def slugify(s: str) -> str:
    s = s.strip().lower()
    # replace non-word characters with hyphen
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"[^\w\-\u4e00-\u9fff]", "", s)
    s = re.sub(r"-+", "-", s)
    return s.strip("-") or "untitled"


def stable_id(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:10]

