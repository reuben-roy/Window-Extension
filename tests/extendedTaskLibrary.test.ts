import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_EXTENDED_TASK_TEMPLATES,
  decodeExtendedTaskLibraryEntryDragPayload,
  duplicateExtendedTaskTemplate,
  encodeExtendedTaskLibraryEntryDragPayload,
  resolveDraggedExtendedTaskLibraryEntry,
  toExtendedTaskLibraryEntry,
} from '../src/shared/extendedTaskLibrary';
import type { ExtendedTaskSet } from '../src/shared/types';

function makeUserTaskSet(overrides: Partial<ExtendedTaskSet> = {}): ExtendedTaskSet {
  return {
    id: 'user-set-1',
    title: 'Custom Sprint',
    items: [
      { id: 'user-item-1', label: 'Warmup', url: 'https://leetcode.com/problems/two-sum/' },
    ],
    createdAt: '2026-04-22T10:00:00.000Z',
    updatedAt: '2026-04-22T10:00:00.000Z',
    archivedAt: null,
    ...overrides,
  };
}

describe('extended task library templates', () => {
  it('includes the master card and every seeded roadmap category', () => {
    expect(BUILT_IN_EXTENDED_TASK_TEMPLATES.map((template) => template.id)).toEqual([
      'neetcode-150-master',
      'neetcode-arrays-hashing',
      'neetcode-two-pointers',
      'neetcode-sliding-window',
      'neetcode-stack',
      'neetcode-binary-search',
      'neetcode-linked-list',
      'neetcode-trees',
      'neetcode-tries',
      'neetcode-heap-priority-queue',
      'neetcode-backtracking',
      'neetcode-graphs',
      'neetcode-advanced-graphs',
      'neetcode-1d-dp',
      'neetcode-2d-dp',
      'neetcode-greedy',
      'neetcode-intervals',
      'neetcode-math-geometry',
      'neetcode-bit-manipulation',
    ]);
  });

  it('builds the NeetCode 150 master card in roadmap order with category-prefixed labels', () => {
    const masterTemplate = BUILT_IN_EXTENDED_TASK_TEMPLATES[0];

    expect(masterTemplate.title).toBe('NeetCode 150');
    expect(masterTemplate.items).toHaveLength(150);
    expect(masterTemplate.items[0]).toMatchObject({
      label: 'Arrays & Hashing · Contains Duplicate',
      url: 'https://leetcode.com/problems/contains-duplicate/',
    });
    expect(masterTemplate.items[9]).toMatchObject({
      label: 'Two Pointers · Valid Palindrome',
      url: 'https://leetcode.com/problems/valid-palindrome/',
    });
    expect(masterTemplate.items[20]).toMatchObject({
      label: 'Stack · Valid Parentheses',
      url: 'https://leetcode.com/problems/valid-parentheses/',
    });
  });

  it('duplicates a built-in template into an editable synced task set without mutating the original', () => {
    const arraysTemplate = BUILT_IN_EXTENDED_TASK_TEMPLATES.find(
      (template) => template.id === 'neetcode-arrays-hashing',
    );
    expect(arraysTemplate).toBeTruthy();

    const duplicate = duplicateExtendedTaskTemplate(
      arraysTemplate!,
      '2026-04-22T10:15:00.000Z',
    );

    expect(duplicate.id).not.toBe(arraysTemplate!.id);
    expect(duplicate.title).toBe('Arrays & Hashing Copy');
    expect(duplicate.createdAt).toBe('2026-04-22T10:15:00.000Z');
    expect(duplicate.updatedAt).toBe('2026-04-22T10:15:00.000Z');
    expect(duplicate.items[0]).toMatchObject({
      label: 'Contains Duplicate',
      url: 'https://leetcode.com/problems/contains-duplicate/',
    });
    expect(duplicate.items[0].id).not.toBe(arraysTemplate!.items[0].id);
    expect(arraysTemplate!.title).toBe('Arrays & Hashing');
  });
});

describe('extended task drag payload helpers', () => {
  it('encodes and decodes entry identity for drag/drop', () => {
    const arraysTemplate = BUILT_IN_EXTENDED_TASK_TEMPLATES.find(
      (template) => template.id === 'neetcode-arrays-hashing',
    );
    expect(arraysTemplate).toBeTruthy();

    const payload = encodeExtendedTaskLibraryEntryDragPayload(arraysTemplate!);
    expect(decodeExtendedTaskLibraryEntryDragPayload(payload)).toEqual({
      entryId: 'neetcode-arrays-hashing',
      source: 'built-in',
    });
  });

  it('resolves the current drag entry before falling back to plain-text or custom payloads', () => {
    const userTaskSet = makeUserTaskSet();
    const userEntry = toExtendedTaskLibraryEntry(userTaskSet);
    const builtInPayload = encodeExtendedTaskLibraryEntryDragPayload(BUILT_IN_EXTENDED_TASK_TEMPLATES[0]);

    expect(
      resolveDraggedExtendedTaskLibraryEntry({
        draggingEntry: userEntry,
        plainTextPayload: builtInPayload,
        customPayload: builtInPayload,
        builtInTemplates: BUILT_IN_EXTENDED_TASK_TEMPLATES,
        taskSets: [userTaskSet],
      }),
    ).toMatchObject({
      id: 'user-set-1',
      source: 'user',
    });

    expect(
      resolveDraggedExtendedTaskLibraryEntry({
        draggingEntry: null,
        plainTextPayload: builtInPayload,
        customPayload: null,
        builtInTemplates: BUILT_IN_EXTENDED_TASK_TEMPLATES,
        taskSets: [userTaskSet],
      }),
    ).toMatchObject({
      id: 'neetcode-150-master',
      source: 'built-in',
    });
  });
});
