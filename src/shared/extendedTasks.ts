import {
  getExtendedTaskAssignments,
  setExtendedTaskAssignments,
} from './storage';
import type {
  CalendarEvent,
  ExtendedTaskAssignment,
  ExtendedTaskAssignmentItem,
  ExtendedTaskSetDefinition,
  EventLaunchTarget,
} from './types';

const EXTENDED_TASK_ASSIGNMENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function safeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `extended-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeExtendedTaskUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function createExtendedTaskAssignment(
  event: CalendarEvent,
  taskSet: ExtendedTaskSetDefinition,
  now: string = new Date().toISOString(),
): ExtendedTaskAssignment {
  const items: ExtendedTaskAssignmentItem[] = taskSet.items.map((item) => ({
    id: safeId(),
    label: item.label,
    url: item.url,
    completedAt: null,
  }));

  return {
    id: safeId(),
    calendarEventId: event.id,
    eventTitle: event.title,
    start: event.start,
    end: event.end,
    setId: taskSet.id,
    setTitle: taskSet.title,
    items,
    createdAt: now,
    updatedAt: now,
  };
}

export async function assignExtendedTaskSetToEvent(
  event: CalendarEvent,
  taskSet: ExtendedTaskSetDefinition,
): Promise<ExtendedTaskAssignment> {
  const assignments = await reconcileExtendedTaskAssignments();
  const nextAssignment = createExtendedTaskAssignment(event, taskSet);
  const updated = assignments.filter((assignment) => assignment.calendarEventId !== event.id);
  updated.push(nextAssignment);
  const pruned = pruneStaleExtendedTaskAssignments(updated);
  await setExtendedTaskAssignments(pruned);
  return nextAssignment;
}

export async function removeExtendedTaskAssignment(calendarEventId: string): Promise<void> {
  const assignments = await reconcileExtendedTaskAssignments();
  await setExtendedTaskAssignments(
    assignments.filter((assignment) => assignment.calendarEventId !== calendarEventId),
  );
}

export function pruneStaleExtendedTaskAssignments(
  assignments: ExtendedTaskAssignment[],
  now: number = Date.now(),
): ExtendedTaskAssignment[] {
  const deduped = new Map<string, ExtendedTaskAssignment>();

  for (const assignment of assignments) {
    if (!assignment.calendarEventId) continue;
    if (!assignment.end) continue;
    if (new Date(assignment.end).getTime() + EXTENDED_TASK_ASSIGNMENT_RETENTION_MS <= now) {
      continue;
    }

    const previous = deduped.get(assignment.calendarEventId);
    if (
      previous === undefined ||
      new Date(assignment.updatedAt).getTime() >= new Date(previous.updatedAt).getTime()
    ) {
      deduped.set(assignment.calendarEventId, assignment);
    }
  }

  return [...deduped.values()].sort(
    (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime(),
  );
}

export async function reconcileExtendedTaskAssignments(): Promise<ExtendedTaskAssignment[]> {
  const assignments = await getExtendedTaskAssignments();
  const pruned = pruneStaleExtendedTaskAssignments(assignments);
  if (JSON.stringify(assignments) !== JSON.stringify(pruned)) {
    await setExtendedTaskAssignments(pruned);
  }
  return pruned;
}

export function findExtendedTaskAssignment(
  calendarEventId: string,
  assignments: ExtendedTaskAssignment[],
): ExtendedTaskAssignment | null {
  return assignments.find((assignment) => assignment.calendarEventId === calendarEventId) ?? null;
}

export function getNextIncompleteExtendedTaskItem(
  assignment: ExtendedTaskAssignment | null,
): ExtendedTaskAssignmentItem | null {
  if (!assignment) return null;
  return assignment.items.find((item) => item.completedAt === null) ?? null;
}

export function resolveActiveExtendedTaskAssignment(
  activeEvents: CalendarEvent[],
  assignments: ExtendedTaskAssignment[],
): ExtendedTaskAssignment | null {
  const assignmentByEventId = new Map(
    assignments.map((assignment) => [assignment.calendarEventId, assignment] as const),
  );

  const sortedActiveEvents = [...activeEvents].sort(
    (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime(),
  );

  for (const event of sortedActiveEvents) {
    const assignment = assignmentByEventId.get(event.id);
    if (assignment && getNextIncompleteExtendedTaskItem(assignment)) {
      return assignment;
    }
  }

  return null;
}

export function resolveActiveExtendedTaskLaunchTarget(
  activeEvents: CalendarEvent[],
  assignments: ExtendedTaskAssignment[],
): EventLaunchTarget | null {
  const assignment = resolveActiveExtendedTaskAssignment(activeEvents, assignments);
  const nextItem = getNextIncompleteExtendedTaskItem(assignment);
  if (!assignment || !nextItem) return null;

  const launchUrl = normalizeExtendedTaskUrl(nextItem.url);
  if (launchUrl === null) return null;

  return {
    calendarEventId: assignment.calendarEventId,
    eventTitle: assignment.eventTitle,
    start: assignment.start,
    end: assignment.end,
    launchUrl,
    updatedAt: assignment.updatedAt,
    source: 'extended-task',
    launchKey: `extended:${assignment.calendarEventId}:${nextItem.id}`,
    setId: assignment.setId,
    setTitle: assignment.setTitle,
    itemId: nextItem.id,
    itemLabel: nextItem.label,
  };
}

export function markExtendedTaskAssignmentItemCompleted(
  assignments: ExtendedTaskAssignment[],
  assignmentId: string,
  itemId: string,
  completedAt: string = new Date().toISOString(),
): { assignments: ExtendedTaskAssignment[]; assignment: ExtendedTaskAssignment | null; changed: boolean } {
  let changed = false;
  let nextAssignment: ExtendedTaskAssignment | null = null;

  const updated = assignments.map((assignment) => {
    if (assignment.id !== assignmentId) return assignment;

    const items = assignment.items.map((item) => {
      if (item.id !== itemId || item.completedAt !== null) {
        return item;
      }
      changed = true;
      return {
        ...item,
        completedAt,
      };
    });

    nextAssignment = changed
      ? {
          ...assignment,
          items,
          updatedAt: completedAt,
        }
      : assignment;

    return nextAssignment;
  });

  return {
    assignments: updated,
    assignment: nextAssignment,
    changed,
  };
}

export function markExtendedTaskAssignmentItemIncomplete(
  assignments: ExtendedTaskAssignment[],
  assignmentId: string,
  itemId: string,
  updatedAt: string = new Date().toISOString(),
): { assignments: ExtendedTaskAssignment[]; assignment: ExtendedTaskAssignment | null; changed: boolean } {
  let changed = false;
  let nextAssignment: ExtendedTaskAssignment | null = null;

  const updated = assignments.map((assignment) => {
    if (assignment.id !== assignmentId) return assignment;

    const items = assignment.items.map((item) => {
      if (item.id !== itemId || item.completedAt === null) {
        return item;
      }
      changed = true;
      return {
        ...item,
        completedAt: null,
      };
    });

    nextAssignment = changed
      ? {
          ...assignment,
          items,
          updatedAt,
        }
      : assignment;

    return nextAssignment;
  });

  return {
    assignments: updated,
    assignment: nextAssignment,
    changed,
  };
}
