import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const inputDir = path.join(repoRoot, 'backend/data/learning/quizzes-cleaned');
dotenv.config({ path: path.join(repoRoot, 'backend/.env') });
const prisma = new PrismaClient();

const SUBJECT_KEY_BY_LABEL = {
  'AI & Machine Learning': 'ai-ml',
  'Computer Science': 'computer-science',
  Mathematics: 'mathematics',
  Physics: 'physics',
  Chemistry: 'chemistry',
  'Biology & Medicine': 'biology-medicine',
  Engineering: 'engineering',
  'Economics & Finance': 'economics-finance',
  'History & Politics': 'history-politics',
  'Philosophy & Psychology': 'philosophy-psychology',
  'Writing & Communication': 'writing-communication',
  Languages: 'languages',
  'Art & Design': 'art-design',
};

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseArgs(argv) {
  const args = {
    replace: true,
    activateUserEmail: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--no-replace') args.replace = false;
    if (arg === '--activate-user-email') args.activateUserEmail = argv[index + 1] ?? null;
  }
  return args;
}

async function ensureTopicForBook(book) {
  const subjectKey = SUBJECT_KEY_BY_LABEL[book.parentTopic] ?? slugify(book.parentTopic);
  const topicKey = slugify(book.subtopic);
  const subject = await prisma.learningSubject.upsert({
    where: { key: subjectKey },
    update: {
      label: book.parentTopic,
      description: book.parentTopic,
    },
    create: {
      key: subjectKey,
      label: book.parentTopic,
      description: book.parentTopic,
    },
  });

  return prisma.learningTopic.upsert({
    where: { key: topicKey },
    update: {
      label: book.subtopic,
      description: `Imported learning topic for ${book.subtopic}.`,
      subjectId: subject.id,
    },
    create: {
      key: topicKey,
      label: book.subtopic,
      description: `Imported learning topic for ${book.subtopic}.`,
      subjectId: subject.id,
    },
  });
}

async function replaceExistingPack(topicId) {
  const existingPacks = await prisma.quizPack.findMany({
    where: {
      topicId,
      canonical: true,
      sourceKind: 'textbook',
    },
    select: { id: true, sourceId: true },
  });

  for (const pack of existingPacks) {
    await prisma.quizPack.delete({
      where: { id: pack.id },
    });
    if (pack.sourceId) {
      await prisma.learningSource.deleteMany({
        where: { id: pack.sourceId },
      });
    }
  }
}

async function importFile(filename, options) {
  const fullPath = path.join(inputDir, filename);
  const payload = JSON.parse(await fs.readFile(fullPath, 'utf8'));
  const topic = await ensureTopicForBook(payload.book);

  if (options.replace) {
    await replaceExistingPack(topic.id);
  }

  const source = await prisma.learningSource.create({
    data: {
      topicId: topic.id,
      title: payload.book.title,
      provider: 'Imported textbook corpus',
      sourceKind: 'textbook',
      licenseMode: 'commercial_safe',
      sourceUrl: payload.book.sourceUrl ?? null,
    },
  });

  const document = await prisma.learningDocument.create({
    data: {
      sourceId: source.id,
      title: payload.book.title,
      sourceUrl: payload.book.sourceUrl ?? null,
      content: `Imported chapter corpus for ${payload.book.title}.`,
    },
  });

  const createdChapters = [];
  for (const chapter of payload.chapters ?? []) {
    const created = await prisma.learningChapter.create({
      data: {
        documentId: document.id,
        ordinal: chapter.ordinal,
        title: normalizeText(chapter.title),
        summary: `Imported from pages ${chapter.startPage}-${chapter.endPage}.`,
      },
    });
    createdChapters.push(created);
  }
  const chapterIdByTitle = new Map(createdChapters.map((chapter) => [chapter.title, chapter.id]));

  const pack = await prisma.quizPack.create({
    data: {
      topicId: topic.id,
      sourceId: source.id,
      title: `${topic.label} Mastery Pack`,
      sourceKind: 'textbook',
      status: 'ready',
      canonical: true,
    },
  });

  const packVersion = await prisma.quizPackVersion.create({
    data: {
      packId: pack.id,
      versionNumber: 1,
      licenseMode: 'commercial_safe',
      generatedNote: `Imported from cleaned quiz artifact ${filename}.`,
    },
  });

  const difficulties = ['easy', 'medium', 'hard'];
  let ordinal = 0;
  for (const difficulty of difficulties) {
    for (const question of payload.quizzes?.[difficulty] ?? []) {
      ordinal += 1;
      const chapterTitle = normalizeText(question.source?.chapterTitle ?? '');
      const chapterId = chapterIdByTitle.get(chapterTitle) ?? null;
      await prisma.quizQuestion.create({
        data: {
          packVersionId: packVersion.id,
          chapterId,
          ordinal,
          difficulty,
          prompt: normalizeText(question.prompt),
          choices: question.choices,
          correctChoiceId: question.correctChoiceId,
          hint: normalizeText(question.hint),
          explanation: normalizeText(question.explanation),
          wrongAnswerExplanations: question.wrongAnswerExplanations ?? {},
          artifactType: null,
          artifactData: null,
        },
      });
    }
  }

  if (options.activateUserEmail) {
    const user = await prisma.user.findUnique({
      where: { email: options.activateUserEmail },
      select: { id: true },
    });
    if (user) {
      await prisma.userLearningTopic.upsert({
        where: {
          userId_topicId: {
            userId: user.id,
            topicId: topic.id,
          },
        },
        update: {
          active: true,
          source: 'catalog',
        },
        create: {
          userId: user.id,
          topicId: topic.id,
          source: 'catalog',
          active: true,
        },
      });
    }
  }

  return {
    file: filename,
    topicKey: topic.key,
    topicLabel: topic.label,
    packId: pack.id,
    packVersionId: packVersion.id,
    questionCount:
      (payload.quizzes?.easy?.length ?? 0) +
      (payload.quizzes?.medium?.length ?? 0) +
      (payload.quizzes?.hard?.length ?? 0),
    chapterCount: createdChapters.length,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = (await fs.readdir(inputDir)).filter((file) => file.endsWith('.json')).sort();
  const results = [];
  try {
    for (const file of files) {
      const result = await importFile(file, options);
      results.push(result);
      console.log(JSON.stringify(result));
    }
  } finally {
    await prisma.$disconnect();
  }
}

await main();
