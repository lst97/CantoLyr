#!/usr/bin/env python3
from ingest_chroma import main as _main

if __name__ == "__main__":
    import sys
    # Force lexicon mode; allow optional [input.jsonl, collection]
    # When no input is provided, the main script now defaults to combining:
    #   data/preprocess/lexicon/chars.posr.jsonl and vocab.posr.jsonl
    # into a single ingest stream for the lexicon collection.
    sys.argv = [sys.argv[0], "lexicon", *sys.argv[1:]]
    _main()
