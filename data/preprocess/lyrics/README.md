# Lyrics Data

This directory contains hybrid lyrics data that combines original Cantonese song lyrics with
AI-generated semantic and linguistic annotations. The data is processed to enhance analysis and
search capabilities for the canton-lyr project.

## Data Structure

- **Source**: Original Cantonese song lyrics from various artists and sources
- **AI Enhancement**: Automatically filled semantic analysis including:
  - Meaning and themes
  - Part-of-speech (POS) tagging for tokens
  - Keywords extraction
  - Syntax notes and linguistic analysis
  - Sentiment analysis
  - Prosody and tone pattern analysis
  - Contextual linking between lines

## Organization

Lyrics are organized by source/artist in subdirectories:

- `feitsui/hotcha/`: Lyrics from Hotcha and other lyricists
- Other artist folders as available

## File Format

Each lyric line is stored as a JSON object in JSONL format with the following key sections:

- `structure`: Line metadata (index, character count)
- `semantics`: Themes, sentiment, keywords
- `prosody`: Tone patterns and Cantonese Jyutping
- `nlp`: Token-level POS tagging and syntax analysis
- `source`: Song metadata (title, artists, genre)
- `context_links`: Relationships to adjacent lines and paragraphs

## Usage

This enriched data supports:

- Semantic search across Cantonese lyrics
- Theme and sentiment analysis
- Linguistic pattern recognition
- Vector embedding generation for Chroma
