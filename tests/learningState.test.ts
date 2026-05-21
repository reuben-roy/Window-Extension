import { describe, expect, it } from 'vitest';
import {
  isRepeatedExcludedQuizPrompt,
  shouldLockVisibleQuizDuringRefresh,
  shouldPreserveActiveQuizPrompt,
  shouldPreserveActiveQuizResult,
} from '../src/shared/learning';

describe('shouldPreserveActiveQuizPrompt', () => {
  it('preserves the current prompt when the takeover is visible and the topic is still active', () => {
    expect(
      shouldPreserveActiveQuizPrompt(
        {
          activeQuizVisible: true,
          activeQuizPrompt: {
            topicKey: 'probability',
          },
          userTopics: [
            {
              id: 'user-topic-1',
              topicKey: 'probability',
              active: true,
            },
          ],
        },
      ),
    ).toBe(true);
  });

  it('does not preserve prompts from inactive topics', () => {
    expect(
      shouldPreserveActiveQuizPrompt(
        {
          activeQuizVisible: true,
          activeQuizPrompt: {
            topicKey: 'probability',
          },
          userTopics: [
            {
              id: 'user-topic-2',
              topicKey: 'linear-algebra',
              active: true,
            },
          ],
        },
      ),
    ).toBe(false);
  });

  it('does not preserve prompts when the takeover is hidden', () => {
    expect(
      shouldPreserveActiveQuizPrompt(
        {
          activeQuizVisible: false,
          activeQuizPrompt: {
            topicKey: 'probability',
          },
          userTopics: [
            {
              id: 'user-topic-1',
              topicKey: 'probability',
              active: true,
            },
          ],
        },
      ),
    ).toBe(false);
  });
});

describe('shouldLockVisibleQuizDuringRefresh', () => {
  it('locks the visible unanswered quiz during background refresh', () => {
    expect(
      shouldLockVisibleQuizDuringRefresh({
        activeQuizVisible: true,
        activeQuizPrompt: { questionId: 'question-1' },
        activeQuizResult: null,
      }),
    ).toBe(true);
  });

  it('does not lock once the answer result is showing', () => {
    expect(
      shouldLockVisibleQuizDuringRefresh({
        activeQuizVisible: true,
        activeQuizPrompt: { questionId: 'question-1' },
        activeQuizResult: {
          prompt: { questionId: 'question-1' },
        },
      }),
    ).toBe(false);
  });
});

describe('shouldPreserveActiveQuizResult', () => {
  it('preserves the active result when it still belongs to the visible prompt', () => {
    expect(
      shouldPreserveActiveQuizResult({
        activeQuizPrompt: {
          questionId: 'question-1',
        },
        activeQuizResult: {
          prompt: {
            questionId: 'question-1',
          },
        },
      }),
    ).toBe(true);
  });

  it('drops stale results from older prompts', () => {
    expect(
      shouldPreserveActiveQuizResult({
        activeQuizPrompt: {
          questionId: 'question-2',
        },
        activeQuizResult: {
          prompt: {
            questionId: 'question-1',
          },
        },
      }),
    ).toBe(false);
  });
});

describe('isRepeatedExcludedQuizPrompt', () => {
  it('detects when the backend repeats the excluded prompt', () => {
    expect(
      isRepeatedExcludedQuizPrompt(
        { questionId: 'question-1' },
        'question-1',
      ),
    ).toBe(true);
  });

  it('returns false when the next prompt differs', () => {
    expect(
      isRepeatedExcludedQuizPrompt(
        { questionId: 'question-2' },
        'question-1',
      ),
    ).toBe(false);
  });
});
