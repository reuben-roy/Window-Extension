import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Anchor "now" so April 2026 sample events are not pruned by the 7-day retention helpers. */
const FIXED_NOW = new Date('2026-04-22T12:00:00.000Z');
import {
  assignExtendedTaskSetToEvent,
  getNextIncompleteExtendedTaskItem,
  markExtendedTaskAssignmentItemCompleted,
  markExtendedTaskAssignmentItemIncomplete,
} from '../src/shared/extendedTasks';
import { BUILT_IN_EXTENDED_TASK_TEMPLATES } from '../src/shared/extendedTaskLibrary';
import {
  getExtendedTaskAssignments,
  setExtendedTaskSets,
} from '../src/shared/storage';
import type {
  CalendarEvent,
  ExtendedTaskSet,
} from '../src/shared/types';

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    title: 'Late code sprint',
    start: '2026-04-21T16:00:00.000Z',
    end: '2026-04-21T17:00:00.000Z',
    isAllDay: false,
    description: null,
    attendees: [],
    ...overrides,
  };
}

function makeTaskSet(overrides: Partial<ExtendedTaskSet> = {}): ExtendedTaskSet {
  return {
    id: 'set-1',
    title: 'Late code sprint',
    items: [
      { id: 'item-1', label: 'Question 1', url: 'https://leetcode.com/q1' },
      { id: 'item-2', label: 'Question 2', url: 'https://leetcode.com/q2' },
    ],
    createdAt: '2026-04-21T16:00:00.000Z',
    updatedAt: '2026-04-21T16:00:00.000Z',
    archivedAt: null,
    ...overrides,
  };
}

describe('extended task assignments', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    vi.clearAllMocks();
    chrome.storage.sync.clear();
    chrome.storage.local.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('replaces an existing occurrence assignment when a new set is dropped onto the same event', async () => {
    const event = makeEvent();
    const firstSet = makeTaskSet();
    const secondSet = makeTaskSet({
      id: 'set-2',
      title: 'Late code sprint replacement',
      items: [
        { id: 'item-a', label: 'Question A', url: 'https://leetcode.com/qa' },
      ],
    });

    await assignExtendedTaskSetToEvent(event, firstSet);
    await assignExtendedTaskSetToEvent(event, secondSet);

    const assignments = await getExtendedTaskAssignments();
    expect(assignments).toHaveLength(1);
    expect(assignments[0].setId).toBe('set-2');
    expect(assignments[0].setTitle).toBe('Late code sprint replacement');
    expect(assignments[0].items[0].label).toBe('Question A');
    expect(assignments[0].items[0].id).not.toBe('item-a');
  });

  it('keeps occurrence assignments intact when the library set is deleted later', async () => {
    const event = makeEvent();
    const taskSet = makeTaskSet();

    await setExtendedTaskSets([taskSet]);
    const assignment = await assignExtendedTaskSetToEvent(event, taskSet);
    await setExtendedTaskSets([]);

    const assignments = await getExtendedTaskAssignments();
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toEqual(assignment);
    expect(assignments[0].items.map((item) => item.label)).toEqual(['Question 1', 'Question 2']);
  });

  it('advances to the next incomplete item after completion', async () => {
    const event = makeEvent();
    const assignment = await assignExtendedTaskSetToEvent(event, makeTaskSet());

    const updated = markExtendedTaskAssignmentItemCompleted(
      [assignment],
      assignment.id,
      assignment.items[0].id,
      '2026-04-21T16:20:00.000Z',
    );

    expect(updated.changed).toBe(true);
    expect(updated.assignment?.items[0].completedAt).toBe('2026-04-21T16:20:00.000Z');
    expect(getNextIncompleteExtendedTaskItem(updated.assignment ?? null)?.label).toBe('Question 2');
  });

  it('clears completion when marking an item incomplete', async () => {
    const event = makeEvent();
    const assignment = await assignExtendedTaskSetToEvent(event, makeTaskSet());
    const completed = markExtendedTaskAssignmentItemCompleted(
      [assignment],
      assignment.id,
      assignment.items[0].id,
      '2026-04-21T16:20:00.000Z',
    );
    const reverted = markExtendedTaskAssignmentItemIncomplete(
      completed.assignments,
      assignment.id,
      assignment.items[0].id,
    );
    expect(reverted.changed).toBe(true);
    expect(reverted.assignment?.items[0].completedAt).toBeNull();
    expect(getNextIncompleteExtendedTaskItem(reverted.assignment ?? null)?.label).toBe('Question 1');
  });

  it('creates occurrence assignments directly from built-in templates', async () => {
    const event = makeEvent();
    const template = BUILT_IN_EXTENDED_TASK_TEMPLATES.find(
      (candidate) => candidate.id === 'leetcode-stack',
    );

    expect(template).toBeTruthy();

    const assignment = await assignExtendedTaskSetToEvent(event, template!);

    expect(assignment.setId).toBe('leetcode-stack');
    expect(assignment.setTitle).toBe('Stack');
    expect(assignment.items[0]).toMatchObject({
      label: 'Valid Parentheses',
      url: 'https://leetcode.com/problems/valid-parentheses/',
      completedAt: null,
    });
    expect(assignment.items[0].id).not.toBe(template!.items[0].id);
  });
});
