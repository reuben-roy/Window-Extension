import { describe, expect, it } from 'vitest';
import { filterExcludedQuestionId, pickRandom } from '../backend/src/lib/learning';
import { shouldPreserveActiveQuizPrompt } from '../src/shared/learning';

describe('learning review helpers', () => {
  it('pickRandom returns null for an empty list', () => {
    expect(pickRandom([])).toBeNull();
  });

  it('filterExcludedQuestionId removes the excluded question', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(filterExcludedQuestionId(items, 'b')).toEqual([{ id: 'a' }, { id: 'c' }]);
  });

  it('filterExcludedQuestionId leaves the list unchanged when no exclusion is set', () => {
    const items = [{ id: 'a' }];
    expect(filterExcludedQuestionId(items)).toEqual(items);
  });

  it('preserves an active quiz prompt only when its topic is still active', () => {
    expect(
      shouldPreserveActiveQuizPrompt({
        activeQuizVisible: true,
        activeQuizPrompt: { topicId: 'topic-a' } as never,
        userTopics: [{ topicId: 'topic-a', active: true }] as never,
      }),
    ).toBe(true);

    expect(
      shouldPreserveActiveQuizPrompt({
        activeQuizVisible: true,
        activeQuizPrompt: { topicId: 'topic-stale' } as never,
        userTopics: [{ topicId: 'topic-a', active: true }] as never,
      }),
    ).toBe(false);
  });
});
