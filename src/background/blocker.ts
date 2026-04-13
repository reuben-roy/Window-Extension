import {
  ALLOW_RULE_ID_START,
  BLOCK_ALL_RULE_ID,
  BLOCKED_PAGE_EXTENSION_PATH,
  TEMP_UNLOCK_RULE_ID_START,
} from '../shared/constants';
import type { CarryoverMode, Profiles, TemporaryUnlockState } from '../shared/types';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Atomically replaces all dynamic declarativeNetRequest rules.
 *
 * Blocking strategy (SPEC.md):
 *   Priority 1 — one catch-all REDIRECT rule → custom blocked page
 *   Priority 2 — one ALLOW rule per whitelisted domain (higher priority wins)
 *
 * When `blockingEnabled` is false, all rules are cleared so nothing is blocked.
 * When `allowedDomains` is empty but `blockingEnabled` is true we still install
 * the block-all rule (the user has a profile with no domains).
 */
export async function updateBlockingRules(
  allowedDomains: string[],
  blockingEnabled: boolean,
): Promise<void> {
  const removeRuleIds = await getExistingRuleIds();

  if (!blockingEnabled) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: [] });
    return;
  }

  const addRules: chrome.declarativeNetRequest.Rule[] = [
    buildBlockAllRule(),
    ...allowedDomains.map((domain, i) => buildAllowRule(domain, ALLOW_RULE_ID_START + i)),
  ];

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

/**
 * Removes every dynamic rule without adding replacements.
 * Called when a snooze activates so all sites become reachable.
 */
export async function clearAllRules(): Promise<void> {
  const removeRuleIds = await getExistingRuleIds();
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: [] });
}

export async function syncTemporaryUnlockRules(
  unlocks: Record<string, TemporaryUnlockState>,
): Promise<void> {
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const removeRuleIds = existing
    .map((rule) => rule.id)
    .filter((id) => id >= TEMP_UNLOCK_RULE_ID_START);
  const addRules = Object.values(unlocks).map(buildTemporaryUnlockRule);
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
}

/**
 * Computes the effective set of allowed domains for one or more active profiles.
 *
 * Union mode (default / carryoverMode = "union"):
 *   Allowed = all domains across all profiles combined. More forgiving.
 *
 * Intersection mode (carryoverMode = "intersection"):
 *   Allowed = only domains present in EVERY active profile. Most restrictive.
 *
 * The global allowlist (e.g. accounts.google.com) is always appended last,
 * regardless of mode, so auth flows are never broken.
 *
 * Used by:
 *   • calendar.ts::resolveActiveState   (single event → single profile)
 *   • taskQueue.ts (Phase 2)            (multiple carryover profiles → union/intersection)
 */
export function computeAllowedDomains(
  activeProfiles: string[],
  profiles: Profiles,
  globalAllowlist: string[],
  mode: CarryoverMode = 'union',
): string[] {
  if (activeProfiles.length === 0) {
    return [...globalAllowlist];
  }

  const domainLists = activeProfiles.map((name) => profiles[name] ?? []);

  const profileDomains: string[] =
    mode === 'union'
      ? domainLists.flat()
      : domainLists.length === 1
        ? domainLists[0]
        : domainLists.reduce((acc, list) => acc.filter((d) => list.includes(d)));

  // Deduplicate then merge global allowlist
  return [...new Set([...profileDomains, ...globalAllowlist])];
}

// ─── Rule builders ────────────────────────────────────────────────────────────

/**
 * The catch-all block rule. Priority 1 (lowest).
 *
 * No urlFilter / regexFilter is intentional: omitting both means "match all URLs"
 * per the declarativeNetRequest spec. Using urlFilter:"*" is incorrect — Chrome
 * DNR treats it as a literal asterisk, not a wildcard.
 */
function buildBlockAllRule(): chrome.declarativeNetRequest.Rule {
  const blockedPageUrl = chrome.runtime.getURL(BLOCKED_PAGE_EXTENSION_PATH);
  return {
    id: BLOCK_ALL_RULE_ID,
    priority: 1,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
      redirect: {
        regexSubstitution: `${blockedPageUrl}?blocked=\\1`,
      },
    },
    condition: {
      regexFilter: '^https?://([^/:?#]+).*$',
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
    },
  };
}

/**
 * A per-domain allow rule. Priority 2 (beats block-all).
 * Matches the exact domain and all its subdomains via the `||` anchor syntax.
 * e.g. "||github.com" matches github.com, www.github.com, api.github.com, etc.
 */
function buildAllowRule(domain: string, id: number): chrome.declarativeNetRequest.Rule {
  return {
    id,
    priority: 2,
    action: { type: chrome.declarativeNetRequest.RuleActionType.ALLOW },
    condition: {
      urlFilter: `||${domain}`,
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
    },
  };
}

function buildTemporaryUnlockRule(unlock: TemporaryUnlockState): chrome.declarativeNetRequest.Rule {
  return {
    id: unlock.ruleId,
    priority: 3,
    action: { type: chrome.declarativeNetRequest.RuleActionType.ALLOW },
    condition: {
      urlFilter: `||${unlock.blockedHost}`,
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getExistingRuleIds(): Promise<number[]> {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  return rules.map((r) => r.id);
}

export function isDomainAllowed(host: string, allowedDomains: string[]): boolean {
  const lowerHost = host.toLowerCase();
  return allowedDomains.some((domain) => {
    const lowerDomain = domain.toLowerCase();
    return lowerHost === lowerDomain || lowerHost.endsWith(`.${lowerDomain}`);
  });
}
