#!/usr/bin/env python3
"""Emit hand-authored learning quiz packs into quizzes-cleaned/.

Usage:
    python3 backend/scripts/author_learning_quizzes.py
    python3 backend/scripts/author_learning_quizzes.py --only operating-systems-ostep,statistics-openintro
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from quiz_banks._common import emit_book  # noqa: E402
from quiz_banks.registry import all_books  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Emit quizzes-cleaned JSON packs.")
    parser.add_argument(
        "--only",
        help="Comma-separated pack slugs to emit (default: all registered banks)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    only = None
    if args.only:
        only = {slug.strip() for slug in args.only.split(",") if slug.strip()}

    for book in all_books():
        if only is not None and book.slug not in only:
            continue
        emit_book(book)


if __name__ == "__main__":
    main()
