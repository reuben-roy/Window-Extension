import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyAccountSnapshot } from '../src/shared/account';
import { DEFAULT_LEARNING_STATE } from '../src/shared/constants';
import { DEFAULT_LEARNING_TAXONOMY } from '../src/shared/learning';
import {
  getAllTimeStats,
  getLearningState,
  setAllTimeStats,
  setBackendSession,
  setLearningState,
} from '../src/shared/storage';
import {
  signInWithProvider,
  syncAccountSnapshot,
} from '../src/background/backend';
import type {
  AccountUser,
  QuizPackSummary,
  UserLearningTopic,
} from '../src/shared/types';

const ACCOUNT_A_TOPIC: UserLearningTopic = {
  id: 'topic-a',
  subjectKey: 'physics',
  topicKey: 'physics.thermodynamics',
  label: 'Thermodynamics',
  source: 'catalog',
  active: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const ACCOUNT_B_TOPIC: UserLearningTopic = {
  id: 'topic-b',
  subjectKey: 'computer-science',
  topicKey: 'computer-science.algorithms',
  label: 'Algorithms',
  source: 'catalog',
  active: true,
  createdAt: '2026-09-02T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
};

const ACCOUNT_B_PACK: QuizPackSummary = {
  id: 'pack-b',
  topicId: ACCOUNT_B_TOPIC.id,
  topicLabel: ACCOUNT_B_TOPIC.label,
  title: 'Algorithms review',
  sourceKind: 'textbook',
  status: 'ready',
  canonical: true,
  chapterCount: 4,
  questionCount: 20,
  versionNumber: 1,
  licenseMode: 'commercial_safe',
  generatedAt: '2026-09-02T00:00:00.000Z',
};

const ACCOUNT_B: AccountUser = {
  id: 'account-b',
  email: 'b@example.com',
  displayName: 'Account B',
  avatarUrl: null,
  providers: ['google'],
  createdAt: '2026-09-02T00:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installAccountBBackend() {
  const uploadedSnapshots: Array<{
    authorization: string | null;
    body: Record<string, unknown>;
  }> = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const path = new URL(url).pathname;

    if (path === '/v1/auth/google/exchange') {
      return jsonResponse({
        sessionToken: 'session-token-b',
        userId: ACCOUNT_B.id,
        expiresAt: '2099-01-01T00:00:00.000Z',
        user: ACCOUNT_B,
      });
    }

    if (path === '/v1/account/snapshot' && (init?.method ?? 'GET') === 'GET') {
      return jsonResponse({
        revision: 0,
        updatedAt: null,
        data: createEmptyAccountSnapshot(),
      });
    }

    if (path === '/v1/account/snapshot' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      uploadedSnapshots.push({
        authorization: new Headers(init.headers).get('Authorization'),
        body,
      });
      return jsonResponse({
        revision: 1,
        updatedAt: '2026-09-02T00:01:00.000Z',
        data: body.data,
      });
    }

    if (path === '/v1/learning/taxonomy') {
      return jsonResponse({ items: DEFAULT_LEARNING_TAXONOMY });
    }
    if (path === '/v1/learning/user-topics') {
      return jsonResponse({ items: [ACCOUNT_B_TOPIC] });
    }
    if (path === '/v1/learning/suggestions') {
      return jsonResponse({ items: [] });
    }
    if (path === '/v1/learning/packs') {
      return jsonResponse({ items: [ACCOUNT_B_PACK] });
    }
    if (path === '/v1/learning/review/next') {
      return jsonResponse({ prompt: null, reviewQueue: [] });
    }

    throw new Error(`Unexpected backend request: ${init?.method ?? 'GET'} ${path}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(chrome.identity.getAuthToken).mockImplementation(((_details, callback) => {
    callback('google-access-token-b');
  }) as typeof chrome.identity.getAuthToken);

  return { fetchMock, uploadedSnapshots };
}

async function seedAccountAState(): Promise<void> {
  await Promise.all([
    chrome.storage.local.set({ lastAccountUserId: 'account-a' }),
    setLearningState({
      ...DEFAULT_LEARNING_STATE,
      taxonomy: DEFAULT_LEARNING_TAXONOMY,
      userTopics: [ACCOUNT_A_TOPIC],
    }),
    setAllTimeStats({
      totalPoints: 9876,
      level: 12,
      title: 'Account A progress',
      prestigeCount: 0,
      tasksCompleted: 321,
      bestWeek: 500,
      currentWeekStreak: 8,
    }),
  ]);
}

describe('browser account isolation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    chrome.storage.sync.clear();
    chrome.storage.local.clear();
  });

  it('clears account A and immediately loads account B learning state after interactive sign-in', async () => {
    await seedAccountAState();
    installAccountBBackend();

    await signInWithProvider('google');

    const learning = await getLearningState();
    expect(learning.userTopics).toEqual([ACCOUNT_B_TOPIC]);
    expect(learning.packs).toEqual([ACCOUNT_B_PACK]);
    expect(learning.taxonomy).toEqual(DEFAULT_LEARNING_TAXONOMY);
    expect(learning.userTopics).not.toContainEqual(ACCOUNT_A_TOPIC);
    expect((await getAllTimeStats()).totalPoints).toBe(0);
  });

  it('does not retain or upload account A state when silent renewal returns account B', async () => {
    await seedAccountAState();
    await setBackendSession({
      sessionToken: 'expired-session-token-a',
      userId: 'account-a',
      expiresAt: '2020-01-01T00:00:00.000Z',
      connectedAt: '2020-01-01T00:00:00.000Z',
    });
    const { uploadedSnapshots } = installAccountBBackend();

    await syncAccountSnapshot();

    const learning = await getLearningState();
    expect(learning.userTopics).toEqual([ACCOUNT_B_TOPIC]);
    expect(learning.userTopics).not.toContainEqual(ACCOUNT_A_TOPIC);
    expect((await getAllTimeStats()).totalPoints).toBe(0);
    expect(uploadedSnapshots).toHaveLength(1);
    expect(uploadedSnapshots[0]).toMatchObject({
      authorization: 'Bearer session-token-b',
      body: {
        data: {
          allTimeStats: {
            totalPoints: 0,
            tasksCompleted: 0,
          },
        },
      },
    });
    expect(JSON.stringify(uploadedSnapshots[0].body)).not.toContain('Account A progress');
  });
});
