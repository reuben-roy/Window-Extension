import type { PrismaClient, QuizDifficulty } from '@prisma/client';

export interface LearningTaxonomySeed {
  key: string;
  label: string;
  description: string;
  topics: Array<{
    key: string;
    label: string;
    description: string;
  }>;
}

export const LEARNING_TAXONOMY: LearningTaxonomySeed[] = [
  {
    key: 'ai-ml',
    label: 'AI & Machine Learning',
    description: 'Modeling, optimization, and modern AI systems.',
    topics: [
      { key: 'machine-learning', label: 'Machine Learning', description: 'Core ML concepts and evaluation.' },
      { key: 'deep-learning', label: 'Deep Learning', description: 'Neural network architectures and training.' },
      { key: 'transformers', label: 'Transformers', description: 'Attention models and LLM mechanics.' },
      { key: 'reinforcement-learning', label: 'Reinforcement Learning', description: 'Policies, rewards, and exploration.' },
    ],
  },
  {
    key: 'computer-science',
    label: 'Computer Science',
    description: 'Algorithms, systems, and computational reasoning.',
    topics: [
      { key: 'algorithms', label: 'Algorithms', description: 'Complexity, data structures, and design patterns.' },
      { key: 'operating-systems', label: 'Operating Systems', description: 'Memory, processes, and scheduling.' },
      { key: 'distributed-systems', label: 'Distributed Systems', description: 'Consensus, replication, and coordination.' },
      { key: 'databases', label: 'Databases', description: 'Transactions, indexing, and query planning.' },
    ],
  },
  {
    key: 'mathematics',
    label: 'Mathematics',
    description: 'Mathematical foundations for quantitative work.',
    topics: [
      { key: 'linear-algebra', label: 'Linear Algebra', description: 'Vectors, matrices, and eigensystems.' },
      { key: 'probability', label: 'Probability', description: 'Randomness, distributions, and expectation.' },
      { key: 'statistics', label: 'Statistics', description: 'Inference, estimation, and testing.' },
      { key: 'calculus', label: 'Calculus', description: 'Derivatives, integrals, and multivariable methods.' },
    ],
  },
  {
    key: 'chemistry',
    label: 'Chemistry',
    description: 'Chemical structure, reactions, and physical behavior.',
    topics: [
      { key: 'organic-chemistry', label: 'Organic Chemistry', description: 'Mechanisms, synthesis, and carbon chemistry.' },
      { key: 'inorganic-chemistry', label: 'Inorganic Chemistry', description: 'Coordination compounds and periodic trends.' },
      { key: 'physical-chemistry', label: 'Physical Chemistry', description: 'Kinetics, thermodynamics, and quantum models.' },
      { key: 'analytical-chemistry', label: 'Analytical Chemistry', description: 'Measurement and instrumental techniques.' },
    ],
  },
  {
    key: 'physics',
    label: 'Physics',
    description: 'Physical laws, systems, and mathematical models.',
    topics: [
      { key: 'classical-mechanics', label: 'Classical Mechanics', description: 'Motion, energy, and force.' },
      { key: 'electromagnetism', label: 'Electromagnetism', description: 'Fields, charges, and circuits.' },
      { key: 'thermodynamics', label: 'Thermodynamics', description: 'Heat, work, and entropy.' },
      { key: 'quantum-mechanics', label: 'Quantum Mechanics', description: 'States, operators, and measurement.' },
    ],
  },
];

export async function ensureLearningCatalogSeeded(prisma: PrismaClient): Promise<void> {
  for (const subject of LEARNING_TAXONOMY) {
    const savedSubject = await prisma.learningSubject.upsert({
      where: { key: subject.key },
      update: {
        label: subject.label,
        description: subject.description,
      },
      create: {
        key: subject.key,
        label: subject.label,
        description: subject.description,
      },
    });

    for (const topic of subject.topics) {
      await prisma.learningTopic.upsert({
        where: { key: topic.key },
        update: {
          label: topic.label,
          description: topic.description,
          subjectId: savedSubject.id,
        },
        create: {
          key: topic.key,
          label: topic.label,
          description: topic.description,
          subjectId: savedSubject.id,
        },
      });
    }
  }
}

export function topicKeyFromLabel(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `topic-${Date.now()}`;
}

export function sampleChaptersForTopic(topicLabel: string): string[] {
  return [
    `${topicLabel}: Foundations`,
    `${topicLabel}: Mental Models`,
    `${topicLabel}: Applied Reasoning`,
  ];
}

export function quizPointsForDifficulty(difficulty: QuizDifficulty): number {
  if (difficulty === 'hard') return 8;
  if (difficulty === 'medium') return 5;
  return 3;
}

export function computeNextReviewSchedule(input: {
  correct: boolean;
  ease: number;
  seenCount: number;
  correctStreak: number;
  now?: Date;
}): { ease: number; dueAt: Date; correctStreak: number } {
  const now = input.now ?? new Date();
  const nextEase = Math.max(
    1.3,
    Math.min(
      3.0,
      input.correct ? input.ease + 0.08 : input.ease - 0.2,
    ),
  );
  const nextStreak = input.correct ? input.correctStreak + 1 : 0;
  const baseDays = input.correct
    ? Math.max(1, Math.round(Math.pow(nextEase, Math.min(input.seenCount + 1, 4))))
    : 1;
  const jitterHours = input.correct ? Math.floor(Math.random() * 12) : 2;
  const dueAt = new Date(now.getTime() + ((baseDays * 24) + jitterHours) * 60 * 60 * 1000);
  return {
    ease: nextEase,
    dueAt,
    correctStreak: nextStreak,
  };
}

export function buildSampleQuestions(
  topicLabel: string,
  chapterTitle: string,
  offset: number,
): Array<{
  ordinal: number;
  difficulty: QuizDifficulty;
  prompt: string;
  choices: Array<{ id: string; label: string; body: string }>;
  correctChoiceId: string;
  hint: string;
  explanation: string;
  wrongAnswerExplanations: Record<string, string>;
}> {
  const difficulties: QuizDifficulty[] = ['easy', 'medium', 'hard'];
  return difficulties.map((difficulty, index) => {
    const ordinal = offset + index + 1;
    const correctChoiceId = 'b';
    return {
      ordinal,
      difficulty,
      prompt:
        difficulty === 'easy'
          ? `Which statement best captures the central idea of ${chapterTitle}?`
          : difficulty === 'medium'
            ? `In ${topicLabel}, what tradeoff is most important when applying the ideas from ${chapterTitle}?`
            : `Which explanation shows the strongest command of ${topicLabel} in the context of ${chapterTitle}?`,
      choices: [
        { id: 'a', label: 'A', body: `A shallow restatement that mentions ${topicLabel} but skips the mechanism.` },
        { id: 'b', label: 'B', body: `The option that connects the concept, mechanism, and practical implication of ${chapterTitle}.` },
        { id: 'c', label: 'C', body: `A plausible-sounding claim that confuses examples with first principles.` },
        { id: 'd', label: 'D', body: `An overly broad answer that ignores the actual boundaries of the chapter.` },
      ],
      correctChoiceId,
      hint: `Look for the choice that explains both what ${chapterTitle} is and why it matters.`,
      explanation: `${chapterTitle} is being tested for conceptual understanding, not keyword recognition. The correct answer ties the chapter idea to its operating logic and why that logic matters in practice.`,
      wrongAnswerExplanations: {
        a: 'This is too vague and does not explain the mechanism.',
        c: 'This confuses a nearby example with the underlying concept.',
        d: 'This answer is too broad to be faithful to the chapter.',
      },
    };
  });
}
