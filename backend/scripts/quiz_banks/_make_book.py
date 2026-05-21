"""Build Book instances from compact question specs."""
from __future__ import annotations

from quiz_banks._common import Book, Q

# Each spec: (chapter, prompt, correct, distractors[3], explanation, wrong_by_distractor_text)
QuestionSpec = tuple[str, str, str, list[str], str, dict[str, str]]


def specs_to_questions(specs: list[QuestionSpec]) -> list[Q]:
    questions: list[Q] = []
    for chapter, prompt, correct, distractors, explanation, wrong in specs:
        if len(distractors) != 3:
            raise ValueError(f"Expected 3 distractors for prompt: {prompt[:40]}")
        questions.append(
            Q(
                chapter=chapter,
                prompt=prompt,
                correct=correct,
                distractors=distractors,
                explanation=explanation,
                wrong=wrong,
            ),
        )
    return questions


def make_book(
    *,
    title: str,
    parent_topic: str,
    subtopic: str,
    slug: str,
    source_url: str,
    easy: list[QuestionSpec],
    medium: list[QuestionSpec],
    hard: list[QuestionSpec],
) -> Book:
    if len(easy) != 20 or len(medium) != 20 or len(hard) != 20:
        raise ValueError(
            f"{slug}: expected 20 questions per difficulty "
            f"(easy={len(easy)}, medium={len(medium)}, hard={len(hard)})",
        )
    return Book(
        title=title,
        parent_topic=parent_topic,
        subtopic=subtopic,
        slug=slug,
        source_url=source_url,
        easy=specs_to_questions(easy),
        medium=specs_to_questions(medium),
        hard=specs_to_questions(hard),
    )
