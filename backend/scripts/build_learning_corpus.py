#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = ROOT / "backend" / "data" / "learning"
RAW_ROOT = DATA_ROOT / "raw-selected"
CHAPTER_ROOT = DATA_ROOT / "chapters"
QUIZ_ROOT = DATA_ROOT / "quizzes"

FRONT_MATTER_TITLES = {
    "preface",
    "foreword",
    "acknowledgments",
    "acknowledgements",
    "installation",
    "notation",
    "contents",
    "table of contents",
    "index",
    "references",
    "bibliography",
    "introduction",
}

GENERIC_TERM_BLACKLIST = {
    "why",
    "how",
    "what",
    "when",
    "where",
    "who",
    "this",
    "that",
    "these",
    "those",
    "since",
    "while",
    "using",
    "other",
    "overview",
    "summary",
    "exercise",
    "exercises",
    "discussion",
    "discussions",
}

TERM_PREFIX_BLACKLIST = {
    "a",
    "an",
    "the",
    "this",
    "that",
    "these",
    "those",
    "if",
    "while",
    "since",
    "consider",
    "note",
    "nonetheless",
    "and",
    "or",
    "but",
}

ALLOWED_LOWERCASE_TITLE_WORDS = {"a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with", "vs"}


@dataclass(frozen=True)
class BookSpec:
    parent_topic: str
    subtopic: str
    title: str
    slug: str
    url: str


BOOKS: list[BookSpec] = [
    BookSpec(
        parent_topic="AI & Machine Learning",
        subtopic="Machine Learning",
        title="Dive into Deep Learning",
        slug="machine-learning-d2l",
        url="https://d2l.ai/d2l-en.pdf",
    ),
    BookSpec(
        parent_topic="AI & Machine Learning",
        subtopic="Reinforcement Learning",
        title="Reinforcement Learning: An Introduction",
        slug="reinforcement-learning-sutton-barto",
        url="http://incompleteideas.net/book/RLbook2020.pdf",
    ),
    BookSpec(
        parent_topic="Computer Science",
        subtopic="Algorithms",
        title="Algorithms",
        slug="algorithms-jeff-erickson",
        url="https://jeffe.cs.illinois.edu/teaching/algorithms/book/Algorithms-JeffE.pdf",
    ),
    BookSpec(
        parent_topic="Mathematics",
        subtopic="Probability",
        title="Introduction to Probability",
        slug="probability-grinstead-snell",
        url="https://math.dartmouth.edu/~prob/prob/prob.pdf",
    ),
    BookSpec(
        parent_topic="Philosophy & Psychology",
        subtopic="Logic",
        title="forall x: Calgary",
        slug="logic-forallx-calgary",
        url="https://openlogicproject.org/wp-content/uploads/2019/03/forallxyyc.pdf",
    ),
]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def slugify(value: str) -> str:
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", value.lower())).strip("-")


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def sentence_split(text: str) -> list[str]:
    text = text.replace("\n", " ")
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9])", text)
    return [normalize_space(part) for part in parts if len(normalize_space(part)) >= 40]


def short_summary(text: str, limit: int = 220) -> str:
    text = normalize_space(text)
    if len(text) <= limit:
      return text
    cutoff = text[:limit].rsplit(" ", 1)[0]
    return f"{cutoff}..."


def extract_text(reader: PdfReader, start_page: int, end_page: int) -> str:
    chunks: list[str] = []
    for index in range(start_page, end_page + 1):
        try:
            chunks.append(reader.pages[index].extract_text() or "")
        except Exception:
            chunks.append("")
    return "\n".join(chunks)


def run_curl_download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["curl", "-fsSL", url, "-o", str(destination)],
        check=True,
    )


def flatten_outline(reader: PdfReader) -> list[dict[str, Any]]:
    outline = getattr(reader, "outline", [])
    entries: list[dict[str, Any]] = []

    def walk(items: Any, depth: int) -> None:
        if isinstance(items, list):
            for item in items:
                walk(item, depth)
            return
        if isinstance(items, dict) and "/Title" in items and "/Page" in items:
            try:
                page_index = reader.get_destination_page_number(items)
            except Exception:
                page_index = None
            if page_index is not None:
                entries.append(
                    {
                        "title": normalize_space(str(items.get("/Title", ""))),
                        "page_index": page_index,
                        "depth": depth,
                    }
                )
            nested = items.get("/First")
            if nested:
                walk(nested, depth + 1)
            return
        if hasattr(items, "title"):
            try:
                page_index = reader.get_destination_page_number(items)
            except Exception:
                page_index = None
            if page_index is not None:
                entries.append(
                    {
                        "title": normalize_space(str(getattr(items, "title", ""))),
                        "page_index": page_index,
                        "depth": depth,
                    }
                )
            return
        if isinstance(items, (tuple, set)):
            for item in items:
                walk(item, depth)

    def recurse(items: Any, depth: int) -> None:
        if isinstance(items, list):
            for item in items:
                if isinstance(item, list):
                    recurse(item, depth + 1)
                else:
                    walk(item, depth)
        else:
            walk(items, depth)

    recurse(outline, 0)
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, int, int]] = set()
    for entry in entries:
        key = (entry["title"], entry["page_index"], entry["depth"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(entry)
    return deduped


def choose_chapters(outline_entries: list[dict[str, Any]], page_count: int) -> list[dict[str, Any]]:
    top_level = [
        entry
        for entry in outline_entries
        if entry["depth"] == 0 and entry["title"] and entry["title"].lower() not in FRONT_MATTER_TITLES
    ]
    if len(top_level) < 8:
        top_level = [
            entry
            for entry in outline_entries
            if entry["depth"] <= 1
            and entry["title"]
            and entry["title"].lower() not in FRONT_MATTER_TITLES
            and re.search(r"\d|chapter|part|logic|probability|algorithm|learning|proof|truth|policy", entry["title"].lower())
        ]
    top_level.sort(key=lambda item: item["page_index"])

    chapters: list[dict[str, Any]] = []
    for index, entry in enumerate(top_level):
        start_page = entry["page_index"]
        next_start = top_level[index + 1]["page_index"] if index + 1 < len(top_level) else page_count
        end_page = max(start_page, next_start - 1)
        if chapters and start_page <= chapters[-1]["start_page"]:
            continue
        if end_page - start_page < 1:
            continue
        chapters.append(
            {
                "ordinal": len(chapters) + 1,
                "title": entry["title"],
                "start_page": start_page,
                "end_page": min(end_page, page_count - 1),
            }
        )
    return chapters


def choose_chapters_from_toc(reader: PdfReader) -> list[dict[str, Any]]:
    toc_text = "\n".join((reader.pages[index].extract_text() or "") for index in range(min(12, len(reader.pages))))
    chapter_lines = []
    pattern = re.compile(r"^\s*(\d{1,2})\s+([A-Z][A-Za-z0-9 ,:'’\-]+?)\s+(\d{1,4})\s*$")
    for line in toc_text.splitlines():
        normalized = normalize_space(line)
        match = pattern.match(normalized)
        if not match or "." in normalized:
            continue
        chapter_number = int(match.group(1))
        title = normalize_space(match.group(2))
        printed_page = int(match.group(3))
        chapter_lines.append((chapter_number, title, printed_page))

    if len(chapter_lines) < 5:
        return []

    deduped_lines: list[tuple[int, str, int]] = []
    seen_numbers: set[int] = set()
    for number, title, printed_page in chapter_lines:
        if number in seen_numbers:
            continue
        seen_numbers.add(number)
        deduped_lines.append((number, title, printed_page))

    page_snippets = []
    for page_index in range(len(reader.pages)):
        text = reader.pages[page_index].extract_text() or ""
        page_snippets.append(normalize_space(" ".join(text.splitlines()[:20])).lower())

    starts: list[dict[str, Any]] = []
    for number, title, printed_page in deduped_lines:
        title_lower = title.lower()
        page_index = next((index for index, snippet in enumerate(page_snippets) if title_lower in snippet), None)
        if page_index is None:
            chapter_pattern = f"chapter {number}"
            page_index = next((index for index, snippet in enumerate(page_snippets) if chapter_pattern in snippet), None)
        if page_index is None:
            continue
        starts.append(
            {
                "ordinal": number,
                "title": title,
                "start_page": page_index,
                "printed_page": printed_page,
            }
        )

    starts.sort(key=lambda item: item["start_page"])
    chapters: list[dict[str, Any]] = []
    for index, chapter in enumerate(starts):
        next_start = starts[index + 1]["start_page"] if index + 1 < len(starts) else len(reader.pages)
        end_page = max(chapter["start_page"], next_start - 1)
        chapters.append(
            {
                "ordinal": len(chapters) + 1,
                "title": chapter["title"],
                "start_page": chapter["start_page"],
                "end_page": end_page,
            }
        )
    return chapters


def valid_term(term: str) -> bool:
    normalized = normalize_space(term)
    if not normalized or len(normalized) > 90:
        return False
    first_word = normalized.split()[0].lower()
    if first_word in TERM_PREFIX_BLACKLIST:
        return False
    if normalized.lower() in FRONT_MATTER_TITLES or normalized.lower() in GENERIC_TERM_BLACKLIST:
        return False
    if len(normalized.split()) > 8:
        return False
    if not re.search(r"[A-Za-z]{3,}", normalized):
        return False
    words = [re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9]+$", "", word) for word in normalized.split()]
    cleaned_words = [word for word in words if word]
    if not cleaned_words:
        return False
    for word in cleaned_words:
        if word.lower() in ALLOWED_LOWERCASE_TITLE_WORDS:
            continue
        if word.isupper() or word[0].isupper() or word[0].isdigit():
            continue
        return False
    return True


def concept_candidates_from_outline(
    reader: PdfReader,
    chapter: dict[str, Any],
    outline_entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    chapter_entries = [
        entry
        for entry in outline_entries
        if chapter["start_page"] <= entry["page_index"] <= chapter["end_page"] and entry["depth"] <= 2
    ]
    concepts: list[dict[str, Any]] = []
    for entry in chapter_entries:
        if not valid_term(entry["title"]):
            continue
        page_text = extract_text(reader, entry["page_index"], min(entry["page_index"] + 1, chapter["end_page"]))
        sentences = sentence_split(page_text)
        first_sentence = next((sentence for sentence in sentences if len(sentence) >= 50), "")
        if not first_sentence:
            continue
        concepts.append(
            {
                "term": entry["title"],
                "summary": short_summary(first_sentence, 220),
                "chapter_title": chapter["title"],
            }
        )
    return concepts


DEFINITION_PATTERNS = [
    re.compile(r"^([A-Z][A-Za-z0-9,\-()' /]{2,80})\s+(?:is|are|refers to|means|denotes)\s+(.+)$"),
    re.compile(r"^In\s+([A-Z][A-Za-z0-9,\-()' /]{2,80}),\s+(.+)$"),
]


def definition_candidates(chapter_title: str, text: str) -> list[dict[str, Any]]:
    concepts: list[dict[str, Any]] = []
    for sentence in sentence_split(text):
        for pattern in DEFINITION_PATTERNS:
            match = pattern.match(sentence)
            if not match:
                continue
            term = normalize_space(match.group(1))
            summary = short_summary(match.group(2))
            if len(term) < 3 or len(summary) < 40:
                continue
            concepts.append(
                {
                    "term": term,
                    "summary": summary,
                    "chapter_title": chapter_title,
                }
            )
            break
    return concepts


def dedupe_concepts(concepts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for concept in concepts:
        term = concept["term"]
        summary = concept["summary"]
        if not valid_term(term):
            continue
        if len(summary) < 40:
            continue
        key = (term.lower(), summary.lower())
        if key in seen:
            continue
        seen.add(key)
        deduped.append(concept)
    return deduped


def build_mcq(
    prompt: str,
    correct_option: str,
    distractors: list[str],
    hint: str,
    explanation: str,
) -> dict[str, Any]:
    unique_distractors: list[str] = []
    seen = {correct_option}
    for distractor in distractors:
        if distractor in seen:
            continue
        seen.add(distractor)
        unique_distractors.append(distractor)
        if len(unique_distractors) == 3:
            break
    option_texts = [correct_option, *unique_distractors]
    if len(option_texts) < 4:
        raise RuntimeError("Not enough unique answer options to build a multiple-choice question.")
    ids = ["a", "b", "c", "d"]
    combined = list(zip(ids, option_texts))
    random.shuffle(combined)
    correct_choice_id = next(choice_id for choice_id, body in combined if body == correct_option)
    choices = [{"id": choice_id, "label": choice_id.upper(), "body": body} for choice_id, body in combined]
    wrong = {choice_id: "This option does not match the cited textbook material." for choice_id, body in combined if body != correct_option}
    return {
        "prompt": prompt,
        "choices": choices,
        "correctChoiceId": correct_choice_id,
        "hint": hint,
        "explanation": explanation,
        "wrongAnswerExplanations": wrong,
    }


def generate_questions_for_difficulty(
    difficulty: str,
    concepts: list[dict[str, Any]],
    count: int,
) -> list[dict[str, Any]]:
    concepts = [concept for concept in concepts if concept["term"] and concept["summary"]]
    if len(concepts) < 8:
        raise RuntimeError(f"Not enough concepts to generate {difficulty} questions.")

    questions: list[dict[str, Any]] = []
    term_pool = [concept["term"] for concept in concepts]
    summary_pool = [concept["summary"] for concept in concepts]

    for ordinal in range(1, count + 1):
        concept = concepts[(ordinal - 1) % len(concepts)]
        other_concepts = [item for item in concepts if item["term"] != concept["term"]]
        random.shuffle(other_concepts)

        if difficulty == "easy":
            prompt = f"Which term best matches this textbook description from {concept['chapter_title']}?\n\n{concept['summary']}"
            distractors = [item["term"] for item in other_concepts]
            hint = "Match the wording in the description to the textbook term."
            explanation = f"The correct answer is {concept['term']} because that term matches the cited description."
            payload = build_mcq(prompt, concept["term"], distractors, hint, explanation)
        elif difficulty == "medium":
            prompt = f"Which description best matches the textbook’s treatment of {concept['term']}?"
            distractors = [item["summary"] for item in other_concepts]
            hint = "Look for the option that stays closest to the source chapter’s wording and scope."
            explanation = f"The correct option reproduces the main idea used for {concept['term']} in {concept['chapter_title']}."
            payload = build_mcq(prompt, concept["summary"], distractors, hint, explanation)
        else:
            same_chapter = [item for item in other_concepts if item["chapter_title"] == concept["chapter_title"]]
            if len(same_chapter) < 3:
                same_chapter = other_concepts
            distractors = []
            for item in same_chapter:
                distractors.append(
                    short_summary(
                        f"{item['term']}: {item['summary']}",
                        220,
                    )
                )
            correct = short_summary(f"{concept['term']}: {concept['summary']}", 220)
            prompt = (
                f"In the context of {concept['chapter_title']}, which statement is most consistent with the textbook’s explanation of "
                f"{concept['term']}?"
            )
            hint = "Choose the statement that preserves both the term and its chapter-specific meaning."
            explanation = f"The correct statement keeps {concept['term']} tied to the idea presented in {concept['chapter_title']}."
            payload = build_mcq(prompt, correct, distractors, hint, explanation)

        payload["difficulty"] = difficulty
        payload["source"] = {
            "term": concept["term"],
            "chapterTitle": concept["chapter_title"],
        }
        questions.append(payload)

    return questions


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def process_book(book: BookSpec, skip_download: bool) -> dict[str, Any]:
    book_raw_dir = RAW_ROOT / book.slug
    pdf_path = book_raw_dir / "source.pdf"
    if skip_download and not pdf_path.exists():
        for manifest_path in (DATA_ROOT / "raw").glob("*/manifest.json"):
            try:
                legacy_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            binary_path = legacy_manifest.get("binary", {}).get("path")
            if legacy_manifest.get("sourceUrl") == book.url and binary_path and Path(binary_path).exists():
                pdf_path = Path(binary_path)
                break
    if not skip_download or not pdf_path.exists():
        run_curl_download(book.url, pdf_path)

    reader = PdfReader(str(pdf_path))
    outline_entries = flatten_outline(reader)
    chapters = choose_chapters(outline_entries, len(reader.pages))
    if len(chapters) < 5:
        chapters = choose_chapters_from_toc(reader)
    if len(chapters) < 5:
        raise RuntimeError(f"Could not identify enough chapters for {book.title}.")

    concepts: list[dict[str, Any]] = []
    chapter_payloads: list[dict[str, Any]] = []

    for chapter in chapters:
        chapter_text = extract_text(reader, chapter["start_page"], chapter["end_page"])
        chapter_dir = CHAPTER_ROOT / book.slug
        chapter_file = chapter_dir / f"{chapter['ordinal']:03d}-{slugify(chapter['title'])}.json"
        chapter_payload = {
            "book": {
                "title": book.title,
                "parentTopic": book.parent_topic,
                "subtopic": book.subtopic,
                "slug": book.slug,
            },
            "chapter": {
                "ordinal": chapter["ordinal"],
                "title": chapter["title"],
                "startPage": chapter["start_page"] + 1,
                "endPage": chapter["end_page"] + 1,
            },
            "text": chapter_text,
        }
        write_json(chapter_file, chapter_payload)
        chapter_payloads.append(
            {
                "ordinal": chapter["ordinal"],
                "title": chapter["title"],
                "startPage": chapter["start_page"] + 1,
                "endPage": chapter["end_page"] + 1,
                "path": str(chapter_file),
            }
        )
        concepts.extend(concept_candidates_from_outline(reader, chapter, outline_entries))
        concepts.extend(definition_candidates(chapter["title"], chapter_text))

    concepts = dedupe_concepts(concepts)
    if len(concepts) < 40:
        raise RuntimeError(f"Only extracted {len(concepts)} concepts from {book.title}; not enough for quiz generation.")

    quizzes = {
        "book": {
            "title": book.title,
            "parentTopic": book.parent_topic,
            "subtopic": book.subtopic,
            "slug": book.slug,
            "sourceUrl": book.url,
            "pdfSha256": sha256_file(pdf_path),
        },
        "chapterCount": len(chapter_payloads),
        "conceptCount": len(concepts),
        "chapters": chapter_payloads,
        "quizzes": {
            "easy": generate_questions_for_difficulty("easy", concepts, 100),
            "medium": generate_questions_for_difficulty("medium", concepts, 100),
            "hard": generate_questions_for_difficulty("hard", concepts, 100),
        },
    }
    write_json(QUIZ_ROOT / f"{book.slug}.json", quizzes)
    write_json(
        RAW_ROOT / book.slug / "manifest.json",
        {
            "title": book.title,
            "parentTopic": book.parent_topic,
            "subtopic": book.subtopic,
            "sourceUrl": book.url,
            "pdfPath": str(pdf_path),
            "pdfSha256": sha256_file(pdf_path),
            "pageCount": len(reader.pages),
            "outlineEntries": len(outline_entries),
            "chapterCount": len(chapter_payloads),
            "conceptCount": len(concepts),
        },
    )
    return {
        "slug": book.slug,
        "title": book.title,
        "pageCount": len(reader.pages),
        "chapterCount": len(chapter_payloads),
        "conceptCount": len(concepts),
        "quizPath": str(QUIZ_ROOT / f"{book.slug}.json"),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-download", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--seed", type=int, default=7)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    random.seed(args.seed)
    selected = BOOKS[: args.limit] if args.limit else BOOKS
    results = []
    for book in selected:
        results.append(process_book(book, skip_download=args.skip_download))
        print(json.dumps(results[-1]))
    write_json(DATA_ROOT / "run-summary.json", {"books": results})


if __name__ == "__main__":
    main()
