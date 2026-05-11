import React, { useState } from 'react';
import { findExtendedTaskAssignment } from '../../shared/extendedTasks';
import type { ExtendedTaskAssignment, Task } from '../../shared/types';

interface Props {
  tasks: Task[];
  extendedTaskAssignments?: ExtendedTaskAssignment[];
  onSelectTask: (task: Task) => void;
}

function daysUntilExpiry(expiresAt: string): number {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

function formatScheduledDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function TaskSetBadge({
  assignment,
}: {
  assignment: ExtendedTaskAssignment | null;
}): React.JSX.Element {
  if (assignment) {
    return (
      <span
        className="inline-flex max-w-[140px] shrink-0 items-center truncate rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-900 sm:max-w-[180px]"
        title={assignment.setTitle}
      >
        Task set · {assignment.setTitle}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 rounded-full border border-[var(--fg-border)] bg-white px-2 py-0.5 text-[10px] font-semibold text-[var(--fg-muted)]">
      No task set
    </span>
  );
}

export default function TaskQueue({ tasks, extendedTaskAssignments = [], onSelectTask }: Props): React.JSX.Element | null {
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
            const assignment = findExtendedTaskAssignment(task.calendarEventId, extendedTaskAssignments);

            return (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => onSelectTask(task)}
                  className="w-full rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-2.5 py-2 text-left transition hover:border-blue-200"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-xs font-semibold leading-snug text-[var(--fg-text)]">
                      {task.eventTitle}
                    </p>
                    <TaskSetBadge assignment={assignment} />
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md border border-[var(--fg-border)] bg-white px-1.5 py-0.5 text-[10px] font-medium text-[var(--fg-text)]">
                      {task.profile}
                    </span>

                    <span className="text-[10px] text-[var(--fg-muted)]">
                      {formatScheduledDate(task.scheduledStart)}
                    </span>

                    {task.status === 'carryover' && (
                      <span className="rounded-md bg-[var(--fg-accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--fg-accent)]">
                        carryover
                      </span>
                    )}

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

                  <p className="mt-1 text-[10px] text-[var(--fg-muted)]">Tap for details · remove task set here</p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
