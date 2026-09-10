import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUIZ_FAB_SESSION_KEY } from '../src/shared/constants';
import type { QuizFabSession } from '../src/shared/types';

const openSession: QuizFabSession = {
  visible: true,
  panelVisible: true,
  topicLabel: 'Distributed Systems',
  questionId: 'question-1',
  intensity: 'balanced',
  lastSurfacedAt: new Date().toISOString(),
  panelClosedAt: null,
};

describe('in-page quiz panel lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    document.documentElement.innerHTML = '<head></head><body></body>';
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    vi.mocked(chrome.storage.onChanged.addListener).mockClear();
    vi.mocked(chrome.runtime.onMessage.addListener).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not let a pending close remove a panel that was immediately reopened', async () => {
    await import('../src/content/quizPanel');
    const storageListener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls.at(-1)?.[0];
    expect(storageListener).toBeTypeOf('function');

    storageListener?.(
      { [QUIZ_FAB_SESSION_KEY]: { newValue: openSession } },
      'local',
    );
    expect(document.getElementById('window-quiz-panel-host')).not.toBeNull();

    storageListener?.(
      {
        [QUIZ_FAB_SESSION_KEY]: {
          newValue: { ...openSession, panelVisible: false },
        },
      },
      'local',
    );
    storageListener?.(
      { [QUIZ_FAB_SESSION_KEY]: { newValue: openSession } },
      'local',
    );

    vi.advanceTimersByTime(300);

    expect(document.getElementById('window-quiz-panel-host')).not.toBeNull();
  });
});
