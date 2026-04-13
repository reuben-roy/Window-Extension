import { describe, expect, it } from 'vitest';
import {
  formatBlockingPauseTimeLabel,
  isDailyBlockingPauseActive,
  parseBlockingPauseStartTime,
} from '../src/shared/blockingSchedule';

describe('blocking schedule helpers', () => {
  it('parses 24-hour time strings', () => {
    expect(parseBlockingPauseStartTime('22:15')).toEqual({ hours: 22, minutes: 15 });
    expect(parseBlockingPauseStartTime('bad')).toBeNull();
  });

  it('detects whether the daily blocking pause is active', () => {
    const settings = {
      dailyBlockingPauseEnabled: true,
      dailyBlockingPauseStartTime: '22:00',
    };

    expect(isDailyBlockingPauseActive(new Date('2026-04-12T21:59:00'), settings)).toBe(false);
    expect(isDailyBlockingPauseActive(new Date('2026-04-12T22:00:00'), settings)).toBe(true);
  });

  it('formats the pause time label for the UI', () => {
    expect(formatBlockingPauseTimeLabel('22:00')).toMatch(/10:00/);
  });
});
