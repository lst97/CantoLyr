# Lexicon Data

This directory contains hybrid lexicon data that combines real source data with AI-refined
part-of-speech (POS) and register meaning annotations. The data is specifically prepared for the
Chroma normalization process used in the canton-lyr project.

## Data Structure

- **Source**: Real linguistic data from Cantonese language sources
- **AI Enhancement**: POS tagging and register meaning analysis refined by AI models
- **Format**: JSONL files with structured annotations
- **Purpose**: Normalization and vectorization for semantic search and analysis

## Files

- `chars.posr.jsonl`: Character-level POS and register data
- `vocab.posr.jsonl'`: Vocabulary-level POS and register data

## Usage

This data is consumed by the Chroma ingestion scripts to create vector embeddings for semantic
search capabilities in the application.
