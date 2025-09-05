from pathlib import Path


def _read_fixture(name: str) -> str:
    p = Path(__file__).resolve().parent.parent / "fixtures" / "feitsui" / name
    return p.read_text(encoding="utf-8")


def test_extract_song_pairs_from_article(monkeypatch):
    from infrastructure.adapters.feitsui_crawler import FeitsuiCrawler

    html = _read_fixture("article.html")
    fc = FeitsuiCrawler(user_agent="test")

    def fake_get(url: str) -> str:
        return html

    monkeypatch.setattr(fc, "_get", fake_get)
    meta, rows = fc.extract_song("https://www.feitsui.com/zh-hans/lyrics/1")
    assert meta["site"] == "feitsui"
    assert meta["doc_id"].endswith("1")
    assert len(rows) >= 2
    assert rows[0]["paragraph_id"] == "para_01"
    assert rows[0]["text_zh"].startswith("过去十八岁")
    assert any(tok.endswith("3") for tok in rows[0]["jyutping_tokens"])

