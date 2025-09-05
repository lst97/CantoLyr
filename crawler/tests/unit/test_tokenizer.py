import pytest


def test_jieba_tokenizer_basic(monkeypatch):
    # Lazy import class to avoid hard dependency at import-time
    from infrastructure.adapters.jieba_tokenizer import JiebaTokenizer

    try:
        tok = JiebaTokenizer()
    except Exception as e:
        pytest.skip(f"jieba not available: {e}")

    text = "我鍾意聽歌，也愛唱歌。"
    tokens = tok.tokenize(text)
    assert isinstance(tokens, list)
    assert any(t in tokens for t in ["聽歌", "唱歌", "歌"])  # depends on dictionary
    assert all(isinstance(t, str) for t in tokens)

