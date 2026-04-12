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
    <div className="overflow-hidden rounded-2xl border border-violet-100 bg-violet-50/70">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="text-xs font-semibold text-violet-700">{headerText}</span>
        <span className="text-[10px] font-medium text-violet-400">
          {expanded ? 'hide ▲' : 'show ▼'}
        </span>
      </button>

      {expanded && (
        <ul className="space-y-2.5 border-t border-violet-100 px-3 pb-3 pt-2.5">
          {pending.map((task) => {
            const daysLeft = task.expiresAt ? daysUntilExpiry(task.expiresAt) : null;
            const isUrgent = daysLeft !== null && daysLeft <= 2;

            return (
              <li key={task.id}>
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-xs font-semibold leading-snug text-slate-900">
                    {task.eventTitle}
                  </p>
                  {task.status === 'carryover' && (
                    <span className="flex-shrink-0 rounded bg-violet-200 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                      carryover
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] text-violet-600">
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
