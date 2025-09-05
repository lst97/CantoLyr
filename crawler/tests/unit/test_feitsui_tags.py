from pathlib import Path


def _read_fixture(name: str) -> str:
    p = Path(__file__).resolve().parent.parent / "fixtures" / "feitsui" / name
    return p.read_text(encoding="utf-8")


def test_discover_lyricist_tags(monkeypatch):
    from infrastructure.adapters.feitsui_crawler import FeitsuiCrawler

    html = _read_fixture("singers_index_with_tags.html")
    fc = FeitsuiCrawler(user_agent="test")

    def fake_get(url: str) -> str:
        return html

    monkeypatch.setattr(fc, "_get", fake_get)
    tags = fc.discover_lyricist_tags("https://www.feitsui.com/singer_s")
    assert len(tags) >= 3
    assert tags[0][0] == "林夕"

