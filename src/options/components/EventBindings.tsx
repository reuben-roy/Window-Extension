import React, { useEffect, useState } from 'react';
import { addBinding, removeBinding } from '../../shared/profiles';
import { getEventBindings, getProfiles } from '../../shared/storage';
import type { EventBindings as EventBindingsType, Profiles } from '../../shared/types';

export default function EventBindings(): React.JSX.Element {
  const [bindings, setLocalBindings] = useState<EventBindingsType>({});
  const [profiles, setLocalProfiles] = useState<Profiles>({});
  const [keyword, setKeyword] = useState('');
  const [selectedProfile, setSelectedProfile] = useState('');
  const [addError, setAddError] = useState('');

  // ── Load & cross-tab sync ─────────────────────────────────────────────────

  const loadData = async () => {
    const [b, p] = await Promise.all([getEventBindings(), getProfiles()]);
    setLocalBindings(b);
    setLocalProfiles(p);
    // Keep selectedProfile valid; fall back to first profile if current is gone
    setSelectedProfile((prev) => (p[prev] !== undefined ? prev : (Object.keys(p)[0] ?? '')));
  };

  useEffect(() => {
    loadData();

    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('eventBindings' in changes || 'profiles' in changes) {
        loadData();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add binding ───────────────────────────────────────────────────────────

  const handleAdd = async () => {
    setAddError('');
    if (!selectedProfile) {
      setAddError('Create a profile first before adding a binding.');
      return;
    }
    const result = await addBinding(keyword, selectedProfile);
    if (!result.ok) {
      setAddError(result.error ?? 'Unknown error');
      return;
    }
    setKeyword('');
  };

  // ── Remove binding ────────────────────────────────────────────────────────

  const handleRemove = async (kw: string) => {
    await removeBinding(kw);
  };

  const profileNames = Object.keys(profiles);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Event Bindings</h2>
        <p className="text-sm text-gray-500">
          Map calendar event title keywords to profiles. Matching is case-insensitive
          and checks whether the keyword appears anywhere in the event title.
        </p>
      </div>

      {/* Add binding */}
      <div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Keyword (e.g. deep work)"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setAddError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {profileNames.length > 0 ? (
            <select
              value={selectedProfile}
              onChange={(e) => setSelectedProfile(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {profileNames.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-gray-400 self-center px-2">No profiles</span>
          )}
          <button
            onClick={handleAdd}
            disabled={profileNames.length === 0}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Add
          </button>
        </div>
        {addError && <p className="text-xs text-red-500 mt-1">{addError}</p>}
        {profileNames.length === 0 && (
          <p className="text-xs text-amber-600 mt-1">
            Go to the Profiles tab to create a profile first.
          </p>
        )}
      </div>

      {/* Binding list */}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {Object.entries(bindings).map(([kw, profile]) => {
          const isStale = profiles[profile] === undefined;
          return (
            <div key={kw} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-mono text-gray-800 truncate">"{kw}"</span>
                <span className="text-gray-300 flex-shrink-0">→</span>
                {isStale ? (
                  <span
                    className="text-sm text-red-500 flex items-center gap-1"
                    title="This profile no longer exists"
                  >
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                    <span className="truncate">{profile}</span>
                    <span className="text-xs text-red-400 flex-shrink-0">(deleted)</span>
                  </span>
                ) : (
                  <span className="text-sm text-gray-600 truncate">{profile}</span>
                )}
              </div>
              <button
                onClick={() => handleRemove(kw)}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors ml-3 flex-shrink-0"
              >
                Remove
              </button>
            </div>
          );
        })}
        {Object.keys(bindings).length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6 italic">No bindings yet.</p>
        )}
      </div>

      {/* Stale binding warning */}
      {Object.entries(bindings).some(([, p]) => profiles[p] === undefined) && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">
          <span className="mt-0.5 flex-shrink-0">⚠</span>
          <span>
            Some bindings point to profiles that no longer exist. They will be ignored during
            calendar sync. Remove them or recreate the missing profiles.
          </span>
        </div>
      )}
    </div>
  );
}
