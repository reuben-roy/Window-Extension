import { describe, expect, it } from 'vitest';
import { isRedundantExactRuleCopy } from '../src/shared/ruleResolution';
import type { EventRule, KeywordRule } from '../src/shared/types';

function makeEventRule(overrides: Partial<EventRule> = {}): EventRule {
  return {
    eventTitle: 'Calling Friends',
    domains: ['github.com', 'leetcode.com'],
    tagKey: null,
    difficultyOverride: null,
    ...overrides,
  };
}

function makeKeywordRule(overrides: Partial<KeywordRule> = {}): KeywordRule {
  return {
    keyword: 'calling',
    domains: ['leetcode.com', 'github.com'],
    createdAt: '2026-01-01T00:00:00.000Z',
    tagKey: 'communication',
    ...overrides,
  };
}

describe('isRedundantExactRuleCopy', () => {
  it('matches copied fallback domains even if the order differs', () => {
    expect(isRedundantExactRuleCopy(makeEventRule(), makeKeywordRule())).toBe(true);
  });

  it('does not treat exact rules with their own metadata as redundant copies', () => {
    expect(
      isRedundantExactRuleCopy(
        makeEventRule({ tagKey: 'communication' }),
        makeKeywordRule(),
      ),
    ).toBe(false);
    expect(
      isRedundantExactRuleCopy(
        makeEventRule({ difficultyOverride: 3 }),
        makeKeywordRule(),
      ),
    ).toBe(false);
  });
});
