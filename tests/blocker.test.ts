import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllRules, computeAllowedDomains, updateBlockingRules } from '../src/background/blocker';
import { ALLOW_RULE_ID_START, BLOCK_ALL_RULE_ID } from '../src/shared/constants';
import type { Profiles } from '../src/shared/types';

// ─── updateBlockingRules ──────────────────────────────────────────────────────

describe('updateBlockingRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (chrome.declarativeNetRequest.getDynamicRules as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (chrome.declarativeNetRequest.updateDynamicRules as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('clears all rules when blocking is disabled', async () => {
    await updateBlockingRules(['github.com', 'stackoverflow.com'], false);

    expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith({
      removeRuleIds: [],
      addRules: [],
    });
  });

  it('adds block-all rule + allow rules when blocking is enabled', async () => {
    await updateBlockingRules(['github.com', 'stackoverflow.com'], true);

    const call = (chrome.declarativeNetRequest.updateDynamicRules as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const { addRules } = call as { addRules: chrome.declarativeNetRequest.Rule[] };

    expect(addRules).toHaveLength(3); // 1 block-all + 2 allow rules

    const blockRule = addRules.find((r) => r.id === BLOCK_ALL_RULE_ID);
    expect(blockRule).toBeDefined();
    expect(blockRule?.priority).toBe(1);

    const allowRules = addRules.filter((r) => r.id >= ALLOW_RULE_ID_START);
    expect(allowRules).toHaveLength(2);
    allowRules.forEach((r) => expect(r.priority).toBe(2));
  });

  it('block-all rule redirects using a regex that captures the blocked hostname', async () => {
    await updateBlockingRules(['github.com'], true);

    const call = (chrome.declarativeNetRequest.updateDynamicRules as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const { addRules } = call as { addRules: chrome.declarativeNetRequest.Rule[] };

    const blockRule = addRules.find((r) => r.id === BLOCK_ALL_RULE_ID)!;
    expect(blockRule.condition.regexFilter).toBe('^https?://([^/:?#]+).*$');
    expect(blockRule.action.redirect?.regexSubstitution).toContain('?blocked=');
  });

  it('allow rules use || anchor pattern for subdomain matching', async () => {
    await updateBlockingRules(['github.com'], true);

    const call = (chrome.declarativeNetRequest.updateDynamicRules as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const { addRules } = call as { addRules: chrome.declarativeNetRequest.Rule[] };

    const allowRule = addRules.find((r) => r.id === ALLOW_RULE_ID_START)!;
    expect(allowRule.condition.urlFilter).toBe('||github.com');
  });

  it('allow rules have higher priority than the block-all rule', async () => {
    await updateBlockingRules(['github.com'], true);

    const call = (chrome.declarativeNetRequest.updateDynamicRules as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const { addRules } = call as { addRules: chrome.declarativeNetRequest.Rule[] };

    const blockRule = addRules.find((r) => r.id === BLOCK_ALL_RULE_ID)!;
    const allowRule = addRules.find((r) => r.id === ALLOW_RULE_ID_START)!;
    expect(allowRule.priority).toBeGreaterThan(blockRule.priority);
  });

  it('clears rules when blocking is enabled but no domains resolved', async () => {
    await updateBlockingRules([], true);

    expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith({
      removeRuleIds: [],
      addRules: [],
    });
  });

  it('removes existing rules before adding new ones', async () => {
    (chrome.declarativeNetRequest.getDynamicRules as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1 }, { id: 2 },
    ]);

    await updateBlockingRules(['github.com'], true);

    const call = (chrome.declarativeNetRequest.updateDynamicRules as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.removeRuleIds).toEqual([1, 2]);
  });
});

// ─── clearAllRules ────────────────────────────────────────────────────────────

describe('clearAllRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (chrome.declarativeNetRequest.getDynamicRules as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1 }, { id: 2 }, { id: 3 },
    ]);
    (chrome.declarativeNetRequest.updateDynamicRules as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('removes all existing rules and adds none', async () => {
    await clearAllRules();
    expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith({
      removeRuleIds: [1, 2, 3],
      addRules: [],
    });
  });
});

// ─── computeAllowedDomains ────────────────────────────────────────────────────

describe('computeAllowedDomains', () => {
  const PROFILES: Profiles = {
    'Deep Work': ['github.com', 'stackoverflow.com', 'docs.google.com'],
    'Email & Admin': ['mail.google.com', 'slack.com', 'notion.so'],
    'Study': ['github.com', 'arxiv.org', 'scholar.google.com'],
  };
  const GLOBAL = ['accounts.google.com'];

  it('returns only global allowlist when no profiles are active', () => {
    const result = computeAllowedDomains([], PROFILES, GLOBAL);
    expect(result).toEqual(GLOBAL);
  });

  it('returns profile domains + global for a single profile (union)', () => {
    const result = computeAllowedDomains(['Deep Work'], PROFILES, GLOBAL, 'union');
    expect(result).toContain('github.com');
    expect(result).toContain('stackoverflow.com');
    expect(result).toContain('docs.google.com');
    expect(result).toContain('accounts.google.com');
  });

  it('combines all domains across profiles in union mode', () => {
    const result = computeAllowedDomains(['Deep Work', 'Email & Admin'], PROFILES, GLOBAL, 'union');
    expect(result).toContain('github.com');       // Deep Work
    expect(result).toContain('stackoverflow.com'); // Deep Work
    expect(result).toContain('mail.google.com');   // Email & Admin
    expect(result).toContain('slack.com');          // Email & Admin
    expect(result).toContain('accounts.google.com'); // global
  });

  it('intersects domains across profiles in intersection mode', () => {
    // Deep Work: [github.com, stackoverflow.com, docs.google.com]
    // Study:     [github.com, arxiv.org, scholar.google.com]
    // Intersection: [github.com]
    const result = computeAllowedDomains(['Deep Work', 'Study'], PROFILES, GLOBAL, 'intersection');
    expect(result).toContain('github.com');
    expect(result).not.toContain('stackoverflow.com'); // only in Deep Work
    expect(result).not.toContain('arxiv.org');          // only in Study
    expect(result).toContain('accounts.google.com');    // global always included
  });

  it('intersection with no common domains returns only global allowlist', () => {
    const result = computeAllowedDomains(
      ['Deep Work', 'Email & Admin'],
      PROFILES,
      GLOBAL,
      'intersection',
    );
    // Deep Work and Email & Admin share no domains
    expect(result).toEqual(GLOBAL);
  });

  it('deduplicates domains', () => {
    // github.com appears in both Deep Work and Study
    const result = computeAllowedDomains(['Deep Work', 'Study'], PROFILES, GLOBAL, 'union');
    const githubCount = result.filter((d) => d === 'github.com').length;
    expect(githubCount).toBe(1);
  });

  it('deduplicates between profile domains and global allowlist', () => {
    const globalWithOverlap = ['accounts.google.com', 'github.com'];
    const result = computeAllowedDomains(['Deep Work'], PROFILES, globalWithOverlap, 'union');
    const githubCount = result.filter((d) => d === 'github.com').length;
    expect(githubCount).toBe(1);
  });

  it('handles unknown profile name gracefully (treats as empty list)', () => {
    const result = computeAllowedDomains(['NonExistentProfile'], PROFILES, GLOBAL, 'union');
    expect(result).toEqual(GLOBAL);
  });

  it('single profile behaves the same in union and intersection', () => {
    const union = computeAllowedDomains(['Deep Work'], PROFILES, GLOBAL, 'union');
    const intersect = computeAllowedDomains(['Deep Work'], PROFILES, GLOBAL, 'intersection');
    expect(union).toEqual(intersect);
  });
});
