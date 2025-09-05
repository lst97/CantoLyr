from pathlib import Path


def _read_fixture(name: str) -> str:
    p = Path(__file__).resolve().parent.parent / "fixtures" / "feitsui" / name
    return p.read_text(encoding="utf-8")


def test_discover_songs_collects_all_ul(monkeypatch):
    from infrastructure.adapters.feitsui_crawler import FeitsuiCrawler

    html = _read_fixture("tag_page_multi_ul.html")
    fc = FeitsuiCrawler(user_agent="test")

    def fake_get(url: str) -> str:
        return html

    monkeypatch.setattr(fc, "_get", fake_get)
    songs = fc.discover_songs("https://www.feitsui.com/tag_s/1.html")
    assert len(songs) == 2
    titles = [t for t, _ in songs]
    assert "歌名一" in titles and "歌名二" in titles

