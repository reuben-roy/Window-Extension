import React, { useEffect, useRef, useState } from 'react';
import {
  addDomainToProfile,
  addProfile,
  deleteProfile,
  getBindingsForProfile,
  removeDomainFromProfile,
  renameProfile,
} from '../../shared/profiles';
import { getProfiles } from '../../shared/storage';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfileEntry {
  name: string;
  domains: string[];
  boundKeywords: string[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProfileManager(): React.JSX.Element {
  const [entries, setEntries] = useState<ProfileEntry[]>([]);
  const [newProfileName, setNewProfileName] = useState('');
  const [addProfileError, setAddProfileError] = useState('');

  // Per-profile UI state
  const [domainInput, setDomainInput] = useState<Record<string, string>>({});
  const [domainError, setDomainError] = useState<Record<string, string>>({});
  const [renamingProfile, setRenamingProfile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // ── Load & cross-tab sync ─────────────────────────────────────────────────

  const loadEntries = async () => {
    const profiles = await getProfiles();
    const loaded = await Promise.all(
      Object.entries(profiles).map(async ([name, domains]) => ({
        name,
        domains,
        boundKeywords: await getBindingsForProfile(name),
      })),
    );
    setEntries(loaded);
  };

  useEffect(() => {
    loadEntries();

    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('profiles' in changes || 'eventBindings' in changes) {
        loadEntries();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus rename input when it mounts
  useEffect(() => {
    if (renamingProfile !== null) {
      setTimeout(() => renameInputRef.current?.focus(), 0);
    }
  }, [renamingProfile]);

  // ── Profile add ───────────────────────────────────────────────────────────

  const handleAddProfile = async () => {
    setAddProfileError('');
    const result = await addProfile(newProfileName);
    if (!result.ok) {
      setAddProfileError(result.error ?? 'Unknown error');
      return;
    }
    setNewProfileName('');
  };

  // ── Profile rename ────────────────────────────────────────────────────────

  const startRename = (name: string) => {
    setRenamingProfile(name);
    setRenameValue(name);
    setRenameError('');
  };

  const commitRename = async () => {
    if (!renamingProfile) return;
    setRenameError('');
    const result = await renameProfile(renamingProfile, renameValue);
    if (!result.ok) {
      setRenameError(result.error ?? 'Unknown error');
      return;
    }
    setRenamingProfile(null);
  };

  const cancelRename = () => {
    setRenamingProfile(null);
    setRenameError('');
  };

  // ── Profile delete ────────────────────────────────────────────────────────

  const handleDeleteProfile = async (name: string) => {
    const entry = entries.find((e) => e.name === name);
    const boundCount = entry?.boundKeywords.length ?? 0;
    const msg =
      boundCount > 0
        ? `Delete "${name}"? This will also remove ${boundCount} event binding${
            boundCount === 1 ? '' : 's'
          } that point${boundCount === 1 ? 's' : ''} to it.`
        : `Delete profile "${name}"?`;
    if (!confirm(msg)) return;
    await deleteProfile(name);
  };

  // ── Domain add ────────────────────────────────────────────────────────────

  const handleAddDomain = async (profileName: string) => {
    const raw = domainInput[profileName] ?? '';
    setDomainError((e) => ({ ...e, [profileName]: '' }));
    const result = await addDomainToProfile(profileName, raw);
    if (!result.ok) {
      setDomainError((e) => ({ ...e, [profileName]: result.error ?? 'Invalid domain' }));
      return;
    }
    setDomainInput((d) => ({ ...d, [profileName]: '' }));
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Profiles</h2>
        <p className="text-sm text-gray-500 mb-4">
          Each profile is a named allowlist of domains. Assign profiles to calendar events
          via the Event Bindings tab.
        </p>

        {/* Add profile */}
        <div className="flex gap-2 mb-1">
          <input
            type="text"
            placeholder="New profile name (e.g. Deep Work)"
            value={newProfileName}
            onChange={(e) => {
              setNewProfileName(e.target.value);
              setAddProfileError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleAddProfile()}
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleAddProfile}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
          >
            Add
          </button>
        </div>
        {addProfileError && (
          <p className="text-xs text-red-500 mt-1">{addProfileError}</p>
        )}
      </div>

      {/* Profile cards */}
      {entries.map(({ name, domains, boundKeywords }) => (
        <div key={name} className="bg-white rounded-xl border border-gray-200 p-4">
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0 mr-3">
              {renamingProfile === name ? (
                <div>
                  <div className="flex gap-2">
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => {
                        setRenameValue(e.target.value);
                        setRenameError('');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') cancelRename();
                      }}
                      className="text-sm font-semibold border border-blue-400 rounded px-2 py-0.5 w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={commitRename}
                      className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Save
                    </button>
                    <button
                      onClick={cancelRename}
                      className="text-xs px-2 py-0.5 text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                  {renameError && (
                    <p className="text-xs text-red-500 mt-1">{renameError}</p>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-semibold text-gray-800 truncate">{name}</h3>
                  <button
                    onClick={() => startRename(name)}
                    title="Rename profile"
                    className="text-gray-300 hover:text-blue-500 transition-colors text-xs leading-none flex-shrink-0"
                  >
                    ✎
                  </button>
                </div>
              )}

              {/* Bound keyword badges */}
              {boundKeywords.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 mt-1.5">
                  {boundKeywords.map((kw) => (
                    <span
                      key={kw}
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-700 border border-blue-100 font-mono"
                    >
                      {kw}
                    </span>
                  ))}
                  <span className="text-xs text-gray-400">
                    {boundKeywords.length === 1 ? '1 binding' : `${boundKeywords.length} bindings`}
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={() => handleDeleteProfile(name)}
              className="text-xs text-red-400 hover:text-red-600 transition-colors flex-shrink-0 mt-0.5"
            >
              Delete
            </button>
          </div>

          {/* Domain list */}
          <ul className="space-y-1 mb-3">
            {domains.map((domain) => (
              <li key={domain} className="flex items-center justify-between group">
                <span className="text-gray-700 font-mono text-xs">{domain}</span>
                <button
                  onClick={() => removeDomainFromProfile(name, domain)}
                  title={`Remove ${domain}`}
                  className="text-gray-300 hover:text-red-500 transition-colors text-xs opacity-0 group-hover:opacity-100"
                >
                  ✕
                </button>
              </li>
            ))}
            {domains.length === 0 && (
              <li className="text-xs text-gray-400 italic">No domains yet — add one below.</li>
            )}
          </ul>

          {/* Add domain */}
          <div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="github.com"
                value={domainInput[name] ?? ''}
                onChange={(e) => {
                  setDomainInput((d) => ({ ...d, [name]: e.target.value }));
                  setDomainError((err) => ({ ...err, [name]: '' }));
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleAddDomain(name)}
                className={`flex-1 text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  domainError[name] ? 'border-red-400' : 'border-gray-200'
                }`}
              />
              <button
                onClick={() => handleAddDomain(name)}
                className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Add domain
              </button>
            </div>
            {domainError[name] && (
              <p className="text-xs text-red-500 mt-1">{domainError[name]}</p>
            )}
          </div>
        </div>
      ))}

      {entries.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">
          No profiles yet. Create one above.
        </p>
      )}
    </div>
  );
}
