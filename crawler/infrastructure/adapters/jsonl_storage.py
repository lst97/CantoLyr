from __future__ import annotations

import json
from pathlib import Path

from domain.entities import Lyric
from domain.ports import StoragePort


class JsonlStorage(StoragePort):
    def __init__(self, out_path: str | Path) -> None:
        self.path = Path(out_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialized = False

    def save(self, doc: Lyric) -> None:
        mode = "w" if not self._initialized else "a"
        with self.path.open(mode, encoding="utf-8") as f:
            f.write(json.dumps(doc, ensure_ascii=False) + "\n")
        self._initialized = True
