import {
  ALARM_SNOOZE_END,
  ALARM_TICK,
  ALARM_TICK_PERIOD_MINUTES,
} from '../shared/constants';
import {
  getAssistantOptions,
  getAllTimeStats,
  getBackendSession,
  getBackendSyncState,
  getCalendarState,
  getEventRules,
  getIdeaRecords,
  getKeywordRules,
  getOpenClawState,
  getSettings,
  getSnoozeState,
  getTaskQueue,
  setCalendarState,
  setSettings,
} from '../shared/storage';
import type { CalendarEvent, Message, StateResponse } from '../shared/types';
import {
  cancelOpenClawJob,
  clearAssistantState,
  decideIdea,
  refreshAssistantState,
  retryIdea,
  startOpenClawSession,
  submitIdea,
  syncBackendAuthWithGoogleToken,
  syncBreakTelemetryQueue,
  syncIdeaOutbox,
  updateAssistantPreference,
  reuseOpenClawSession,
} from './backend';
import { fetchCalendarEventsInRange, getAuthToken, revokeAuthToken, syncCalendar } from './calendar';
import { updateBlockingRules } from './blocker';
import { activateSnooze, deactivateSnooze, isSnoozeActive } from './snooze';
import { finalizeTrackedBreakVisits, registerTelemetryListeners } from './telemetry';

// ─── Lifecycle ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_TICK, { periodInMinutes: ALARM_TICK_PERIOD_MINUTES });
  console.log('[Window] Installed — tick alarm scheduled.');
});

// Re-register alarm on service worker wake-up in case it was cleared
chrome.alarms.get(ALARM_TICK, (alarm) => {
  if (!alarm) {
    chrome.alarms.create(ALARM_TICK, { periodInMinutes: ALARM_TICK_PERIOD_MINUTES });
  }
});

registerTelemetryListeners();

// ─── Alarm handler ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_TICK) {
    handleTick().catch(console.error);
  } else if (alarm.name === ALARM_SNOOZE_END) {
    handleSnoozeEnd().catch(console.error);
  }
});

/**
 * Main 60-second tick. Steps execute in the order required by CLAUDE.md:
 *   1. Calendar sync → update CalendarState in storage
 *   2. Carryover expiration check   (Phase 2)
 *   3. Monthly reset check          (Phase 2)
 *   4. Snooze expiry check
 *   5. Recalculate declarativeNetRequest rules
 *   6. Point updates on completion  (Phase 2, event-driven not here)
 */
async function handleTick(): Promise<void> {
  // ── Step 1: calendar sync ─────────────────────────────────────────────────
  const calendarState = await syncCalendar();

  if (calendarState.authError) {
    console.warn('[Window] Calendar sync error:', calendarState.authError);
  }

  // ── Step 2 & 3: carryover expiration + monthly reset ─────────────────────
  // TODO (Phase 2)

  // ── Step 4: snooze expiry ────────────────────────────────────────────────
  const snoozed = await isSnoozeActive();

  // ── Step 5: recalculate blocking rules ────────────────────────────────────
  if (snoozed) {
    // Snooze is still live — rules were already cleared when snooze activated.
    // Don't re-apply blocking until snooze expires.
    await Promise.all([syncIdeaOutbox(), syncBreakTelemetryQueue()]);
    return;
  }

  await Promise.all([syncIdeaOutbox(), syncBreakTelemetryQueue()]);
  await applyBlockingRules(calendarState.isRestricted, calendarState.allowedDomains);
}

async function handleSnoozeEnd(): Promise<void> {
  console.log('[Window] Snooze ended — re-enabling blocking.');
  await finalizeTrackedBreakVisits();
  await syncBreakTelemetryQueue();
  await deactivateSnooze();
  // Re-read calendar state (written on the last tick) and restore blocking rules
  const calendarState = await getCalendarState();
  await applyBlockingRules(calendarState.isRestricted, calendarState.allowedDomains);
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: Message, _sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((err: unknown) => {
        console.error('[Window] Message error:', err);
        sendResponse({ error: String(err) });
      });
    return true; // keep the message port open for async response
  },
);

async function handleMessage(message: Message): Promise<unknown> {
  switch (message.type) {
    case 'GET_STATE':
      return buildStateResponse();

    case 'GET_CALENDAR_EVENTS_RANGE':
      return getCalendarEventsRange(message);

    case 'REFRESH_ASSISTANT_STATE':
      return refreshAssistantState();

    case 'TOGGLE_BLOCKING':
      return toggleBlocking();

    case 'CONNECT_CALENDAR':
      return connectCalendar();

    case 'DISCONNECT_CALENDAR':
      return disconnectCalendar();

    case 'SNOOZE':
      return handleSnooze(message);

    case 'SUBMIT_IDEA':
      return handleIdeaSubmission(message);

    case 'DECIDE_IDEA':
      return handleIdeaDecision(message);

    case 'RETRY_IDEA':
      return handleIdeaRetry(message);

    case 'START_OPENCLAW_SESSION':
      return startOpenClawSession(
        (message.payload as { title?: string } | undefined)?.title,
      );

    case 'REUSE_OPENCLAW_SESSION':
      return reuseOpenClawSession(
        (message.payload as { sessionId?: string } | undefined)?.sessionId ?? '',
      );

    case 'CANCEL_OPENCLAW_JOB':
      return cancelOpenClawJob(
        (message.payload as { jobId?: string } | undefined)?.jobId ?? '',
      );

    case 'UPDATE_ASSISTANT_OPTIONS':
      return updateAssistantPreference(
        (message.payload as Partial<import('../shared/types').AssistantOptions> | undefined) ?? {},
      );

    case 'MARK_DONE':
      // TODO (Phase 2)
      return { ok: true };

    case 'DISMISS_TASK':
      // TODO (Phase 2)
      return { ok: true };

    default:
      return { error: 'Unknown message type' };
  }
}

// ─── Toggle blocking ──────────────────────────────────────────────────────────

async function toggleBlocking(): Promise<{ enableBlocking: boolean }> {
  const settings = await getSettings();
  const enableBlocking = !settings.enableBlocking;

  await setSettings({ ...settings, enableBlocking });

  // Update calendarState.isRestricted to match the new value
  const calendarState = await getCalendarState();
  const updated = {
    ...calendarState,
    isRestricted: enableBlocking && calendarState.activeRuleSource !== 'none',
  };
  await setCalendarState(updated);

  // Apply (or remove) blocking rules immediately without waiting for next tick
  await applyBlockingRules(updated.isRestricted, updated.allowedDomains);

  return { enableBlocking };
}

// ─── State builder (for popup / options / blocked page) ───────────────────────

async function buildStateResponse(): Promise<StateResponse> {
  const [
    settings,
    taskQueue,
    snoozeState,
    allTimeStats,
    calendarState,
    eventRules,
    keywordRules,
    backendSession,
    backendSyncState,
    assistantOptions,
    ideaRecords,
    openClawState,
  ] =
    await Promise.all([
      getSettings(),
      getTaskQueue(),
      getSnoozeState(),
      getAllTimeStats(),
      getCalendarState(),
      getEventRules(),
      getKeywordRules(),
      getBackendSession(),
      getBackendSyncState(),
      getAssistantOptions(),
      getIdeaRecords(),
      getOpenClawState(),
    ]);
  return {
    settings,
    taskQueue,
    snoozeState,
    allTimeStats,
    calendarState,
    eventRules,
    keywordRules,
    backendSession,
    backendSyncState,
    assistantOptions,
    ideaState: {
      items: ideaRecords,
      outboxDepth: ideaRecords.filter((item) => item.remoteId === null || item.status === 'queued' || item.status === 'syncing').length,
      unreadCount: ideaRecords.filter((item) => item.unread).length,
      lastError: ideaRecords.find((item) => item.error)?.error ?? backendSyncState.lastError,
      lastSyncedAt: backendSyncState.lastSyncedAt,
    },
    openClawState,
  };
}

// ─── Calendar connect / disconnect ───────────────────────────────────────────

/**
 * Triggers an interactive OAuth flow. Chrome shows the Google consent popup
 * where the user grants Window access to their calendar.
 *
 * Why interactive=true matters:
 *   chrome.identity.getAuthToken({ interactive: true }) tells Chrome
 *   "pop up a consent window if this user hasn't approved the extension yet."
 *   The alarm-based sync always uses interactive=false (silent) because you
 *   can't pop a browser dialog from a background timer. This handler is the
 *   ONLY place interactive=true is used — it's triggered by the user clicking
 *   "Connect Calendar" in the popup or options page.
 */
async function connectCalendar(): Promise<{ ok: boolean; error?: string }> {
  try {
    await getAuthToken(true); // ← interactive=true: triggers consent popup
    // Token granted — run a full sync immediately so the UI updates
    const calendarState = await syncCalendar();
    await syncBackendAuthWithGoogleToken();
    await refreshAssistantState();
    await applyBlockingRules(calendarState.isRestricted, calendarState.allowedDomains);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Disconnects the user's calendar:
 *   1. Revokes the cached token (Chrome forgets the grant)
 *   2. Clears calendar state to defaults (no events, no profile, no restriction)
 *   3. Removes all blocking rules
 *
 * After this, the alarm tick will fail silently on each cycle (no auth error
 * shown to the user) until they click "Connect Calendar" again.
 */
async function disconnectCalendar(): Promise<{ ok: boolean }> {
  try {
    const token = await getAuthToken(false);
    await revokeAuthToken(token);
  } catch {
    // Token may already be gone — that's fine, keep going
  }

  // Reset calendar state to disconnected defaults
  const disconnected: import('../shared/types').CalendarState = {
    currentEvent: null,
    allActiveEvents: [],
    todaysEvents: [],
    activeProfile: null,
    activeRuleSource: 'none',
    activeRuleName: null,
    allowedDomains: [],
    recentEventTitles: [],
    isRestricted: false,
    lastSyncedAt: null,
    authError: null,
  };
  await setCalendarState(disconnected);
  await clearAssistantState();
  await applyBlockingRules(false, []);
  return { ok: true };
}

// ─── Snooze handler ──────────────────────────────────────────────────────────

async function handleSnooze(message: Message): Promise<{ ok: boolean; error?: string }> {
  const payload = message.payload as { durationMinutes?: 5 | 10 | 15 } | undefined;
  const settings = await getSettings();
  const durationMinutes = payload?.durationMinutes ?? settings.breakDurationMinutes;
  const result = await activateSnooze(durationMinutes);
  return { ok: true, ...result };
}

async function handleIdeaSubmission(
  message: Message,
): Promise<{ ok: boolean; state?: Awaited<ReturnType<typeof refreshAssistantState>>; error?: string }> {
  const prompt = (message.payload as { prompt?: string } | undefined)?.prompt?.trim() ?? '';
  if (!prompt) {
    return { ok: false, error: 'Idea capture cannot be empty.' };
  }

  try {
    const state = await submitIdea(prompt);
    return { ok: true, state };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function handleIdeaDecision(
  message: Message,
): Promise<{ ok: boolean; state?: Awaited<ReturnType<typeof refreshAssistantState>>; error?: string }> {
  const payload = message.payload as { localId?: string; decision?: import('../shared/types').IdeaDecision } | undefined;
  if (!payload?.localId || !payload.decision) {
    return { ok: false, error: 'Missing idea decision payload.' };
  }

  try {
    const state = await decideIdea(payload.localId, payload.decision);
    return { ok: true, state };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function handleIdeaRetry(
  message: Message,
): Promise<{ ok: boolean; state?: Awaited<ReturnType<typeof refreshAssistantState>>; error?: string }> {
  const localId = (message.payload as { localId?: string } | undefined)?.localId;
  if (!localId) {
    return { ok: false, error: 'Missing idea retry payload.' };
  }

  try {
    const state = await retryIdea(localId);
    return { ok: true, state };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function getCalendarEventsRange(
  message: Message,
): Promise<{ ok: boolean; events: CalendarEvent[]; error?: string }> {
  const payload = message.payload as { start?: string; end?: string } | undefined;
  if (!payload?.start || !payload?.end) {
    return { ok: false, events: [], error: 'Missing range start/end.' };
  }

  try {
    const token = await getAuthToken(false);
    const events = await fetchCalendarEventsInRange(token, payload.start, payload.end);
    return { ok: true, events };
  } catch (err) {
    return { ok: false, events: [], error: String(err) };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function applyBlockingRules(
  isRestricted: boolean,
  allowedDomains: string[],
): Promise<void> {
  await updateBlockingRules(allowedDomains, isRestricted);
}
