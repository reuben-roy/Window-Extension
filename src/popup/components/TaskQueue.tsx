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
    <div className="rounded-xl border border-orange-200 bg-orange-50 overflow-hidden">
      {/* Header / toggle */}
      <button
        className="w-full px-3 py-2 flex items-center justify-between text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="text-xs font-semibold text-orange-700">{headerText}</span>
        <span className="text-[10px] font-medium text-orange-400">
          {expanded ? 'hide ▲' : 'show ▼'}
        </span>
      </button>

      {/* Task list */}
      {expanded && (
        <ul className="px-3 pb-3 space-y-2.5 border-t border-orange-100 pt-2.5">
          {pending.map((task) => {
            const daysLeft = task.expiresAt ? daysUntilExpiry(task.expiresAt) : null;
            const isUrgent = daysLeft !== null && daysLeft <= 2;

            return (
              <li key={task.id}>
                {/* Title row */}
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold text-orange-900 leading-snug truncate">
                    {task.eventTitle}
                  </p>
                  {task.status === 'carryover' && (
                    <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 bg-orange-200 text-orange-700 rounded font-medium">
                      carryover
                    </span>
                  )}
                </div>

                {/* Meta row */}
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {/* Profile */}
                  <span className="text-[10px] text-orange-500 bg-orange-100 px-1.5 py-0.5 rounded-full">
                    {task.profile}
                  </span>

                  {/* Scheduled date */}
                  <span className="text-[10px] text-orange-400">
                    {formatScheduledDate(task.scheduledStart)}
                  </span>

                  {/* Expiry countdown */}
                  {daysLeft !== null && (
                    <span
                      className={`text-[10px] font-medium ${
                        isUrgent ? 'text-red-500' : 'text-orange-400'
                      }`}
                    >
                      {isUrgent ? `⚠ expires in ${daysLeft}d` : `expires in ${daysLeft}d`}
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
