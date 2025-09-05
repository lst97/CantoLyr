from __future__ import annotations

from typing import List

from domain.ports import TokenizerPort


class JiebaTokenizer(TokenizerPort):
    def __init__(self) -> None:
        import jieba  # type: ignore

        self._jieba = jieba

    def tokenize(self, text: str) -> List[str]:
        return [t.strip() for t in self._jieba.cut(text, cut_all=False) if t.strip()]

