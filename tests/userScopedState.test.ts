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
import { clearUserScopedLocalState, signOutAccount } from '../src/background/backend';
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
});
