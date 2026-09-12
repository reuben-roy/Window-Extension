import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LEARNING_STATE, QUIZ_FAB_SESSION_KEY } from '../src/shared/constants';
import {
  getAnalyticsSnapshot,
  getIdeaRecords,
  getLearningState,
  setAnalyticsSnapshot,
  setIdeaRecords,
  setLearningState,
} from '../src/shared/storage';
import {
  clearUserScopedLocalState,
  refreshLearningState,
  signOutAccount,
} from '../src/background/backend';
import type { IdeaRecord, UserLearningTopic } from '../src/shared/types';

const SAMPLE_TOPIC: UserLearningTopic = {
  id: 'topic-1',
  subjectKey: 'physics',
  topicKey: 'physics.thermodynamics',
  label: 'Thermodynamics',
  source: 'catalog',
  active: true,
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
};

const SAMPLE_IDEA: IdeaRecord = {
  localId: 'idea-1',
  remoteId: null,
  prompt: 'A marketplace for horse breeders',
  status: 'queued',
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
  unread: false,
  saved: false,
  archived: false,
  error: null,
  sessionId: null,
  jobId: null,
  report: null,
};

async function seedUserScopedState(): Promise<void> {
  await setLearningState({
    ...DEFAULT_LEARNING_STATE,
    userTopics: [SAMPLE_TOPIC],
  });
  const analytics = await getAnalyticsSnapshot();
  await setAnalyticsSnapshot({
    ...analytics,
    summary7d: { ...analytics.summary7d, productiveMinutes: 240 },
  });
  await setIdeaRecords([SAMPLE_IDEA]);
  chrome.storage.local.set({ [QUIZ_FAB_SESSION_KEY]: { visible: true, panelVisible: false } });
}

describe('per-user local state separation', () => {
  beforeEach(() => {
    chrome.storage.sync.clear();
    chrome.storage.local.clear();
  });

  it('clearUserScopedLocalState resets learning, analytics, ideas, and the quiz surface', async () => {
    await seedUserScopedState();

    await clearUserScopedLocalState();

    const learning = await getLearningState();
    expect(learning.userTopics).toEqual([]);
    expect(learning.packs).toEqual([]);
    expect(learning.reviewQueue).toEqual([]);
    expect(learning.activeQuizPrompt).toBeNull();

    const analytics = await getAnalyticsSnapshot();
    expect(analytics.summary7d.productiveMinutes).toBe(0);

    expect(await getIdeaRecords()).toEqual([]);

    const fab = await new Promise<Record<string, unknown>>((resolve) => {
      chrome.storage.local.get(QUIZ_FAB_SESSION_KEY, resolve);
    });
    expect(fab[QUIZ_FAB_SESSION_KEY]).toBeUndefined();
  });

  it('signing out clears the previous user’s study topics and analytics', async () => {
    await seedUserScopedState();

    await signOutAccount();

    const learning = await getLearningState();
    expect(learning.userTopics).toEqual([]);

    const analytics = await getAnalyticsSnapshot();
    expect(analytics.summary7d.productiveMinutes).toBe(0);

    expect(await getIdeaRecords()).toEqual([]);
  });

  it('does not leave a cached quiz actionable when there is no backend session', async () => {
    await setLearningState({
      ...DEFAULT_LEARNING_STATE,
      userTopics: [SAMPLE_TOPIC],
      activeQuizPrompt: {
        sessionId: 'session-1',
        questionId: 'question-1',
        progressId: 'progress-1',
        packId: 'pack-1',
        packVersionId: 'pack-version-1',
        topicId: SAMPLE_TOPIC.id,
        topicKey: SAMPLE_TOPIC.topicKey,
        topicLabel: SAMPLE_TOPIC.label,
        packTitle: 'Physics review',
        chapterTitle: 'Thermodynamics',
        chapterOrdinal: 1,
        totalChapters: 3,
        difficulty: 'easy',
        origin: 'review',
        pointsReward: 3,
        streak: 0,
        prompt: 'What is entropy?',
        hint: null,
        explanation: null,
        deepDive: null,
        skillId: null,
        choices: [],
        correctChoiceId: null,
        wrongAnswerExplanations: {},
        artifact: null,
        surfacedAt: '2026-09-11T20:00:00.000Z',
      },
      activeQuizVisible: true,
    });

    const learning = await refreshLearningState();

    expect(learning.activeQuizPrompt).toBeNull();
    expect(learning.activeQuizVisible).toBe(false);
    expect(learning.lastError).toBe('Sign in to review quiz questions.');
  });
});
