import React, { useState } from 'react';
import type { Task } from '../../shared/types';

interface Props {
  tasks: Task[];
}

function daysUntilExpiry(expiresAt: string): number {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

function formatScheduledDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function TaskQueue({ tasks }: Props): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);

  const carryover = tasks.filter((t) => t.status === 'carryover');
  const active = tasks.filter((t) => t.status === 'active');
  const pending = [...carryover, ...active]; // carryover first

  if (pending.length === 0) return null;

  const headerText =
    carryover.length > 0
      ? `${carryover.length} carryover task${carryover.length === 1 ? '' : 's'}${
          active.length > 0 ? ` + ${active.length} active` : ''
        }`
      : `${active.length} active task${active.length === 1 ? '' : 's'}`;

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--fg-border)] bg-white">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="text-xs font-semibold text-[var(--fg-text)]">{headerText}</span>
        <span className="rounded-md bg-[var(--fg-panel-soft)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--fg-muted)]">
          {expanded ? 'hide ▲' : 'show ▼'}
        </span>
      </button>

      {expanded && (
        <ul className="space-y-1.5 border-t border-[var(--fg-border)] px-3 pb-3 pt-2">
          {pending.map((task) => {
            const daysLeft = task.expiresAt ? daysUntilExpiry(task.expiresAt) : null;
            const isUrgent = daysLeft !== null && daysLeft <= 2;

            return (
              <li key={task.id}>
                <div className="rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-2.5 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-xs font-semibold leading-snug text-[var(--fg-text)]">
                      {task.eventTitle}
                    </p>
                    {task.status === 'carryover' && (
                      <span className="flex-shrink-0 rounded-md bg-[var(--fg-accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--fg-accent)]">
                        carryover
                      </span>
                    )}
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md border border-[var(--fg-border)] bg-white px-1.5 py-0.5 text-[10px] font-medium text-[var(--fg-text)]">
                      {task.profile}
                    </span>

                    <span className="text-[10px] text-[var(--fg-muted)]">
                      {formatScheduledDate(task.scheduledStart)}
                    </span>

                    {daysLeft !== null && (
                      <span
                        className={`text-[10px] font-medium ${
                          isUrgent ? 'text-rose-500' : 'text-[var(--fg-muted)]'
                        }`}
                      >
                        {isUrgent ? `urgent · ${daysLeft}d left` : `expires in ${daysLeft}d`}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
