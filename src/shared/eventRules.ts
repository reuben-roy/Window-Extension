import type { EventRule, KeywordRule } from './types';
import { getEventRules, getKeywordRules, setEventRules, setKeywordRules } from './storage';
import { normalizeDomain } from './profiles';

function dedupeDomains(domains: string[]): string[] {
  return [...new Set(domains)];
}

export async function upsertEventRule(
  eventTitle: string,
  rawDomains: string[],
): Promise<{ ok: boolean; error?: string }> {
  const title = eventTitle.trim();
  if (!title) return { ok: false, error: 'Choose an event title first.' };

  const domains = dedupeDomains(
    rawDomains
      .map((domain) => normalizeDomain(domain))
      .filter((domain): domain is string => domain !== null),
  );
  if (rawDomains.length > 0 && domains.length === 0) {
    return { ok: false, error: 'Enter at least one valid domain.' };
  }

  const rules = await getEventRules();
  const nextRule: EventRule = { eventTitle: title, domains };
  const idx = rules.findIndex((rule) => rule.eventTitle === title);
  const updated = [...rules];

  if (idx === -1) updated.push(nextRule);
  else updated[idx] = nextRule;

  await setEventRules(updated);
  return { ok: true };
}

export async function removeEventRule(eventTitle: string): Promise<void> {
  const rules = await getEventRules();
  await setEventRules(rules.filter((rule) => rule.eventTitle !== eventTitle));
}

export async function upsertKeywordRule(
  keyword: string,
  rawDomains: string[],
): Promise<{ ok: boolean; error?: string }> {
  const trimmedKeyword = keyword.trim().toLowerCase();
  if (!trimmedKeyword) return { ok: false, error: 'Keyword cannot be empty.' };

  const domains = dedupeDomains(
    rawDomains
      .map((domain) => normalizeDomain(domain))
      .filter((domain): domain is string => domain !== null),
  );
  if (rawDomains.length > 0 && domains.length === 0) {
    return { ok: false, error: 'Enter at least one valid domain.' };
  }

  const rules = await getKeywordRules();
  const idx = rules.findIndex((rule) => rule.keyword === trimmedKeyword);
  const createdAt = idx === -1 ? new Date().toISOString() : rules[idx].createdAt;
  const nextRule: KeywordRule = { keyword: trimmedKeyword, domains, createdAt };
  const updated = [...rules];

  if (idx === -1) updated.push(nextRule);
  else updated[idx] = nextRule;

  await setKeywordRules(updated);
  return { ok: true };
}

export async function removeKeywordRule(keyword: string): Promise<void> {
  const rules = await getKeywordRules();
  await setKeywordRules(rules.filter((rule) => rule.keyword !== keyword.trim().toLowerCase()));
}
