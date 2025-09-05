from __future__ import annotations

import json
from pathlib import Path
from typing import Set


class JsonStateStore:
    """A simple on-disk set of processed song URLs to support resume."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._done: Set[str] = set()
        self._loaded = False
        self._dirty = False

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        # Load primary state file
        def _load(p: Path):
            try:
                if p.exists():
                    data = json.loads(p.read_text(encoding="utf-8"))
                    if isinstance(data, list):
                        return set(data)
            except Exception:
                return set()
            return set()

        self._done = _load(self.path)
        self._loaded = True

    def is_done(self, key: str) -> bool:
        self._ensure_loaded()
        return key in self._done

    def mark_done(self, key: str) -> None:
        self._ensure_loaded()
        if key not in self._done:
            self._done.add(key)
            self._dirty = True

    def flush(self) -> None:
        if not self._dirty:
            return
        self.path.write_text(json.dumps(sorted(self._done), ensure_ascii=False, indent=2), encoding="utf-8")
        self._dirty = False
