import React, { useEffect, useState } from 'react';
import {
  MAX_TASK_TTL_DAYS,
  MIN_TASK_TTL_DAYS,
} from '../../shared/constants';
import { addToGlobalAllowlist, removeFromGlobalAllowlist } from '../../shared/profiles';
import { getGlobalAllowlist, getSettings, setSettings } from '../../shared/storage';
import type { Settings as SettingsType } from '../../shared/types';

export default function Settings(): React.JSX.Element {
  const [settings, setLocalSettings] = useState<SettingsType | null>(null);
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [domainError, setDomainError] = useState('');

  // ── Load & cross-tab sync ─────────────────────────────────────────────────

  const loadData = async () => {
    const [s, a] = await Promise.all([getSettings(), getGlobalAllowlist()]);
    setLocalSettings(s);
    setAllowlist(a);
  };

  useEffect(() => {
    loadData();

    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('settings' in changes || 'globalAllowlist' in changes) {
        loadData();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Settings update ───────────────────────────────────────────────────────

  const update = async (patch: Partial<SettingsType>) => {
    if (!settings) return;
    const updated = { ...settings, ...patch };
    setLocalSettings(updated);
    await setSettings(updated);
  };

  // ── Global allowlist ──────────────────────────────────────────────────────

  const handleAddDomain = async () => {
    setDomainError('');
    const result = await addToGlobalAllowlist(newDomain);
    if (!result.ok) {
      setDomainError(result.error ?? 'Invalid domain');
      return;
    }
    setNewDomain('');
  };

  const handleRemoveDomain = async (domain: string) => {
    await removeFromGlobalAllowlist(domain);
  };

  if (!settings) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-8">
      {/* ── Blocking settings ─────────────────────────────────────────────── */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-4">Settings</h2>

        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          <Row label="Enable blocking">
            <Toggle
              checked={settings.enableBlocking}
              onChange={(v) => update({ enableBlocking: v })}
            />
          </Row>

          <Row label="Carryover mode" description="How overlapping carryover tasks are combined">
            <select
              value={settings.carryoverMode}
              onChange={(e) =>
                update({ carryoverMode: e.target.value as SettingsType['carryoverMode'] })
              }
              className="text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="union">Union (more forgiving)</option>
              <option value="intersection">Intersection (strict)</option>
            </select>
          </Row>

          <Row label="Task TTL (days)" description={`${MIN_TASK_TTL_DAYS}–${MAX_TASK_TTL_DAYS} days`}>
            <input
              type="number"
              min={MIN_TASK_TTL_DAYS}
              max={MAX_TASK_TTL_DAYS}
              value={settings.taskTTLDays}
              onChange={(e) => update({ taskTTLDays: Number(e.target.value) })}
              className="w-16 text-sm border border-gray-200 rounded-lg px-2 py-1 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </Row>

          <Row label="Monthly reset" description="Clear all tasks on the 1st of each month">
            <Toggle
              checked={settings.monthlyResetEnabled}
              onChange={(v) => update({ monthlyResetEnabled: v })}
            />
          </Row>

          <Row label="Min block duration (min)" description="Blocks shorter than this earn no points">
            <input
              type="number"
              min={15}
              max={30}
              value={settings.minBlockDurationMinutes}
              onChange={(e) => update({ minBlockDurationMinutes: Number(e.target.value) })}
              className="w-16 text-sm border border-gray-200 rounded-lg px-2 py-1 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </Row>
        </div>
      </div>

      {/* ── Global allowlist ───────────────────────────────────────────────── */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Global Allowlist</h2>
        <p className="text-sm text-gray-500 mb-4">
          Domains always reachable regardless of the active profile — useful for auth flows
          and essential services.
        </p>

        {/* Add domain */}
        <div className="mb-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="accounts.google.com"
              value={newDomain}
              onChange={(e) => {
                setNewDomain(e.target.value);
                setDomainError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleAddDomain()}
              className={`flex-1 text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                domainError ? 'border-red-400' : 'border-gray-200'
              }`}
            />
            <button
              onClick={handleAddDomain}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
            >
              Add
            </button>
          </div>
          {domainError && <p className="text-xs text-red-500 mt-1">{domainError}</p>}
        </div>

        {/* Allowlist */}
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {allowlist.map((domain) => (
            <div key={domain} className="flex items-center justify-between px-4 py-2.5 group">
              <span className="text-sm font-mono text-gray-700">{domain}</span>
              <button
                onClick={() => handleRemoveDomain(domain)}
                className="text-xs text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                title={`Remove ${domain}`}
              >
                ✕
              </button>
            </div>
          ))}
          {allowlist.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-5 italic">
              No domains in global allowlist.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {description && <p className="text-xs text-gray-400">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-5 w-10 shrink-0 items-center rounded-full p-[2px] transition-colors ${
        checked ? 'bg-blue-600' : 'bg-gray-300'
      }`}
    >
      <span
        className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
