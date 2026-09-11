import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const inputDir = path.join(repoRoot, 'backend/data/learning/quizzes-cleaned');

const EXPECTED_PER_DIFFICULTY = 20;
const DIFFICULTIES = ['easy', 'medium', 'hard'];

const BANNED_PROMPT_PATTERNS = [
  /textbook description/i,
  /best matches this/i,
  /from the (chapter|source)/i,
  /which term best matches/i,
];

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function validateQuestion(question, context) {
  const errors = [];
  const prompt = normalizeText(question.prompt);
  const choices = Array.isArray(question.choices) ? question.choices : [];
  const choiceIds = new Set(choices.map((choice) => choice.id));
  const wrong = question.wrongAnswerExplanations ?? {};

  if (prompt.length < 12 || prompt.length > 500) {
    errors.push(`${context}: prompt length out of range (${prompt.length})`);
  }

  for (const pattern of BANNED_PROMPT_PATTERNS) {
    if (pattern.test(prompt)) {
      errors.push(`${context}: banned prompt phrasing (${pattern})`);
    }
  }

  if (choices.length !== 4) {
    errors.push(`${context}: expected 4 choices, got ${choices.length}`);
  }

  const bodies = choices.map((choice) => normalizeText(choice.body));
  if (new Set(bodies).size !== 4) {
    errors.push(`${context}: choice bodies must be unique`);
  }

  if (!choiceIds.has(question.correctChoiceId)) {
    errors.push(`${context}: correctChoiceId not in choices`);
  }

  for (const choice of choices) {
    if (choice.id === question.correctChoiceId) continue;
    if (!wrong[choice.id]) {
      errors.push(`${context}: missing wrongAnswerExplanations for choice ${choice.id}`);
    }
  }

  if (!normalizeText(question.explanation)) {
    errors.push(`${context}: missing explanation`);
  }

  return errors;
}

async function validateFile(filename) {
  const fullPath = path.join(inputDir, filename);
  const payload = JSON.parse(await fs.readFile(fullPath, 'utf8'));
  const errors = [];

  if (!payload.book?.slug) {
    errors.push(`${filename}: missing book.slug`);
  }

  for (const difficulty of DIFFICULTIES) {
    const questions = payload.quizzes?.[difficulty] ?? [];
    if (questions.length === 0) {
      errors.push(
        `${filename}: ${difficulty} has no questions (expected at least 1)`,
      );
    } else if (questions.length !== EXPECTED_PER_DIFFICULTY) {
      console.log(
        `NOTE ${filename}: ${difficulty} has ${questions.length} questions (legacy standard was ${EXPECTED_PER_DIFFICULTY}; curated banks vary by chapter)`,
      );
    }
    questions.forEach((question, index) => {
      errors.push(
        ...validateQuestion(question, `${filename} ${difficulty} #${index + 1}`),
      );
    });
  }

  return {
    file: filename,
    slug: payload.book?.slug ?? null,
    topicKey: payload.book?.subtopic ?? null,
    ok: errors.length === 0,
    errors,
  };
}

async function main() {
  const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
  const only = onlyArg
    ? new Set(onlyArg.slice('--only='.length).split(',').map((v) => v.trim()).filter(Boolean))
    : null;

  const files = (await fs.readdir(inputDir))
    .filter((file) => file.endsWith('.json'))
    .sort();

  const results = [];
  for (const file of files) {
    if (only && !only.has(file.replace(/\.json$/, ''))) {
      continue;
    }
    results.push(await validateFile(file));
  }

  let failed = 0;
  for (const result of results) {
    if (result.ok) {
      console.log(`OK ${result.file} (${result.slug})`);
      continue;
    }
    failed += 1;
    console.error(`FAIL ${result.file}`);
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
  }

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
