# Data Source

The lyric data in this directory is sourced from [翡翠粤语歌词 (Feitsui.com)](https://www.feitsui.com).

## About Feitsui.com

Feitsui.com is a website dedicated to Cantonese song lyrics. It provides Jyutping phonetic transcriptions for Cantonese songs to help users learn pronunciation and sing along. The site features a search function for songs and artists, lists of popular tracks, and recommendations.

## Data Information

* **Source URL:** `https://www.feitsui.com`
* **Number of Songs:** [Please fill in the approximate number of songs in the database]
* **Languages:** The lyrics are primarily in Cantonese, with Jyutping phonetic transcriptions.

## Data Format

The data is stored in `.jsonl` format. Each line is a JSON object representing a single line of a lyric. Here is an example of the data structure:

```json
{
  "id": "lyr_20250905_0001",
  "text": "雨停在你離開的那一晌",
  "created_at": "2025-09-05T08:30:00Z",

  "structure": {
    "line_index": 1,
    "char_count": 10
  },

  "semantics": {
    "themes": ["離別", "回憶", "都會", "夜雨"],
    "sentiment": "sad",
    "keywords": ["雨", "離開", "夜色", "街燈"]
  },

  "prosody": {
    "tone_pattern": [5, 0, 2, 5, 0, 3, 5, 3, 9],
    "tone_pattern_cantonese_jyutping": ["jyu5", "ting4", "zoi6", "nei5", "lei4", "hoi1", "dik1", "naa5", "jat1", "soeng2"]
  },

  "nlp": {
    "tokens": [
      {"text": "雨", "pos": "NOUN"},
      {"text": "停", "pos": "VERB"},
      {"text": "在", "pos": "ADP"},
      {"text": "你", "pos": "PRON"},
      {"text": "離開", "pos": "VERB"},
      {"text": "的", "pos": "PART"},
      {"text": "那", "pos": "DET"},
      {"text": "一", "pos": "NUM"},
      {"text": "晌", "pos": "NOUN"}
    ],
    "syntax_notes": "主謂結構；時間狀語在句末"
  },

  "source": {
    "type": "corpus",
    "title": "合成語料-流行抒情",
    "artist": "N/A",
    "year": 2025,
    "genre": ["Pop", "Ballad"],
    "ingest_note": "出於教學與研發示例，非真實作品節錄"
  },

  "context_links": {
    "doc_id": "song_mock_001",
    "prev_line_id": null,
    "next_line_id": "lyr_20250905_0002",
    "paragraph_id": "para_01"
  }
}
```
