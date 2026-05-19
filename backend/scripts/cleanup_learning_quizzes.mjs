import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const inputDir = path.join(repoRoot, 'backend/data/learning/quizzes');
const outputDir = path.join(repoRoot, 'backend/data/learning/quizzes-cleaned');
const reportDir = path.join(repoRoot, 'backend/data/learning/quality-reports');

const GENERIC_TERMS = new Set([
  'exercise',
  'exercises',
  'discussion',
  'discussions',
  'introduction',
  'overview',
  'summary',
  'preface',
  'contents',
  'appendix',
  'there',
  'then',
  'thus',
  'however',
  'example',
  'examples',
]);

function normalizeText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validOptionBody(value) {
  const text = normalizeText(value);
  if (text.length < 3 || text.length > 280) return false;
  if (GENERIC_TERMS.has(text.toLowerCase())) return false;
  return true;
}

function questionScore(question) {
  let score = 0;
  const prompt = normalizeText(question.prompt);
  const chapterTitle = normalizeText(question.source?.chapterTitle ?? '');
  const term = normalizeText(question.source?.term ?? '');
  const choices = Array.isArray(question.choices) ? question.choices : [];
  const uniqueChoiceBodies = new Set(choices.map((choice) => normalizeText(choice.body)).filter(Boolean));

  if (prompt.length >= 60 && prompt.length <= 420) score += 4;
  if (prompt.length >= 80 && prompt.length <= 320) score += 3;
  if (!prompt.includes('\u0012') && !prompt.includes('\u0000')) score += 2;
  if (chapterTitle && !GENERIC_TERMS.has(chapterTitle.toLowerCase())) score += 2;
  if (term && !GENERIC_TERMS.has(term.toLowerCase())) score += 3;
  if (choices.length === 4) score += 2;
  if (uniqueChoiceBodies.size === 4) score += 4;
  if (validOptionBody(question.hint ?? '')) score += 1;
  if (validOptionBody(question.explanation ?? '')) score += 1;

  for (const choice of choices) {
    const body = normalizeText(choice.body);
    if (validOptionBody(body)) score += 0.5;
    if (/^[A-Z][A-Za-z0-9\-,'()/: ]+$/.test(body)) score += 0.5;
  }

  if (prompt.toLowerCase().includes('which statement is most consistent')) score += 1;
  if (prompt.toLowerCase().includes('which description best matches')) score += 1;
  if (prompt.toLowerCase().includes('which term best matches')) score += 1;

  return score;
}

function buildCandidatePool(questions, difficulty) {
  const pool = new Set();
  for (const question of questions) {
    const sourceTerm = normalizeText(question.source?.term ?? '');
    if (difficulty === 'easy' && validOptionBody(sourceTerm)) {
      pool.add(sourceTerm);
    }
    for (const choice of question.choices ?? []) {
      const body = normalizeText(choice.body);
      if (validOptionBody(body)) pool.add(body);
    }
  }
  return [...pool];
}

function rewriteChoices(question, candidatePool) {
  const choices = Array.isArray(question.choices) ? question.choices : [];
  const correctChoiceId = normalizeText(question.correctChoiceId);
  const correctChoice = choices.find((choice) => normalizeText(choice.id) === correctChoiceId);
  if (!correctChoice) return null;

  const uniqueBodies = new Set();
  const rewritten = [];

  const addChoice = (body) => {
    const normalized = normalizeText(body);
    if (!validOptionBody(normalized) || uniqueBodies.has(normalized)) return false;
    uniqueBodies.add(normalized);
    rewritten.push(normalized);
    return true;
  };

  addChoice(correctChoice.body);

  for (const choice of choices) {
    if (normalizeText(choice.id) === correctChoiceId) continue;
    addChoice(choice.body);
    if (rewritten.length === 4) break;
  }

  for (const candidate of candidatePool) {
    if (rewritten.length === 4) break;
    if (candidate === normalizeText(correctChoice.body)) continue;
    addChoice(candidate);
  }

  if (rewritten.length < 4) return null;

  const shuffled = rewritten.slice(0, 4);
  const ids = ['a', 'b', 'c', 'd'];
  const newChoices = shuffled.map((body, index) => ({
    id: ids[index],
    label: ids[index].toUpperCase(),
    body,
  }));
  const newCorrectChoiceId = newChoices.find((choice) => choice.body === normalizeText(correctChoice.body))?.id ?? 'a';
  const wrongAnswerExplanations = Object.fromEntries(
    newChoices
      .filter((choice) => choice.id !== newCorrectChoiceId)
      .map((choice) => [choice.id, 'This option does not match the cited textbook material.']),
  );

  return {
    ...question,
    prompt: normalizeText(question.prompt),
    hint: normalizeText(question.hint),
    explanation: normalizeText(question.explanation),
    choices: newChoices,
    correctChoiceId: newCorrectChoiceId,
    wrongAnswerExplanations,
  };
}

async function processFile(filename) {
  const fullPath = path.join(inputDir, filename);
  const raw = JSON.parse(await fs.readFile(fullPath, 'utf8'));
  const report = {
    file: filename,
    before: {},
    after: {},
  };

  const cleaned = {
    ...raw,
    cleanupReport: {
      generatedAt: new Date().toISOString(),
      sourceFile: fullPath,
    },
    quizzes: {},
  };

  for (const difficulty of ['easy', 'medium', 'hard']) {
    const questions = Array.isArray(raw.quizzes?.[difficulty]) ? raw.quizzes[difficulty] : [];
    const candidatePool = buildCandidatePool(questions, difficulty);
    report.before[difficulty] = {
      count: questions.length,
      avgScore:
        questions.length > 0
          ? Number((questions.reduce((sum, question) => sum + questionScore(question), 0) / questions.length).toFixed(2))
          : 0,
    };

    const rewritten = questions
      .map((question, index) => {
        const normalized = rewriteChoices(question, candidatePool);
        if (!normalized) return null;
        return {
          ...normalized,
          qualityScore: Number(questionScore(normalized).toFixed(2)),
          originalOrdinal: index + 1,
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.qualityScore - left.qualityScore || left.originalOrdinal - right.originalOrdinal)
      .map((question, index) => ({
        ...question,
        cleanedOrdinal: index + 1,
      }));

    cleaned.quizzes[difficulty] = rewritten;
    report.after[difficulty] = {
      count: rewritten.length,
      avgScore:
        rewritten.length > 0
          ? Number((rewritten.reduce((sum, question) => sum + question.qualityScore, 0) / rewritten.length).toFixed(2))
          : 0,
      topScore: rewritten[0]?.qualityScore ?? 0,
      lowScore: rewritten.at(-1)?.qualityScore ?? 0,
    };
  }

  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, filename), `${JSON.stringify(cleaned, null, 2)}\n`, 'utf8');
  await fs.writeFile(
    path.join(reportDir, filename.replace(/\.json$/, '.report.json')),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  return report;
}

async function main() {
  const filenames = (await fs.readdir(inputDir)).filter((filename) => filename.endsWith('.json')).sort();
  const reports = [];
  for (const filename of filenames) {
    const report = await processFile(filename);
    reports.push(report);
    console.log(JSON.stringify(report));
  }
}

await main();
