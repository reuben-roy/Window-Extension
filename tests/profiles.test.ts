import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addBinding,
  addDomainToProfile,
  addProfile,
  addToGlobalAllowlist,
  deleteProfile,
  getBindingsForProfile,
  normalizeDomain,
  removeBinding,
  removeDomainFromProfile,
  removeFromGlobalAllowlist,
  renameProfile,
} from '../src/shared/profiles';

// ─── Storage mock helpers ─────────────────────────────────────────────────────

type StoreBucket = Record<string, unknown>;
let store: StoreBucket = {};

function mockStorage() {
  (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockImplementation(
    (key: string | string[] | null, cb: (r: Record<string, unknown>) => void) => {
      if (key === null) return cb({ ...store });
      const k = key as string;
      cb(store[k] !== undefined ? { [k]: store[k] } : {});
    },
  );
  (chrome.storage.sync.set as ReturnType<typeof vi.fn>).mockImplementation(
    (items: Record<string, unknown>, cb?: () => void) => {
      Object.assign(store, items);
      cb?.();
    },
  );
}

beforeEach(() => {
  store = {};
  vi.clearAllMocks();
  mockStorage();
});

// ─── normalizeDomain ──────────────────────────────────────────────────────────

describe('normalizeDomain', () => {
  it('strips https:// protocol', () => {
    expect(normalizeDomain('https://github.com')).toBe('github.com');
  });

  it('strips http:// protocol', () => {
    expect(normalizeDomain('http://github.com')).toBe('github.com');
  });

  it('strips www. prefix', () => {
    expect(normalizeDomain('www.github.com')).toBe('github.com');
  });

  it('strips both protocol and www', () => {
    expect(normalizeDomain('https://www.github.com')).toBe('github.com');
  });

  it('strips path', () => {
    expect(normalizeDomain('github.com/orgs/foo')).toBe('github.com');
  });

  it('lowercases the domain', () => {
    expect(normalizeDomain('GitHub.COM')).toBe('github.com');
  });

  it('returns null for strings with no dot', () => {
    expect(normalizeDomain('localhost')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalizeDomain('')).toBeNull();
  });

  it('returns null for strings with whitespace', () => {
    expect(normalizeDomain('github .com')).toBeNull();
  });

  it('accepts valid subdomain', () => {
    expect(normalizeDomain('docs.google.com')).toBe('docs.google.com');
  });
});

// ─── addProfile ───────────────────────────────────────────────────────────────

describe('addProfile', () => {
  it('creates a new profile with empty domain list', async () => {
    const result = await addProfile('Deep Work');
    expect(result.ok).toBe(true);
    expect(store['profiles']).toEqual({ 'Deep Work': [] });
  });

  it('rejects empty name', async () => {
    const result = await addProfile('   ');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it('rejects duplicate name', async () => {
    await addProfile('Deep Work');
    const result = await addProfile('Deep Work');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already exists/i);
  });

  it('trims whitespace from name', async () => {
    const result = await addProfile('  Email & Admin  ');
    expect(result.ok).toBe(true);
    expect(store['profiles']).toHaveProperty('Email & Admin');
  });
});

// ─── renameProfile ────────────────────────────────────────────────────────────

describe('renameProfile', () => {
  beforeEach(async () => {
    // Seed profiles and bindings
    store['profiles'] = { 'Deep Work': ['github.com'], Study: ['arxiv.org'] };
    store['eventBindings'] = { 'deep focus': 'Deep Work', 'study session': 'Study' };
  });

  it('renames profile and updates bindings', async () => {
    const result = await renameProfile('Deep Work', 'Focus Mode');
    expect(result.ok).toBe(true);
    const profiles = store['profiles'] as Record<string, unknown>;
    expect(profiles['Focus Mode']).toEqual(['github.com']);
    expect(profiles['Deep Work']).toBeUndefined();
    const bindings = store['eventBindings'] as Record<string, string>;
    expect(bindings['deep focus']).toBe('Focus Mode');
    // Bindings for other profiles unchanged
    expect(bindings['study session']).toBe('Study');
  });

  it('is a no-op when new name equals old name', async () => {
    const result = await renameProfile('Deep Work', 'Deep Work');
    expect(result.ok).toBe(true);
    // Nothing written
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  it('rejects rename to existing profile name', async () => {
    const result = await renameProfile('Deep Work', 'Study');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already exists/i);
  });

  it('rejects rename of non-existent profile', async () => {
    const result = await renameProfile('Ghost', 'New Name');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does not exist/i);
  });

  it('rejects empty new name', async () => {
    const result = await renameProfile('Deep Work', '');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });
});

// ─── deleteProfile ────────────────────────────────────────────────────────────

describe('deleteProfile', () => {
  beforeEach(() => {
    store['profiles'] = { 'Deep Work': ['github.com'], Study: ['arxiv.org'] };
    store['eventBindings'] = { 'deep focus': 'Deep Work', 'study session': 'Study' };
  });

  it('removes the profile', async () => {
    await deleteProfile('Deep Work');
    const profiles = store['profiles'] as Record<string, unknown>;
    expect(profiles['Deep Work']).toBeUndefined();
    expect(profiles['Study']).toEqual(['arxiv.org']);
  });

  it('removes bindings that pointed to the deleted profile', async () => {
    await deleteProfile('Deep Work');
    const bindings = store['eventBindings'] as Record<string, string>;
    expect(bindings['deep focus']).toBeUndefined();
    expect(bindings['study session']).toBe('Study');
  });
});

// ─── addDomainToProfile ───────────────────────────────────────────────────────

describe('addDomainToProfile', () => {
  beforeEach(() => {
    store['profiles'] = { 'Deep Work': ['github.com'] };
  });

  it('normalizes and adds a valid domain', async () => {
    const result = await addDomainToProfile('Deep Work', 'https://stackoverflow.com');
    expect(result.ok).toBe(true);
    const profiles = store['profiles'] as Record<string, string[]>;
    expect(profiles['Deep Work']).toContain('stackoverflow.com');
  });

  it('rejects an invalid domain', async () => {
    const result = await addDomainToProfile('Deep Work', 'not-a-domain');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/valid domain/i);
  });

  it('rejects a duplicate domain', async () => {
    const result = await addDomainToProfile('Deep Work', 'github.com');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already in/i);
  });

  it('rejects unknown profile', async () => {
    const result = await addDomainToProfile('Ghost', 'github.com');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });
});

// ─── removeDomainFromProfile ──────────────────────────────────────────────────

describe('removeDomainFromProfile', () => {
  it('removes the specified domain', async () => {
    store['profiles'] = { 'Deep Work': ['github.com', 'stackoverflow.com'] };
    await removeDomainFromProfile('Deep Work', 'github.com');
    const profiles = store['profiles'] as Record<string, string[]>;
    expect(profiles['Deep Work']).toEqual(['stackoverflow.com']);
  });

  it('is a no-op for unknown profile', async () => {
    store['profiles'] = {};
    await removeDomainFromProfile('Ghost', 'github.com');
    // Should not throw
  });
});

// ─── addBinding ───────────────────────────────────────────────────────────────

describe('addBinding', () => {
  beforeEach(() => {
    store['profiles'] = { 'Deep Work': [] };
    store['eventBindings'] = {};
  });

  it('adds a keyword → profile mapping', async () => {
    const result = await addBinding('deep focus', 'Deep Work');
    expect(result.ok).toBe(true);
    const bindings = store['eventBindings'] as Record<string, string>;
    expect(bindings['deep focus']).toBe('Deep Work');
  });

  it('normalizes keyword to lowercase', async () => {
    const result = await addBinding('DEEP FOCUS', 'Deep Work');
    expect(result.ok).toBe(true);
    const bindings = store['eventBindings'] as Record<string, string>;
    expect(bindings['deep focus']).toBe('Deep Work');
  });

  it('rejects empty keyword', async () => {
    const result = await addBinding('', 'Deep Work');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it('rejects binding to non-existent profile', async () => {
    const result = await addBinding('deep focus', 'Ghost Profile');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does not exist/i);
  });
});

// ─── removeBinding ────────────────────────────────────────────────────────────

describe('removeBinding', () => {
  it('removes the specified binding', async () => {
    store['eventBindings'] = { 'deep focus': 'Deep Work', 'study session': 'Study' };
    await removeBinding('deep focus');
    const bindings = store['eventBindings'] as Record<string, string>;
    expect(bindings['deep focus']).toBeUndefined();
    expect(bindings['study session']).toBe('Study');
  });
});

// ─── getBindingsForProfile ────────────────────────────────────────────────────

describe('getBindingsForProfile', () => {
  it('returns all keywords bound to a profile', async () => {
    store['eventBindings'] = {
      'deep focus': 'Deep Work',
      'deep dive': 'Deep Work',
      'study session': 'Study',
    };
    const keywords = await getBindingsForProfile('Deep Work');
    expect(keywords).toHaveLength(2);
    expect(keywords).toContain('deep focus');
    expect(keywords).toContain('deep dive');
  });

  it('returns empty array when no bindings match', async () => {
    store['eventBindings'] = { 'study session': 'Study' };
    const keywords = await getBindingsForProfile('Deep Work');
    expect(keywords).toEqual([]);
  });
});

// ─── addToGlobalAllowlist ─────────────────────────────────────────────────────

describe('addToGlobalAllowlist', () => {
  it('adds and normalizes a domain', async () => {
    store['globalAllowlist'] = ['accounts.google.com'];
    const result = await addToGlobalAllowlist('https://www.example.com');
    expect(result.ok).toBe(true);
    expect(store['globalAllowlist']).toContain('example.com');
  });

  it('rejects a duplicate domain', async () => {
    store['globalAllowlist'] = ['accounts.google.com'];
    const result = await addToGlobalAllowlist('accounts.google.com');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already in/i);
  });

  it('rejects an invalid domain', async () => {
    store['globalAllowlist'] = [];
    const result = await addToGlobalAllowlist('not-valid');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/valid domain/i);
  });
});

// ─── removeFromGlobalAllowlist ────────────────────────────────────────────────

describe('removeFromGlobalAllowlist', () => {
  it('removes the specified domain', async () => {
    store['globalAllowlist'] = ['accounts.google.com', 'example.com'];
    await removeFromGlobalAllowlist('accounts.google.com');
    expect(store['globalAllowlist']).toEqual(['example.com']);
  });
});
