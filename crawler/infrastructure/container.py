from __future__ import annotations

from typing import Literal

from application.use_cases import (
    CrawlSingleSongUseCase,
    CrawlFirstSingerFirstSongUseCase,
    CrawlAllSongsUseCase,
    CrawlAllByLyricistUseCase,
)
from infrastructure.config import load_settings
from infrastructure.adapters.jieba_tokenizer import JiebaTokenizer
from infrastructure.adapters.genai_annotator import GenAIAnnotator
from infrastructure.adapters.null_annotator import NullAnnotator
from infrastructure.adapters.jsonl_storage import JsonlStorage
from infrastructure.adapters.feitsui_crawler import FeitsuiCrawler
from infrastructure.state_store import JsonStateStore
from pathlib import Path


def build_crawl_song_usecase(*, site: Literal["feitsui"], out_path: str, no_llm: bool = False) -> CrawlSingleSongUseCase:
    settings = load_settings()
    tokenizer = JiebaTokenizer()
    annotator = NullAnnotator() if no_llm else GenAIAnnotator()
    storage = JsonlStorage(out_path)
    if site == "feitsui":
        crawler = FeitsuiCrawler(user_agent=settings.user_agent)
    else:
        raise ValueError(f"Unsupported site: {site}")
    return CrawlSingleSongUseCase(crawler=crawler, tokenizer=tokenizer, annotator=annotator, storage=storage)


def build_crawl_first_singer_first_song_usecase(*, site: Literal["feitsui"], out_path: str, no_llm: bool = False) -> CrawlFirstSingerFirstSongUseCase:
    settings = load_settings()
    tokenizer = JiebaTokenizer()
    annotator = NullAnnotator() if no_llm else GenAIAnnotator()
    storage = JsonlStorage(out_path)
    if site == "feitsui":
        crawler = FeitsuiCrawler(user_agent=settings.user_agent)
    else:
        raise ValueError(f"Unsupported site: {site}")
    return CrawlFirstSingerFirstSongUseCase(crawler=crawler, tokenizer=tokenizer, annotator=annotator, storage=storage)


def build_crawl_all_usecase(*, site: Literal["feitsui"], out_dir: str, no_llm: bool = False, delay_sec: float = 1.0) -> CrawlAllSongsUseCase:
    settings = load_settings()
    tokenizer = JiebaTokenizer()
    annotator = NullAnnotator() if no_llm else GenAIAnnotator()
    if site == "feitsui":
        crawler = FeitsuiCrawler(user_agent=settings.user_agent)
    else:
        raise ValueError(f"Unsupported site: {site}")

    def storage_factory(path: str):
        return JsonlStorage(path)

    state = JsonStateStore(Path(out_dir) / site / ".state" / "processed.json")
    return CrawlAllSongsUseCase(
        crawler=crawler,
        tokenizer=tokenizer,
        annotator=annotator,
        storage_factory=storage_factory,
        state_store=state,
        delay_sec=delay_sec,
    )


def build_crawl_by_lyricist_usecase(*, site: Literal["feitsui"], out_dir: str, no_llm: bool = False, delay_sec: float = 1.0) -> CrawlAllByLyricistUseCase:
    settings = load_settings()
    tokenizer = JiebaTokenizer()
    annotator = NullAnnotator() if no_llm else GenAIAnnotator()
    if site == "feitsui":
        crawler = FeitsuiCrawler(user_agent=settings.user_agent)
    else:
        raise ValueError(f"Unsupported site: {site}")

    def storage_factory(path: str):
        return JsonlStorage(path)

    state = JsonStateStore(Path(out_dir) / site / ".state" / "processed.json")
    return CrawlAllByLyricistUseCase(
        crawler=crawler,
        tokenizer=tokenizer,
        annotator=annotator,
        storage_factory=storage_factory,
        state_store=state,
        delay_sec=delay_sec,
    )
