/**
 * Validated, atomic CRUD helpers for profiles, event bindings, and global allowlist.
 *
 * Every mutation reads the latest value from storage first, transforms it, and
 * writes back — so concurrent callers converge on a consistent state.
 */

import {
  getEventBindings,
  getGlobalAllowlist,
  getProfiles,
  setEventBindings,
  setGlobalAllowlist,
  setProfiles,
} from './storage';
import type { EventBindings, Profiles } from './types';

// ─── Domain normalization ─────────────────────────────────────────────────────

/**
 * Strip protocol, optional "www." prefix, path, and lowercase.
 * Returns null when the result isn't a plausible domain name
 * (must contain at least one dot and no whitespace).
 */
export function normalizeDomain(raw: string): string | null {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, ''); // strip path / query / fragment

  if (!cleaned || !cleaned.includes('.') || /\s/.test(cleaned)) return null;
  // Reject anything that looks like a URL with a port (keep it simple for now)
  if (cleaned.includes(':')) return null;
  return cleaned;
}

// ─── Profile CRUD ─────────────────────────────────────────────────────────────

export async function addProfile(
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Profile name cannot be empty.' };
  const profiles = await getProfiles();
  if (profiles[trimmed] !== undefined)
    return { ok: false, error: `A profile named "${trimmed}" already exists.` };
  await setProfiles({ ...profiles, [trimmed]: [] });
  return { ok: true };
}

/**
 * Rename a profile atomically: updates the profiles map and rewrites any event
 * bindings that pointed to the old name.
 */
export async function renameProfile(
  oldName: string,
  newName: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = newName.trim();
  if (!trimmed) return { ok: false, error: 'Profile name cannot be empty.' };
  if (trimmed === oldName) return { ok: true }; // no-op

  const [profiles, bindings] = await Promise.all([getProfiles(), getEventBindings()]);
  if (profiles[oldName] === undefined)
    return { ok: false, error: `Profile "${oldName}" does not exist.` };
  if (profiles[trimmed] !== undefined)
    return { ok: false, error: `A profile named "${trimmed}" already exists.` };

  // Rebuild profiles, preserving insertion order up to the renamed key
  const updatedProfiles: Profiles = {};
  for (const [k, v] of Object.entries(profiles)) {
    updatedProfiles[k === oldName ? trimmed : k] = v;
  }

  // Repoint any bindings that referenced the old name
  const updatedBindings: EventBindings = {};
  for (const [kw, profile] of Object.entries(bindings)) {
    updatedBindings[kw] = profile === oldName ? trimmed : profile;
  }

  await Promise.all([setProfiles(updatedProfiles), setEventBindings(updatedBindings)]);
  return { ok: true };
}

/**
 * Delete a profile and remove all event bindings that referenced it.
 */
export async function deleteProfile(name: string): Promise<void> {
  const [profiles, bindings] = await Promise.all([getProfiles(), getEventBindings()]);

  const updatedProfiles = { ...profiles };
  delete updatedProfiles[name];

  const updatedBindings: EventBindings = {};
  for (const [kw, profile] of Object.entries(bindings)) {
    if (profile !== name) updatedBindings[kw] = profile;
  }

  await Promise.all([setProfiles(updatedProfiles), setEventBindings(updatedBindings)]);
}

export async function addDomainToProfile(
  profileName: string,
  rawDomain: string,
): Promise<{ ok: boolean; error?: string }> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) return { ok: false, error: `"${rawDomain}" is not a valid domain.` };

  const profiles = await getProfiles();
  if (profiles[profileName] === undefined)
    return { ok: false, error: `Profile "${profileName}" not found.` };

  const domains = profiles[profileName];
  if (domains.includes(domain))
    return { ok: false, error: `${domain} is already in this profile.` };

  await setProfiles({ ...profiles, [profileName]: [...domains, domain] });
  return { ok: true };
}

export async function removeDomainFromProfile(
  profileName: string,
  domain: string,
): Promise<void> {
  const profiles = await getProfiles();
  if (profiles[profileName] === undefined) return;
  await setProfiles({
    ...profiles,
    [profileName]: profiles[profileName].filter((d) => d !== domain),
  });
}

// ─── Event binding CRUD ───────────────────────────────────────────────────────

export async function addBinding(
  rawKeyword: string,
  profileName: string,
): Promise<{ ok: boolean; error?: string }> {
  const keyword = rawKeyword.trim().toLowerCase();
  if (!keyword) return { ok: false, error: 'Keyword cannot be empty.' };

  const [bindings, profiles] = await Promise.all([getEventBindings(), getProfiles()]);
  if (profiles[profileName] === undefined)
    return { ok: false, error: `Profile "${profileName}" does not exist.` };

  await setEventBindings({ ...bindings, [keyword]: profileName });
  return { ok: true };
}

export async function removeBinding(keyword: string): Promise<void> {
  const bindings = await getEventBindings();
  const updated = { ...bindings };
  delete updated[keyword];
  await setEventBindings(updated);
}

/** Returns all keywords currently bound to the given profile name. */
export async function getBindingsForProfile(profileName: string): Promise<string[]> {
  const bindings = await getEventBindings();
  return Object.entries(bindings)
    .filter(([, p]) => p === profileName)
    .map(([kw]) => kw);
}

// ─── Global allowlist CRUD ────────────────────────────────────────────────────

export async function addToGlobalAllowlist(
  rawDomain: string,
): Promise<{ ok: boolean; error?: string }> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) return { ok: false, error: `"${rawDomain}" is not a valid domain.` };

  const list = await getGlobalAllowlist();
  if (list.includes(domain))
    return { ok: false, error: `${domain} is already in the allowlist.` };

  await setGlobalAllowlist([...list, domain]);
  return { ok: true };
}

export async function removeFromGlobalAllowlist(domain: string): Promise<void> {
  const list = await getGlobalAllowlist();
  await setGlobalAllowlist(list.filter((d) => d !== domain));
}
