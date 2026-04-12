import { describe, expect, it } from 'vitest';
import {
  applyIdeaDecision,
  createIdeaRecord,
  deriveIdeaState,
  finalizeBreakVisits,
  parseDomainFromUrl,
  upsertBreakVisit,
} from '../src/shared/assistant';
import { DEFAULT_OPENCLAW_STATE } from '../src/shared/constants';

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
