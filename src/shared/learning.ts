import type {
  AnalyticsSnapshot,
  CalendarState,
  LearningState,
  LearningSubject,
  LearningSuggestion,
  Settings,
  TaskTag,
} from './types';

export const DEFAULT_LEARNING_TAXONOMY: LearningSubject[] = [
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

export function isBlockingFeatureEnabled(settings: Pick<Settings, 'featureFlags'>): boolean {
  return settings.featureFlags.blocking;
}

export function isRoutinesFeatureEnabled(settings: Pick<Settings, 'featureFlags'>): boolean {
  return settings.featureFlags.routines;
}

export function isLearningFeatureEnabled(settings: Pick<Settings, 'featureFlags'>): boolean {
  return settings.featureFlags.learning;
}

export function deriveLearningSuggestions(input: {
  analyticsSnapshot: AnalyticsSnapshot | null;
  calendarState: CalendarState | null;
  taskTags: TaskTag[];
  settings: Pick<Settings, 'learningSettings'>;
  existingTopicKeys: string[];
}): LearningSuggestion[] {
  if (!input.settings.learningSettings.suggestTopicsFromActivity) {
    return [];
  }

  const suggestions = new Map<string, LearningSuggestion>();
  const existing = new Set(input.existingTopicKeys);

  const addSuggestion = (
    topicKey: string,
    label: string,
    subjectKey: string | null,
    reason: string,
    source: LearningSuggestion['source'],
  ) => {
    if (existing.has(topicKey) || suggestions.has(topicKey)) return;
    suggestions.set(topicKey, {
      id: `${source}:${topicKey}`,
      topicKey,
      label,
      subjectKey,
      reason,
      source,
    });
  };

  for (const subject of DEFAULT_LEARNING_TAXONOMY) {
    for (const topic of subject.topics) {
      if (input.calendarState?.currentEvent?.title?.toLowerCase().includes(topic.label.toLowerCase())) {
        addSuggestion(
          topic.key,
          topic.label,
          subject.key,
          `Current calendar work looks related to ${topic.label}.`,
          'calendar',
        );
      }

      const matchingTag = input.taskTags.find((tag) =>
        tag.label.toLowerCase() === topic.label.toLowerCase() ||
        tag.aliases.some((alias) => alias.toLowerCase() === topic.label.toLowerCase()),
      );
      if (matchingTag) {
        addSuggestion(
          topic.key,
          topic.label,
          subject.key,
          `${matchingTag.label} already appears in your Window activity tags.`,
          'tag',
        );
      }

      const productiveTopic = input.analyticsSnapshot?.tagBreakdown7d.find((tag) =>
        tag.label.toLowerCase().includes(topic.label.toLowerCase()) ||
        topic.label.toLowerCase().includes(tag.label.toLowerCase()),
      );
      if (productiveTopic) {
        addSuggestion(
          topic.key,
          topic.label,
          subject.key,
          `You've spent meaningful recent time on ${productiveTopic.label}.`,
          'activity',
        );
      }
    }
  }

  return [...suggestions.values()].slice(0, 6);
}

export function mergeLearningState(
  current: LearningState,
  patch: Partial<LearningState>,
): LearningState {
  return {
    ...current,
    ...patch,
  };
}
