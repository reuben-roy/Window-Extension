import React, { useState } from 'react';
import type { CalendarEvent, ExtendedTaskAssignment, Task } from '../../shared/types';

export type TaskDetailSelection =
  | { kind: 'task'; task: Task }
  | { kind: 'event'; event: CalendarEvent };

interface Props {
  selection: TaskDetailSelection;
  assignment: ExtendedTaskAssignment | null;
  formatEventRange: (event: CalendarEvent) => string;
  onClose: () => void;
  onRemoveAssignment: (calendarEventId: string) => Promise<{ ok: boolean; error?: string }>;
  onOpenWorkspace: () => void;
}

const PREVIEW_STEPS = 5;

export default function TaskDetailModal({
  selection,
  assignment,
  formatEventRange,
  onClose,
  onRemoveAssignment,
  onOpenWorkspace,
}: Props): React.JSX.Element {
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const event = selection.kind === 'task' ? taskAsPseudoEvent(selection.task) : selection.event;
  const calendarEventId = selection.kind === 'task' ? selection.task.calendarEventId : selection.event.id;

  const title =
    selection.kind === 'task' ? selection.task.eventTitle : selection.event.title || 'Untitled event';

  const assignmentItems = assignment?.items ?? [];
  const needsCollapse = assignmentItems.length > PREVIEW_STEPS;
  const steps =
    needsCollapse && !stepsExpanded ? assignmentItems.slice(0, PREVIEW_STEPS) : assignmentItems;

  const handleRemove = async () => {
    setRemoveError(null);
    setRemoving(true);
    try {
      const result = await onRemoveAssignment(calendarEventId);
      if (!result.ok) {
        setRemoveError(result.error ?? 'Could not remove the task set.');
      }
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : 'Could not remove the task set.');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-2"
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-detail-title"
      onClick={onClose}
    >
      <div
        className="max-h-[min(640px,92vh)] w-full max-w-[620px] overflow-hidden rounded-xl border border-[var(--fg-border)] bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--fg-border)] px-4 py-3">
          <h2 id="task-detail-title" className="text-base font-semibold leading-snug text-[var(--fg-text)]">
            Block details
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--fg-border)] bg-white px-3 py-1 text-[11px] font-medium text-[var(--fg-muted)] hover:border-[var(--fg-text)] hover:text-[var(--fg-text)]"
          >
            Close
          </button>
        </div>

        <div className="grid max-h-[calc(min(640px,92vh)-56px)] grid-cols-1 gap-0 overflow-y-auto md:grid-cols-2 md:divide-x md:divide-[var(--fg-border)]">
          <div className="space-y-3 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--fg-muted)]">
              Calendar block
            </p>
            <p className="text-sm font-semibold text-[var(--fg-text)]">{title}</p>
            <p className="text-xs leading-relaxed text-[var(--fg-muted)]">{formatEventRange(event)}</p>
            {selection.kind === 'task' ? (
              <div className="flex flex-wrap gap-2">
                <span className="rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--fg-text)]">
                  {selection.task.profile}
                </span>
                <span className="rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--fg-text)]">
                  {selection.task.status === 'carryover' ? 'Carryover task' : 'Active task'}
                </span>
              </div>
            ) : (
              <span className="inline-flex rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--fg-text)]">
                Scheduled block
              </span>
            )}
            <p className="text-[11px] leading-snug text-[var(--fg-muted)]">
              Task sets apply to this calendar occurrence. Manage advanced options in the workspace.
            </p>
            <button
              type="button"
              onClick={() => {
                onOpenWorkspace();
                onClose();
              }}
              className="fg-button-secondary w-full px-3 py-2 text-[11px]"
            >
              Open calendar workspace
            </button>
          </div>

          <div className="space-y-3 border-t border-[var(--fg-border)] p-4 md:border-t-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--fg-muted)]">
              Task set
            </p>
            {assignment ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--fg-text)]">{assignment.setTitle}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--fg-muted)]">
                      {assignment.items.length} linked step{assignment.items.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={removing}
                    onClick={() => void handleRemove()}
                    className="flex-shrink-0 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                  >
                    {removing ? 'Removing…' : 'Remove task set'}
                  </button>
                </div>
                {removeError ? <p className="text-[11px] text-rose-600">{removeError}</p> : null}

                <div
                  className={
                    needsCollapse && stepsExpanded
                      ? 'max-h-[min(260px,40vh)] space-y-1 overflow-y-auto pr-0.5'
                      : 'space-y-1'
                  }
                >
                  {steps.map((item) => {
                    const completed = item.completedAt !== null;
                    const stepNo = assignmentItems.indexOf(item) + 1;
                    return (
                      <div
                        key={item.id}
                        className={`flex items-start justify-between gap-2 rounded-lg border px-2 py-1.5 ${
                          completed ? 'border-emerald-200 bg-emerald-50/80' : 'border-[var(--fg-border)] bg-[var(--fg-panel-soft)]'
                        }`}
                      >
                        <p
                          className={`min-w-0 flex-1 text-[11px] font-medium leading-snug ${
                            completed ? 'text-emerald-900 line-through' : 'text-[var(--fg-text)]'
                          }`}
                        >
                          <span className="mr-1 font-semibold text-[var(--fg-muted)]">{stepNo}.</span>
                          {item.label}
                        </p>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex-shrink-0 text-[10px] font-medium text-[var(--fg-accent)]"
                        >
                          Open
                        </a>
                      </div>
                    );
                  })}
                </div>
                {needsCollapse ? (
                  <button
                    type="button"
                    onClick={() => setStepsExpanded((v) => !v)}
                    className="w-full rounded-md border border-[var(--fg-border)] bg-white py-1.5 text-[10px] font-medium text-[var(--fg-text)]"
                  >
                    {stepsExpanded ? 'Show fewer steps' : `Show all ${assignmentItems.length} steps`}
                  </button>
                ) : null}
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-3">
                <p className="text-sm font-medium text-[var(--fg-text)]">No task set yet</p>
                <p className="mt-1 text-[11px] leading-snug text-[var(--fg-muted)]">
                  This block is free for a roadmap or checklist. Open the workspace and drag a task set onto this event on
                  the calendar.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Build a minimal CalendarEvent shape for formatting when opened from a Task row. */
function taskAsPseudoEvent(task: Task): CalendarEvent {
  return {
    id: task.calendarEventId,
    title: task.eventTitle,
    start: task.scheduledStart,
    end: task.scheduledEnd,
    isAllDay: false,
    description: null,
    attendees: [],
  };
}
