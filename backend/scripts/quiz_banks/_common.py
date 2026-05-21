"""Shared helpers for hand-authored learning quiz banks."""
from __future__ import annotations

import json
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
OUT_DIR = ROOT / "backend" / "data" / "learning" / "quizzes-cleaned"

@dataclass
class Q:
    chapter: str
    prompt: str
    correct: str
    distractors: list[str]
    explanation: str
    wrong: dict[str, str]
    hint: str = ""


@dataclass
class Book:
    title: str
    parent_topic: str
    subtopic: str
    slug: str
    source_url: str
    easy: list[Q] = field(default_factory=list)
    medium: list[Q] = field(default_factory=list)
    hard: list[Q] = field(default_factory=list)


def build_mcq(rng: random.Random, q: Q, ordinal: int, difficulty: str) -> dict[str, Any]:
    options = [q.correct, *q.distractors]
    if len(set(options)) != 4:
        raise ValueError(f"Need 4 unique options, got {options}")
    rng.shuffle(options)
    ids = ["a", "b", "c", "d"]
    pairs = list(zip(ids, options))
    correct_id = next(i for i, body in pairs if body == q.correct)
    choices = [{"id": i, "label": i.upper(), "body": body} for i, body in pairs]
    wrong_explanations: dict[str, str] = {}
    for i, body in pairs:
        if body == q.correct:
            continue
        wrong_explanations[i] = q.wrong.get(body) or "Not quite — re-read the prompt and try again."
    hint = q.hint or "Think about the precise definition before picking."
    return {
        "prompt": q.prompt,
        "choices": choices,
        "correctChoiceId": correct_id,
        "hint": hint,
        "explanation": q.explanation,
        "wrongAnswerExplanations": wrong_explanations,
        "difficulty": difficulty,
        "source": {"term": "", "chapterTitle": q.chapter},
        "qualityScore": 100,
        "originalOrdinal": ordinal,
        "cleanedOrdinal": ordinal,
    }


def chapters_from_questions(qs: list[Q]) -> list[dict[str, Any]]:
    seen: list[str] = []
    for q in qs:
        if q.chapter not in seen:
            seen.append(q.chapter)
    return [
        {"ordinal": i + 1, "title": title, "startPage": 1, "endPage": 1, "path": ""}
        for i, title in enumerate(seen)
    ]


def emit_book(book: Book) -> None:
    rng = random.Random(hash(book.slug) & 0xFFFFFFFF)
    all_qs = book.easy + book.medium + book.hard
    chapters = chapters_from_questions(all_qs)
    quizzes = {
        "easy": [build_mcq(rng, q, i + 1, "easy") for i, q in enumerate(book.easy)],
        "medium": [build_mcq(rng, q, i + 1, "medium") for i, q in enumerate(book.medium)],
        "hard": [build_mcq(rng, q, i + 1, "hard") for i, q in enumerate(book.hard)],
    }
    payload = {
        "book": {
            "title": book.title,
            "parentTopic": book.parent_topic,
            "subtopic": book.subtopic,
            "slug": book.slug,
            "sourceUrl": book.source_url,
            "pdfSha256": "",
        },
        "chapterCount": len(chapters),
        "conceptCount": len(all_qs),
        "chapters": chapters,
        "quizzes": quizzes,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{book.slug}.json"
    out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    total = sum(len(v) for v in quizzes.values())
    print(f"wrote {out_path} ({total} questions, {len(chapters)} chapters)")

