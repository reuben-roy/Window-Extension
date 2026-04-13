import type { Settings } from './types';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseBlockingPauseStartTime(value: string): { hours: number; minutes: number } | null {
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;

  return {
    hours: Number(match[1]),
    minutes: Number(match[2]),
  };
}

export function isDailyBlockingPauseActive(
  date: Date,
  settings: Pick<Settings, 'dailyBlockingPauseEnabled' | 'dailyBlockingPauseStartTime'>,
): boolean {
  if (!settings.dailyBlockingPauseEnabled) return false;

  const parsed = parseBlockingPauseStartTime(settings.dailyBlockingPauseStartTime);
  if (!parsed) return false;

  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  const pauseStartMinutes = parsed.hours * 60 + parsed.minutes;
  return currentMinutes >= pauseStartMinutes;
}

export function formatBlockingPauseTimeLabel(value: string): string {
  const parsed = parseBlockingPauseStartTime(value);
  if (!parsed) return value;

  const sample = new Date(2000, 0, 1, parsed.hours, parsed.minutes);
  return sample.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}
