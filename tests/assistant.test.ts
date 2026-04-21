import { describe, expect, it } from 'vitest';
import {
  applyIdeaDecision,
  createIdeaRecord,
  deriveIdeaState,
  finalizeBreakVisits,
  parseDomainFromUrl,
  shouldNotifyAboutAssistantTask,
  upsertBreakVisit,
} from '../src/shared/assistant';
import { DEFAULT_OPENCLAW_STATE } from '../src/shared/constants';
import type { AssistantTaskRecord } from '../src/shared/types';

describe('idea helpers', () => {
  it('creates queued idea records', () => {
    const record = createIdeaRecord('Build a browser startup assistant');
    expect(record.prompt).toBe('Build a browser startup assistant');
    expect(record.status).toBe('queued');
    expect(record.remoteId).toBeNull();
  });

  it('derives unread and outbox counts from idea records', () => {
    const first = {
      ...createIdeaRecord('Idea one'),
      createdAt: '2026-04-11T10:00:00.000Z',
      updatedAt: '2026-04-11T10:00:00.000Z',
    };
    const second = {
      ...createIdeaRecord('Idea two'),
      remoteId: 'idea-2',
      status: 'completed' as const,
      unread: true,
      createdAt: '2026-04-11T10:05:00.000Z',
      updatedAt: '2026-04-11T10:05:00.000Z',
    };

    const state = deriveIdeaState([first, second], DEFAULT_OPENCLAW_STATE);
    expect(state.outboxDepth).toBe(1);
    expect(state.unreadCount).toBe(1);
    expect(state.items[0]?.prompt).toBe('Idea two');
  });

  it('applies keep and discard decisions locally', () => {
    const kept = applyIdeaDecision(createIdeaRecord('Keep me'), 'keep');
    expect(kept.status).toBe('kept');
    expect(kept.saved).toBe(true);

    const discarded = applyIdeaDecision(createIdeaRecord('Discard me'), 'discard');
    expect(discarded.status).toBe('discarded');
    expect(discarded.archived).toBe(true);
  });
});

describe('telemetry helpers', () => {
  it('parses domains only from http(s) URLs', () => {
    expect(parseDomainFromUrl('https://github.com/openai')).toBe('github.com');
    expect(parseDomainFromUrl('chrome://extensions')).toBeNull();
  });

  it('finalizes the previous visit when a tab changes domains', () => {
    const first = upsertBreakVisit({}, 42, 'github.com', 'Deep Work', '2026-04-11T10:00:00.000Z');
    const second = upsertBreakVisit(first.nextVisits, 42, 'news.ycombinator.com', 'Deep Work', '2026-04-11T10:05:00.000Z');
    expect(second.finalizedVisit?.domain).toBe('github.com');
    expect(second.nextVisits['42']?.domain).toBe('news.ycombinator.com');
  });

  it('finalizes all active visits on break end', () => {
    const seeded = upsertBreakVisit({}, 7, 'github.com', 'Deep Work', '2026-04-11T10:00:00.000Z');
    const finalized = finalizeBreakVisits(seeded.nextVisits, '2026-04-11T10:15:00.000Z');
    expect(finalized).toHaveLength(1);
    expect(finalized[0]?.endedAt).toBe('2026-04-11T10:15:00.000Z');
  });
});

describe('assistant task notifications', () => {
  function buildTask(overrides: Partial<AssistantTaskRecord> = {}): AssistantTaskRecord {
    return {
      id: 'task-1',
      connectorId: 'connector-1',
      title: 'Research billing API',
      prompt: 'Research billing API options',
      status: 'completed',
      createdAt: '2026-04-21T10:00:00.000Z',
      updatedAt: '2026-04-21T10:05:00.000Z',
      completedAt: '2026-04-21T10:05:00.000Z',
      error: null,
      sessionId: 'session-1',
      jobId: 'job-1',
      unread: true,
      notificationMode: 'after_focus',
      focusContextType: 'none',
      focusContextId: null,
      notifiedAt: null,
      result: {
        summary: 'Done',
        output: 'Completed successfully.',
        completedAt: '2026-04-21T10:05:00.000Z',
      },
      ...overrides,
    };
  }

  it('notifies immediately when mode is immediate', () => {
    expect(
      shouldNotifyAboutAssistantTask(buildTask({ notificationMode: 'immediate' }), {
        currentWindowTaskId: 'task-queue-1',
        currentCalendarEventId: 'event-1',
      }),
    ).toBe(true);
  });

  it('suppresses browser notifications in inbox-only mode', () => {
    expect(
      shouldNotifyAboutAssistantTask(buildTask({ notificationMode: 'inbox_only' }), {
        currentWindowTaskId: null,
        currentCalendarEventId: null,
      }),
    ).toBe(false);
  });

  it('waits while the linked window task is still active', () => {
    expect(
      shouldNotifyAboutAssistantTask(
        buildTask({
          focusContextType: 'window_task',
          focusContextId: 'window-task-1',
        }),
        {
          currentWindowTaskId: 'window-task-1',
          currentCalendarEventId: null,
        },
      ),
    ).toBe(false);
  });

  it('waits while the linked calendar event is still active', () => {
    expect(
      shouldNotifyAboutAssistantTask(
        buildTask({
          focusContextType: 'calendar_event',
          focusContextId: 'calendar-event-1',
        }),
        {
          currentWindowTaskId: null,
          currentCalendarEventId: 'calendar-event-1',
        },
      ),
    ).toBe(false);
  });

  it('releases after-focus notifications once the linked context clears', () => {
    expect(
      shouldNotifyAboutAssistantTask(
        buildTask({
          focusContextType: 'calendar_event',
          focusContextId: 'calendar-event-1',
        }),
        {
          currentWindowTaskId: null,
          currentCalendarEventId: null,
        },
      ),
    ).toBe(true);
  });
});
