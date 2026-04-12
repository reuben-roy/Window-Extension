import { describe, expect, it } from 'vitest';
import {
  normalizeEventTitleForColor,
  resolveCalendarEventColors,
} from '../src/shared/calendarColors';

describe('normalizeEventTitleForColor', () => {
  it('groups closely related titles into the same family key', () => {
    expect(normalizeEventTitleForColor('Deep Work')).toBe('deep work');
    expect(normalizeEventTitleForColor('Deep Work 2')).toBe('deep work');
    expect(normalizeEventTitleForColor('Deep Work - Home')).toBe('deep work');
  });

  it('returns an empty key for titles with no usable signal', () => {
    expect(normalizeEventTitleForColor('10:00 PM')).toBe('');
  });
});

describe('resolveCalendarEventColors', () => {
  it('uses the Google palette when colorId resolves', () => {
    const colors = resolveCalendarEventColors('Deep Work', '11', {
      '11': { background: '#616161', foreground: '#ffffff' },
    });

    expect(colors.colorSource).toBe('google-event');
    expect(colors.backgroundColor).toBe('#616161');
    expect(colors.foregroundColor).toBe('#ffffff');
    expect(colors.googleColorId).toBe('11');
  });

  it('derives a stable fallback color for similar titles without a Google color', () => {
    const first = resolveCalendarEventColors('Deep Work', undefined, {});
    const second = resolveCalendarEventColors('Deep Work 2', undefined, {});

    expect(first.colorSource).toBe('derived');
    expect(second.colorSource).toBe('derived');
    expect(second.backgroundColor).toBe(first.backgroundColor);
    expect(second.foregroundColor).toBe(first.foregroundColor);
  });

  it('uses a neutral default when no family key can be derived', () => {
    const colors = resolveCalendarEventColors('10:00 PM', undefined, {});

    expect(colors.colorSource).toBe('default');
    expect(colors.backgroundColor).toBe('#64748b');
    expect(colors.foregroundColor).toBe('#ffffff');
  });

  it('usually differentiates clearly different task families', () => {
    const first = resolveCalendarEventColors('Deep Work', undefined, {});
    const second = resolveCalendarEventColors('Phoenix Run Club', undefined, {});

    expect(first.familyKey).not.toBe(second.familyKey);
    expect(first.backgroundColor).not.toBe(second.backgroundColor);
  });
});
