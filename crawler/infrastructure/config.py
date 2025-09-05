from __future__ import annotations

import os
from dataclasses import dataclass
from dotenv import load_dotenv


@dataclass
class Settings:
    google_api_key: str | None
    user_agent: str


def load_settings() -> Settings:
    load_dotenv()
    ua = os.getenv(
        "CRAWLER_USER_AGENT",
        "Mozilla/5.0 (compatible; CantonLyrCrawler/1.0; +https://example.com/bot)",
    )
    return Settings(
        google_api_key=os.getenv("GOOGLE_API_KEY"),
        user_agent=ua,
    )

