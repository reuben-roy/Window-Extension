import React from 'react';
import type { DifficultyRank, KeywordRule, TaskTag } from '../../shared/types';
import { getSelectableTaskTags } from '../lib';

export function RuleListItem({
  title,
  subtitle,
  domains,
  tagLabel,
  difficultyRank,
  isUnrestrictedOverride = false,
  onDelete,
}: {
  title: string;
  subtitle: string;
  domains: string[];
  tagLabel?: string | null;
  difficultyRank?: DifficultyRank | null;
  isUnrestrictedOverride?: boolean;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--fg-text)]">{title}</p>
          <p className="text-xs text-[var(--fg-muted)]">{subtitle}</p>
          {(tagLabel || difficultyRank) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {tagLabel ? (
                <span className="rounded-full border border-[var(--fg-border)] bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
                  {tagLabel}
                </span>
              ) : null}
              {difficultyRank ? (
                <span className="rounded-full border border-[var(--fg-border)] bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
                  D{difficultyRank}
                </span>
              ) : null}
            </div>
          )}
        </div>
        <button onClick={onDelete} className="text-sm font-medium text-rose-600 transition hover:text-rose-700">
          Delete
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {domains.length > 0 ? (
          domains.map((domain) => (
            <span
              key={domain}
              className="rounded-full border border-[var(--fg-border)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--fg-text)]"
            >
              {domain}
            </span>
          ))
        ) : isUnrestrictedOverride ? (
          <span className="text-xs text-[var(--fg-muted)]">Keeps this event title unrestricted.</span>
        ) : (
          <span className="text-xs text-[var(--fg-muted)]">No allowed domains configured.</span>
        )}
      </div>
    </div>
  );
}

export function KeywordRuleListItem({
  rule,
  taskTags,
  onTagChange,
  onDelete,
}: {
  rule: KeywordRule;
  taskTags: TaskTag[];
  onTagChange: (tagKey: string) => void;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--fg-text)]">{rule.keyword}</p>
          <p className="text-xs text-[var(--fg-muted)]">Fallback keyword rule</p>
        </div>
        <button onClick={onDelete} className="text-sm font-medium text-rose-600 transition hover:text-rose-700">
          Delete
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr),180px]">
        <div className="flex flex-wrap gap-2">
          {rule.domains.length > 0 ? (
            rule.domains.map((domain) => (
              <span
                key={domain}
                className="rounded-full border border-[var(--fg-border)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--fg-text)]"
              >
                {domain}
              </span>
            ))
          ) : (
            <span className="text-xs text-[var(--fg-muted)]">No allowed domains configured.</span>
          )}
        </div>

        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--fg-muted)]">
            Linked tag
          </p>
          <select
            value={rule.tagKey ?? ''}
            onChange={(event) => onTagChange(event.target.value)}
            className="fg-select w-full"
          >
            <option value="">No linked tag</option>
            {getSelectableTaskTags(taskTags, [rule.tagKey ?? '']).map((tag) => (
              <option key={tag.key} value={tag.key}>
                {tag.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
