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
    description: 'Modeling, training systems, and modern AI applications.',
    topics: [
      { key: 'machine-learning', label: 'Machine Learning', description: 'Core ML concepts, supervised learning, and evaluation.' },
      { key: 'deep-learning', label: 'Deep Learning', description: 'Neural networks, optimization, and architectures.' },
      { key: 'transformers', label: 'Transformers', description: 'Attention models, LLMs, and sequence modeling.' },
      { key: 'reinforcement-learning', label: 'Reinforcement Learning', description: 'Policies, reward shaping, and exploration.' },
      { key: 'ml-systems', label: 'ML Systems', description: 'Serving, data pipelines, and model operations.' },
    ],
  },
  {
    key: 'computer-science',
    label: 'Computer Science',
    description: 'Algorithms, systems, and software fundamentals.',
    topics: [
      { key: 'algorithms', label: 'Algorithms', description: 'Problem solving, complexity, and data structures.' },
      { key: 'operating-systems', label: 'Operating Systems', description: 'Processes, memory, concurrency, and kernels.' },
      { key: 'distributed-systems', label: 'Distributed Systems', description: 'Replication, consensus, and fault tolerance.' },
      { key: 'databases', label: 'Databases', description: 'Storage engines, transactions, and query planning.' },
      { key: 'networking', label: 'Networking', description: 'Protocols, routing, and internet architecture.' },
    ],
  },
  {
    key: 'mathematics',
    label: 'Mathematics',
    description: 'Foundational mathematical reasoning and methods.',
    topics: [
      { key: 'linear-algebra', label: 'Linear Algebra', description: 'Vectors, matrices, eigensystems, and transformations.' },
      { key: 'probability', label: 'Probability', description: 'Random variables, distributions, and inference.' },
      { key: 'statistics', label: 'Statistics', description: 'Estimation, testing, and experimental reasoning.' },
      { key: 'calculus', label: 'Calculus', description: 'Differentiation, integration, and multivariable analysis.' },
      { key: 'discrete-math', label: 'Discrete Math', description: 'Logic, combinatorics, and graph structures.' },
    ],
  },
  {
    key: 'physics',
    label: 'Physics',
    description: 'Physical laws, modeling, and quantitative reasoning.',
    topics: [
      { key: 'classical-mechanics', label: 'Classical Mechanics', description: 'Motion, force, and energy.' },
      { key: 'electromagnetism', label: 'Electromagnetism', description: 'Fields, circuits, and Maxwell equations.' },
      { key: 'thermodynamics', label: 'Thermodynamics', description: 'Heat, entropy, and equilibrium.' },
      { key: 'quantum-mechanics', label: 'Quantum Mechanics', description: 'Wavefunctions, operators, and measurement.' },
    ],
  },
  {
    key: 'chemistry',
    label: 'Chemistry',
    description: 'Structure, reactions, and physical behavior of matter.',
    topics: [
      { key: 'organic-chemistry', label: 'Organic Chemistry', description: 'Carbon chemistry, mechanisms, and synthesis.' },
      { key: 'inorganic-chemistry', label: 'Inorganic Chemistry', description: 'Metals, complexes, and periodic structure.' },
      { key: 'physical-chemistry', label: 'Physical Chemistry', description: 'Kinetics, thermodynamics, and quantum models.' },
      { key: 'analytical-chemistry', label: 'Analytical Chemistry', description: 'Measurement, spectroscopy, and separation.' },
    ],
  },
  {
    key: 'biology-medicine',
    label: 'Biology & Medicine',
    description: 'Living systems, physiology, and health sciences.',
    topics: [
      { key: 'cell-biology', label: 'Cell Biology', description: 'Cell structure, signaling, and organelles.' },
      { key: 'genetics', label: 'Genetics', description: 'Inheritance, expression, and genomic reasoning.' },
      { key: 'biochemistry', label: 'Biochemistry', description: 'Proteins, metabolism, and molecular interactions.' },
      { key: 'physiology', label: 'Physiology', description: 'Organ systems and biological regulation.' },
    ],
  },
  {
    key: 'engineering',
    label: 'Engineering',
    description: 'Applied design, systems, and quantitative problem solving.',
    topics: [
      { key: 'electrical-engineering', label: 'Electrical Engineering', description: 'Signals, circuits, and embedded concepts.' },
      { key: 'mechanical-engineering', label: 'Mechanical Engineering', description: 'Dynamics, design, and materials.' },
      { key: 'control-systems', label: 'Control Systems', description: 'Feedback, stability, and system dynamics.' },
      { key: 'materials-science', label: 'Materials Science', description: 'Structure-property relationships and failure.' },
    ],
  },
  {
    key: 'economics-finance',
    label: 'Economics & Finance',
    description: 'Markets, incentives, capital, and decision making.',
    topics: [
      { key: 'microeconomics', label: 'Microeconomics', description: 'Consumer behavior, firms, and market structure.' },
      { key: 'macroeconomics', label: 'Macroeconomics', description: 'Growth, inflation, and policy.' },
      { key: 'corporate-finance', label: 'Corporate Finance', description: 'Valuation, capital allocation, and risk.' },
      { key: 'investing', label: 'Investing', description: 'Portfolio construction, markets, and performance.' },
    ],
  },
  {
    key: 'history-politics',
    label: 'History & Politics',
    description: 'Institutions, political thought, and historical change.',
    topics: [
      { key: 'modern-history', label: 'Modern History', description: 'Global developments from the early modern period onward.' },
      { key: 'political-theory', label: 'Political Theory', description: 'Statecraft, liberty, and governance.' },
      { key: 'international-relations', label: 'International Relations', description: 'Power, diplomacy, and conflict.' },
      { key: 'public-policy', label: 'Public Policy', description: 'Policy design, evaluation, and institutions.' },
    ],
  },
  {
    key: 'philosophy-psychology',
    label: 'Philosophy & Psychology',
    description: 'Thinking, behavior, and human experience.',
    topics: [
      { key: 'ethics', label: 'Ethics', description: 'Normative reasoning and moral frameworks.' },
      { key: 'cognitive-psychology', label: 'Cognitive Psychology', description: 'Memory, perception, and attention.' },
      { key: 'behavioral-psychology', label: 'Behavioral Psychology', description: 'Learning, conditioning, and behavior.' },
      { key: 'logic', label: 'Logic', description: 'Inference, argument structure, and validity.' },
    ],
  },
  {
    key: 'writing-communication',
    label: 'Writing & Communication',
    description: 'Craft, rhetoric, and clear thinking on the page.',
    topics: [
      { key: 'technical-writing', label: 'Technical Writing', description: 'Clear documentation and explanatory writing.' },
      { key: 'storytelling', label: 'Storytelling', description: 'Narrative structure and reader engagement.' },
      { key: 'rhetoric', label: 'Rhetoric', description: 'Argument, persuasion, and framing.' },
      { key: 'public-speaking', label: 'Public Speaking', description: 'Delivery, structure, and audience adaptation.' },
    ],
  },
  {
    key: 'languages',
    label: 'Languages',
    description: 'Language acquisition, grammar, and comprehension.',
    topics: [
      { key: 'english-composition', label: 'English Composition', description: 'Usage, clarity, and structured writing.' },
      { key: 'spanish', label: 'Spanish', description: 'Vocabulary, grammar, and comprehension.' },
      { key: 'mandarin', label: 'Mandarin', description: 'Pronunciation, characters, and grammar.' },
      { key: 'linguistics', label: 'Linguistics', description: 'Syntax, phonology, and language structure.' },
    ],
  },
  {
    key: 'art-design',
    label: 'Art & Design',
    description: 'Visual systems, craft, and creative expression.',
    topics: [
      { key: 'design-systems', label: 'Design Systems', description: 'Components, consistency, and scale.' },
      { key: 'ui-design', label: 'UI Design', description: 'Interface layout, hierarchy, and interaction.' },
      { key: 'art-history', label: 'Art History', description: 'Movements, context, and visual interpretation.' },
      { key: 'color-theory', label: 'Color Theory', description: 'Contrast, harmony, and perception.' },
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
