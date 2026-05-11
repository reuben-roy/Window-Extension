import React from 'react';
import { findExtendedTaskAssignment } from '../../shared/extendedTasks';
import type { CalendarEvent, ExtendedTaskAssignment } from '../../shared/types';

interface Props {
  sections: { label: string; hint?: string; events: CalendarEvent[] }[];
  extendedTaskAssignments: ExtendedTaskAssignment[];
  formatEventRange: (event: CalendarEvent) => string;
  onSelectEvent: (event: CalendarEvent) => void;
}

function TaskSetBadge({
  assignment,
}: {
  assignment: ExtendedTaskAssignment | null;
}): React.JSX.Element {
  if (assignment) {
    return (
      <span
        className="inline-flex max-w-full items-center truncate rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-900"
        title={assignment.setTitle}
      >
        Task set · {assignment.setTitle}
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--fg-muted)]">
      No task set
    </span>
  );
}

export default function UpcomingCalendarBlocks({
  sections,
  extendedTaskAssignments,
  formatEventRange,
  onSelectEvent,
}: Props): React.JSX.Element | null {
  const nonEmpty = sections.filter((s) => s.events.length > 0);
  if (nonEmpty.length === 0) return null;

  return (
    <div className="space-y-3">
      {nonEmpty.map((section) => (
        <div key={section.label}>
          <div className="mb-1.5 flex items-center gap-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--fg-muted)]">{section.label}</p>
          </div>
          {section.hint ? <p className="mb-2 text-[10px] leading-snug text-[var(--fg-muted)]">{section.hint}</p> : null}
          <ul className="space-y-1.5">
            {section.events.map((event) => {
              const assignment = findExtendedTaskAssignment(event.id, extendedTaskAssignments);
              return (
                <li key={event.id}>
                  <button
                    type="button"
                    onClick={() => onSelectEvent(event)}
                    className="w-full rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-2.5 py-2 text-left transition hover:border-blue-200"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-xs font-semibold leading-snug text-[var(--fg-text)]">
                        {event.title || 'Untitled'}
                      </p>
                      <TaskSetBadge assignment={assignment} />
                    </div>
                    <p className="mt-1 text-[10px] text-[var(--fg-muted)]">{formatEventRange(event)}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
