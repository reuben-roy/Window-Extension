import type { EventRule, KeywordRule } from './types';

export function isRedundantExactRuleCopy(
  exactRule: EventRule,
  keywordRule: KeywordRule,
): boolean {
  if (exactRule.tagKey !== null || exactRule.difficultyOverride !== null) {
    return false;
  }

  if (exactRule.domains.length !== keywordRule.domains.length) {
    return false;
  }

  const keywordDomains = new Set(keywordRule.domains);
  return exactRule.domains.every((domain) => keywordDomains.has(domain));
}
