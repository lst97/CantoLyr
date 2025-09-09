# Cantonese Lyrics Crawler

This project provides a set of Python tools to crawl lyrics from websites, process them into a
structured JSONL format for RAG (Retrieval-Augmented Generation) applications, and handle language
conversion between Simplified and Traditional Chinese.

## Features

- **Web Crawler:** Fetches raw lyric text from a specified URL.
- **Text Processor:** Structures raw text into a detailed JSONL format, including fields for
  semantics, prosody, and NLP, ready for further enrichment.
- **Word Segmentation:** Uses the `jieba` library to tokenize Chinese text.
- **LLM-Ready:** Includes a placeholder and structure for enriching the data with a Large Language
  Model like Google Gemini.
- **Chinese Language Conversion:** A utility script to convert filenames, directory names, and
  `.jsonl` content from Simplified Chinese to Traditional Chinese.
- **Optional Cleanup:** The conversion script includes an option to automatically remove the
  original files after a successful conversion.

## Project Structure

```bash
.
├── data/                 # Default directory for storing crawled data
│   └── README.md         # README for the data directory
├── main.py               # Main script to run the crawling and processing pipeline
├── crawler.py            # Module containing the web crawling logic
├── processor.py          # Module for processing and structuring the lyric data
├── data_model.py         # Defines the Python data classes for the lyric structure
├── convert_to_traditional.py # Script to convert data to Traditional Chinese
├── requirements.txt      # Project dependencies
└── README.md             # This file
```

## Setup and Installation

1. **Create and activate a virtual environment:**

   ```bash
   python3.12 -m venv venv
   source venv/bin/activate
   ```

2. **Install the required dependencies:**

   ```bash
   pip install -r requirements.txt
   ```

## Usage

### 1. Crawling Lyrics

Before running the crawler, you need to configure it:

1. **Set the Target URL:** Open `main.py` and `crawler.py` and replace the placeholder URL
   (`http://example.com/lyrics`) with the actual URL you want to crawl.
2. **Configure the Selector:** In `crawler.py`, you must update the BeautifulSoup selector
   (`soup.find('div', class_='lyrics')`) to correctly target the HTML element containing the lyrics
   on your target website.
3. **Set Your API Key (Optional):** If you plan to use the LLM enrichment feature, open
   `processor.py` and set your Google Gemini API key where indicated.

Once configured, run the main script:

```bash
python main.py
```

This will generate a `lyrics_data.json` file in the project root containing the structured lyric
data.

### 2. Converting to Traditional Chinese

To convert the crawled data (or any other data in the same format) from Simplified to Traditional
Chinese, use the `convert_to_traditional.py` script.

- **To convert and keep the original files:**

  ```bash
  python convert_to_traditional.py path/to/your/data/
  ```

- **To convert and remove the original `.jsonl` files:**

  ```bash
  python convert_to_traditional.py path/to/your/data/ --cleanup
  ```

This script will recursively process the directory, renaming folders and files, and converting the
content of `.jsonl` files.
