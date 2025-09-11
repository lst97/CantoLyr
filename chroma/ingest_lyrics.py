#!/usr/bin/env python3
from ingest_chroma import main as _main

if __name__ == "__main__":
    import sys
    # Force lyrics mode; allow optional [input.jsonl, collection]
    sys.argv = [sys.argv[0], "lyrics", *sys.argv[1:]]
    _main()
