from pathlib import Path


def _read_fixture(name: str) -> str:
    p = Path(__file__).resolve().parent.parent / "fixtures" / "feitsui" / name
    return p.read_text(encoding="utf-8")


def test_discover_singers_first_list(monkeypatch):
    from infrastructure.adapters.feitsui_crawler import FeitsuiCrawler

    html = _read_fixture("singers_index.html")
    fc = FeitsuiCrawler(user_agent="test")

    def fake_get(url: str) -> str:
        return html

    monkeypatch.setattr(fc, "_get", fake_get)
    singers = fc.discover_singers("https://www.feitsui.com/singer_s")
    assert len(singers) == 2
    assert singers[0][0] == "陈奕迅"


def test_discover_songs_on_singer_page(monkeypatch):
    from infrastructure.adapters.feitsui_crawler import FeitsuiCrawler

    html = _read_fixture("singer_page.html")
    fc = FeitsuiCrawler(user_agent="test")

    def fake_get(url: str) -> str:
        return html

    monkeypatch.setattr(fc, "_get", fake_get)
    songs = fc.discover_songs("https://www.feitsui.com/zh-hans/singer/1")
    assert len(songs) == 2
    assert songs[0][0] == "歌名一"

