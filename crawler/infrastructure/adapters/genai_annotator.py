from __future__ import annotations

import json
from typing import Dict, List, Tuple

from domain.ports import AnnotatorPort


SYSTEM_PROMPT = (
    "You are a Cantonese music analyst. Given a Chinese lyric line and its tokenization, "
    "return JSON with keys: semantics{themes[], sentiment, keywords[]}, tokens[{text,pos}], syntax_notes. "
    "Use coarse POS tags like NOUN, VERB, ADJ, ADV, ADP, PRON, DET, NUM, PART, PUNCT, CCONJ, SCONJ, INTJ."
)


class GenAIAnnotator(AnnotatorPort):
    def __init__(self) -> None:
        # Uses GOOGLE_API_KEY/GEMINI_API_KEY from environment (loaded via dotenv in config)
        from google import genai  # type: ignore

        self._client = genai.Client()
        # Prefer a fast text model
        self._model = "gemini-2.0-flash-001"

    def annotate(self, *, text: str, tokens: List[str]) -> Tuple[Dict, List[Dict], str]:
        prompt = (
            f"Lyric line (Chinese): {text}\n"
            f"Tokens: {tokens}\n\n"
            f"{SYSTEM_PROMPT}\nRespond with only valid JSON."
        )
        try:
            resp = self._client.models.generate_content(model=self._model, contents=prompt)
            content = resp.text or "{}"
            data = json.loads(content)
        except Exception:
            data = {}

        semantics = data.get("semantics") or {"themes": [], "sentiment": "neutral", "keywords": []}
        toks = data.get("tokens") or [{"text": t, "pos": "X"} for t in tokens]
        notes = data.get("syntax_notes") or ""
        return semantics, toks, notes

