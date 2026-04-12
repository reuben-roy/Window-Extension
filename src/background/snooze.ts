import { ALARM_SNOOZE_END } from '../shared/constants';
import { getSnoozeState, setSnoozeState } from '../shared/storage';
import type { BreakDurationMinutes, SnoozeState } from '../shared/types';
import { clearAllRules } from './blocker';

// ─── Snooze activation ────────────────────────────────────────────────────────

/**
 * Activates a break timer.
 * Clears all blocking rules and schedules the snooze-end alarm.
 */
export async function activateSnooze(
  durationMinutes: BreakDurationMinutes,
): Promise<{ durationMinutes: BreakDurationMinutes }> {
  const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

  const newState: SnoozeState = {
    active: true,
    expiresAt,
    taskId: null,
    snoozesUsed: 0,
    maxSnoozes: 0,
    cooldownSeconds: 0,
    durationMinutes,
  };

  await setSnoozeState(newState);

  await clearAllRules();
  chrome.alarms.create(ALARM_SNOOZE_END, { delayInMinutes: durationMinutes });
  return { durationMinutes };
}

/** Re-enables blocking when the snooze alarm fires. */
export async function deactivateSnooze(): Promise<void> {
  const state = await getSnoozeState();
  await setSnoozeState({ ...state, active: false, expiresAt: null });
}

// ─── Snooze state queries ─────────────────────────────────────────────────────

export async function isSnoozeActive(): Promise<boolean> {
  const state = await getSnoozeState();
  if (!state.active || !state.expiresAt) return false;
  return new Date(state.expiresAt) > new Date();
}

export async function snoozeSecondsRemaining(): Promise<number> {
  const state = await getSnoozeState();
  if (!state.active || !state.expiresAt) return 0;
  const ms = new Date(state.expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 1000));
}
