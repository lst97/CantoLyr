from __future__ import annotations

from typing import Dict, List, Tuple

from domain.ports import AnnotatorPort


class NullAnnotator(AnnotatorPort):
    """Fallback annotator that returns safe defaults without LLM calls."""

    def annotate(self, *, text: str, tokens: List[str]) -> Tuple[Dict, List[Dict], str]:
        semantics = {"themes": [], "sentiment": "neutral", "keywords": []}
        nlp_tokens = [{"text": t, "pos": "X"} for t in tokens]
        return semantics, nlp_tokens, ""

