import React, { useEffect, useMemo, useState } from 'react';
import InfoTip from '../../shared/components/InfoTip';
import type { DifficultyRank, TaskTag } from '../../shared/types';
import { parseDifficultyRank, splitCommaList, splitDomains } from '../lib';
import { EmptyCard } from './EmptyCard';

export function TagManager({
  taskTags,
  activeTaskTags,
  tagReferenceKeys,
  onSaveTag,
  onToggleArchive,
  onDeleteTag,
}: {
  taskTags: TaskTag[];
  activeTaskTags: TaskTag[];
  tagReferenceKeys: Set<string>;
  onSaveTag: (input: {
    existingKey?: string | null;
    label: string;
    color: string;
    aliases: string[];
    baselineDifficulty: DifficultyRank;
    alignedDomains: string[];
    supportiveDomains: string[];
    archivedAt?: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
  onToggleArchive: (tagKey: string, archived: boolean) => Promise<void>;
  onDeleteTag: (tagKey: string) => Promise<{ ok: boolean; error?: string }>;
}): React.JSX.Element {
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('#2563eb');
  const [aliases, setAliases] = useState('');
  const [baselineDifficulty, setBaselineDifficulty] = useState<string>('3');
  const [alignedDomains, setAlignedDomains] = useState('');
  const [supportiveDomains, setSupportiveDomains] = useState('');
  const [error, setError] = useState('');

  const filteredTags = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...taskTags]
      .filter((tag) => (showArchived ? true : tag.archivedAt === null))
      .filter((tag) => {
        if (!normalizedQuery) return true;
        const haystack = [
          tag.label,
          tag.key,
          ...tag.aliases,
          ...tag.alignedDomains,
          ...tag.supportiveDomains,
        ].join(' ').toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .sort(
        (left, right) =>
          Number(Boolean(left.archivedAt)) - Number(Boolean(right.archivedAt)) ||
          left.label.localeCompare(right.label),
      );
  }, [query, showArchived, taskTags]);

  return (
    <section className="fg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-[var(--fg-text)]">Tag Manager</h2>
          <InfoTip text="Manage reusable task tags, their default difficulty, and the domains Window should treat as aligned or supportive." />
        </div>
        <div className="text-xs text-[var(--fg-muted)]">
          Active tags: {activeTaskTags.length} · Archived tags: {taskTags.length - activeTaskTags.length}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tags, keys, domains…"
            className="fg-input w-[min(420px,100%)]"
          />
          <button
            className={`fg-button-secondary px-3 py-2 text-sm ${showArchived ? 'opacity-100' : 'opacity-80'}`}
            onClick={() => setShowArchived((value) => !value)}
          >
            {showArchived ? 'Showing archived' : 'Hide archived'}
          </button>
        </div>
        <button
          className="fg-button-primary px-4 py-2.5 text-sm"
          onClick={() => {
            setCreateOpen((value) => !value);
            setExpandedKey(null);
          }}
        >
          {createOpen ? 'Close' : 'New tag'}
        </button>
      </div>

      {createOpen ? (
        <div className="mb-4 rounded-lg border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] p-3">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr),140px,160px]">
            <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Research ops" className="fg-input" />
            <input value={color} onChange={(event) => setColor(event.target.value)} placeholder="#2563eb" className="fg-input" />
            <select value={baselineDifficulty} onChange={(event) => setBaselineDifficulty(event.target.value)} className="fg-select">
              <option value="1">1 · Routine</option>
              <option value="2">2 · Light</option>
              <option value="3">3 · Standard</option>
              <option value="5">5 · Demanding</option>
              <option value="8">8 · Deep</option>
            </select>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <input value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="aliases: research, analyze" className="fg-input" />
            <input value={alignedDomains} onChange={(event) => setAlignedDomains(event.target.value)} placeholder="aligned: github.com, figma.com" className="fg-input" />
            <input value={supportiveDomains} onChange={(event) => setSupportiveDomains(event.target.value)} placeholder="supportive: docs.google.com" className="fg-input" />
          </div>
          {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
          <div className="mt-2 flex justify-end">
            <button
              className="fg-button-primary px-4 py-2.5 text-sm"
              onClick={async () => {
                setError('');
                const result = await onSaveTag({
                  label,
                  color,
                  aliases: splitCommaList(aliases),
                  baselineDifficulty: parseDifficultyRank(baselineDifficulty) ?? 3,
                  alignedDomains: splitDomains(alignedDomains),
                  supportiveDomains: splitDomains(supportiveDomains),
                  archivedAt: null,
                });
                if (!result.ok) {
                  setError(result.error ?? 'Unable to save tag.');
                  return;
                }
                setLabel('');
                setColor('#2563eb');
                setAliases('');
                setAlignedDomains('');
                setSupportiveDomains('');
                setBaselineDifficulty('3');
                setCreateOpen(false);
              }}
            >
              Create Tag
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {filteredTags.length === 0 ? (
          <EmptyCard text="No matching tags." />
        ) : (
          filteredTags.map((tag) => (
            <TagManagerRow
              key={tag.key}
              tag={tag}
              isReferenced={tagReferenceKeys.has(tag.key)}
              isExpanded={expandedKey === tag.key}
              onToggleExpanded={() => setExpandedKey((value) => (value === tag.key ? null : tag.key))}
              onSaveTag={onSaveTag}
              onToggleArchive={onToggleArchive}
              onDeleteTag={onDeleteTag}
            />
          ))
        )}
      </div>
    </section>
  );
}

function TagManagerRow({
  tag,
  isReferenced,
  isExpanded,
  onToggleExpanded,
  onSaveTag,
  onToggleArchive,
  onDeleteTag,
}: {
  tag: TaskTag;
  isReferenced: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onSaveTag: (input: {
    existingKey?: string | null;
    label: string;
    color: string;
    aliases: string[];
    baselineDifficulty: DifficultyRank;
    alignedDomains: string[];
    supportiveDomains: string[];
    archivedAt?: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
  onToggleArchive: (tagKey: string, archived: boolean) => Promise<void>;
  onDeleteTag: (tagKey: string) => Promise<{ ok: boolean; error?: string }>;
}): React.JSX.Element {
  const [label, setLabel] = useState(tag.label);
  const [color, setColor] = useState(tag.color);
  const [aliases, setAliases] = useState(tag.aliases.join(', '));
  const [baselineDifficulty, setBaselineDifficulty] = useState<string>(String(tag.baselineDifficulty));
  const [alignedDomains, setAlignedDomains] = useState(tag.alignedDomains.join(', '));
  const [supportiveDomains, setSupportiveDomains] = useState(tag.supportiveDomains.join(', '));
  const [error, setError] = useState('');

  useEffect(() => {
    setLabel(tag.label);
    setColor(tag.color);
    setAliases(tag.aliases.join(', '));
    setBaselineDifficulty(String(tag.baselineDifficulty));
    setAlignedDomains(tag.alignedDomains.join(', '));
    setSupportiveDomains(tag.supportiveDomains.join(', '));
    setError('');
  }, [tag]);

  return (
    <div className="rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)]">
      <div className="grid grid-cols-[minmax(0,1fr),auto] items-center gap-3 px-3 py-2.5">
        <button className="min-w-0 text-left" onClick={onToggleExpanded}>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: tag.color }} />
            <p className="truncate text-sm font-medium text-[var(--fg-text)]">{tag.label}</p>
            <span className="hidden text-xs text-[var(--fg-muted)] md:inline">
              `{tag.key}` {tag.archivedAt ? '· Archived' : ''} {isReferenced ? '· In use' : ''}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
            Difficulty {tag.baselineDifficulty} · {tag.alignedDomains.length} aligned · {tag.supportiveDomains.length} supportive · {tag.aliases.length} alias{tag.aliases.length === 1 ? '' : 'es'}
          </p>
        </button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button className="fg-button-secondary px-3 py-2 text-sm" onClick={onToggleExpanded}>
            {isExpanded ? 'Close' : 'Edit'}
          </button>
          <button
            className="fg-button-secondary px-3 py-2 text-sm"
            onClick={() => onToggleArchive(tag.key, tag.archivedAt === null)}
          >
            {tag.archivedAt ? 'Unarchive' : 'Archive'}
          </button>
          <button
            className="fg-button-ghost px-3 py-2 text-sm text-rose-600"
            onClick={async () => {
              const result = await onDeleteTag(tag.key);
              if (!result.ok) {
                setError(result.error ?? 'Unable to delete tag.');
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {isExpanded ? (
        <div className="border-t border-[var(--fg-border)] px-3 py-3">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr),140px,160px]">
            <input value={label} onChange={(event) => setLabel(event.target.value)} className="fg-input" />
            <input value={color} onChange={(event) => setColor(event.target.value)} className="fg-input" />
            <select value={baselineDifficulty} onChange={(event) => setBaselineDifficulty(event.target.value)} className="fg-select">
              <option value="1">1 · Routine</option>
              <option value="2">2 · Light</option>
              <option value="3">3 · Standard</option>
              <option value="5">5 · Demanding</option>
              <option value="8">8 · Deep</option>
            </select>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <input value={aliases} onChange={(event) => setAliases(event.target.value)} className="fg-input" />
            <input value={alignedDomains} onChange={(event) => setAlignedDomains(event.target.value)} className="fg-input" />
            <input value={supportiveDomains} onChange={(event) => setSupportiveDomains(event.target.value)} className="fg-input" />
          </div>
          {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
          <div className="mt-2 flex justify-end">
            <button
              className="fg-button-primary px-4 py-2.5 text-sm"
              onClick={async () => {
                setError('');
                const result = await onSaveTag({
                  existingKey: tag.key,
                  label,
                  color,
                  aliases: splitCommaList(aliases),
                  baselineDifficulty: parseDifficultyRank(baselineDifficulty) ?? 3,
                  alignedDomains: splitDomains(alignedDomains),
                  supportiveDomains: splitDomains(supportiveDomains),
                  archivedAt: tag.archivedAt,
                });
                if (!result.ok) {
                  setError(result.error ?? 'Unable to save tag.');
                }
              }}
            >
              Save Tag
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
