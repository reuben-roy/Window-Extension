import {
  ALARM_SNOOZE_END,
  ALARM_TICK,
  ALARM_TICK_PERIOD_MINUTES,
  BLOCKED_PAGE_EXTENSION_PATH,
  SIDE_PANEL_EXTENSION_PATH,
  TEMP_UNLOCK_BASE_COST,
  TEMP_UNLOCK_DURATION_MINUTES,
  TEMP_UNLOCK_INCREMENT,
  TEMP_UNLOCK_RULE_ID_START,
} from '../shared/constants';
import {
  getAssistantOptions,
  getAllTimeStats,
  getBackendSession,
  getBackendSyncState,
  getBlockedTabs,
  getCalendarState,
  getEventRules,
  getGlobalAllowlist,
  getIdeaRecords,
  getKeywordRules,
  getOpenClawState,
  getPointsHistory,
  getWeekKey,
  getSettings,
  getSnoozeState,
  getTaskQueue,
  getTemporaryUnlocks,
  getUnlockSpendState,
  setAllTimeStats,
  setBlockedTabs,
  setCalendarState,
  setPointsHistory,
  setSettings,
  setTemporaryUnlocks,
  setUnlockSpendState,
} from '../shared/storage';
import type {
  BlockedTabState,
  CalendarEvent,
  CalendarState,
  Message,
  StateResponse,
  Task,
  TemporaryUnlockState,
} from '../shared/types';
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
import {
  fetchCalendarEventsInRange,
  getAuthToken,
  resolveActiveState,
  revokeAuthToken,
  syncCalendar,
} from './calendar';
import {
  isDomainAllowed,
  syncTemporaryUnlockRules,
  updateBlockingRules,
} from './blocker';
import { applyPointsToStats } from './levels';
import { ensureDemoStatsSeeded } from './demoSeed';
import { calculatePoints } from './points';
import { activateSnooze, deactivateSnooze, isSnoozeActive } from './snooze';
import { finalizeTrackedBreakVisits, registerTelemetryListeners } from './telemetry';
import { markTaskCompleted, syncTasksFromCalendarState } from './taskQueue';

const pendingNavigationByTab = new Map<number, string>();

// ─── Lifecycle ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_TICK, { periodInMinutes: ALARM_TICK_PERIOD_MINUTES });
  void ensureDemoStatsSeeded();
  void syncActionSurfaceBehavior();
  console.log('[Window] Installed — tick alarm scheduled.');
});

chrome.alarms.get(ALARM_TICK, (alarm) => {
  if (!alarm) {
    chrome.alarms.create(ALARM_TICK, { periodInMinutes: ALARM_TICK_PERIOD_MINUTES });
  }
});

registerTelemetryListeners();
registerBlockingListeners();
void ensureDemoStatsSeeded();
void syncActionSurfaceBehavior();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && ('settings' in changes || 'eventRules' in changes || 'keywordRules' in changes || 'globalAllowlist' in changes)) {
    void reconcileBlockingState();
  }

  if (areaName === 'sync' && 'settings' in changes) {
    void syncActionSurfaceBehavior();
  }
});

// ─── Alarm handler ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_TICK) {
    handleTick().catch(console.error);
  } else if (alarm.name === ALARM_SNOOZE_END) {
    handleSnoozeEnd().catch(console.error);
  }
});

async function handleTick(): Promise<void> {
  const calendarState = await syncCalendar();

  if (calendarState.authError) {
    console.warn('[Window] Calendar sync error:', calendarState.authError);
  }

  await syncTasksFromCalendarState(calendarState);
  await cleanupExpiredTemporaryUnlocks(calendarState);

  const snoozed = await isSnoozeActive();
  if (snoozed) {
    await Promise.all([syncIdeaOutbox(), syncBreakTelemetryQueue()]);
    await reconcileBlockedTabs(calendarState);
    return;
  }

  await Promise.all([syncIdeaOutbox(), syncBreakTelemetryQueue()]);
  await applyBlockingState(calendarState);
}

async function handleSnoozeEnd(): Promise<void> {
  console.log('[Window] Snooze ended — re-enabling blocking.');
  await finalizeTrackedBreakVisits();
  await syncBreakTelemetryQueue();
  await deactivateSnooze();
  await reconcileBlockingState();
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err: unknown) => {
      console.error('[Window] Message error:', err);
      sendResponse({ error: String(err) });
    });
  return true;
});

async function handleMessage(
  message: Message,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case 'GET_STATE':
      return buildStateResponse();

    case 'GET_BLOCKED_TAB_CONTEXT':
      return getBlockedTabContext(sender, message);

    case 'GET_CALENDAR_EVENTS_RANGE':
      return getCalendarEventsRange(message);

    case 'REFRESH_ASSISTANT_STATE':
      return refreshAssistantState();

    case 'TOGGLE_BLOCKING':
      return toggleBlocking(message);

    case 'TOGGLE_PERSISTENT_PANEL':
      return togglePersistentPanel(message, sender);

    case 'CONNECT_CALENDAR':
      return connectCalendar();

    case 'DISCONNECT_CALENDAR':
      return disconnectCalendar();

    case 'SNOOZE':
      return handleSnooze(message);

    case 'SPEND_POINTS_UNLOCK':
      return spendPointsForTemporaryUnlock(sender, message);

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
      return handleMarkDone(message);

    case 'DISMISS_TASK':
      return { ok: true };

    default:
      return { error: 'Unknown message type' };
  }
}

// ─── State builder ────────────────────────────────────────────────────────────

async function buildStateResponse(): Promise<StateResponse> {
  await ensureDemoStatsSeeded();

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
  ] = await Promise.all([
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

async function connectCalendar(): Promise<{ ok: boolean; error?: string }> {
  try {
    await getAuthToken(true);
    const calendarState = await syncCalendar();
    await syncTasksFromCalendarState(calendarState);
    await syncBackendAuthWithGoogleToken();
    await refreshAssistantState();
    await applyBlockingState(calendarState);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function disconnectCalendar(): Promise<{ ok: boolean }> {
  try {
    const token = await getAuthToken(false);
    await revokeAuthToken(token);
  } catch {
    // Token may already be gone.
  }

  const disconnected: CalendarState = {
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

  await Promise.all([
    setCalendarState(disconnected),
    setBlockedTabs({}),
    setTemporaryUnlocks({}),
    clearAssistantState(),
    updateBlockingRules([], false),
    syncTemporaryUnlockRules({}),
  ]);

  return { ok: true };
}

// ─── Blocking toggles and reconciliation ─────────────────────────────────────

async function toggleBlocking(message?: Message): Promise<{ enableBlocking: boolean }> {
  const settings = await getSettings();
  const requested = (message?.payload as { enabled?: boolean } | undefined)?.enabled;
  const enableBlocking = typeof requested === 'boolean'
    ? requested
    : !settings.enableBlocking;
  await setSettings({ ...settings, enableBlocking });
  await reconcileBlockingState();
  return { enableBlocking };
}

async function togglePersistentPanel(
  message: Message,
  sender: chrome.runtime.MessageSender,
): Promise<{ ok: boolean; enabled: boolean }> {
  const payload = message.payload as { enabled?: boolean } | undefined;
  const settings = await getSettings();
  const enabled = payload?.enabled ?? !settings.persistentPanelEnabled;
  await setSettings({ ...settings, persistentPanelEnabled: enabled });
  await syncActionSurfaceBehavior();

  if (enabled && sender.tab?.id) {
    await chrome.sidePanel.open({ tabId: sender.tab.id });
  }

  return { ok: true, enabled };
}

async function reconcileBlockingState(): Promise<void> {
  const [
    settings,
    calendarState,
    eventRules,
    keywordRules,
    globalAllowlist,
    snoozed,
  ] = await Promise.all([
    getSettings(),
    getCalendarState(),
    getEventRules(),
    getKeywordRules(),
    getGlobalAllowlist(),
    isSnoozeActive(),
  ]);

  const recalculated = resolveActiveState(
    calendarState.todaysEvents,
    eventRules,
    keywordRules,
    globalAllowlist,
    settings,
  );

  const nextCalendarState: CalendarState = {
    ...recalculated,
    lastSyncedAt: calendarState.lastSyncedAt,
    authError: calendarState.authError,
  };

  await setCalendarState(nextCalendarState);
  await syncTasksFromCalendarState(nextCalendarState);
  await cleanupExpiredTemporaryUnlocks(nextCalendarState);

  if (!snoozed) {
    await applyBlockingState(nextCalendarState);
  } else {
    await reconcileBlockedTabs(nextCalendarState);
  }
}

async function applyBlockingState(calendarState: CalendarState): Promise<void> {
  const [settings, unlocks] = await Promise.all([
    getSettings(),
    getTemporaryUnlocks(),
  ]);

  await updateBlockingRules(
    calendarState.allowedDomains,
    settings.enableBlocking && calendarState.isRestricted,
  );
  await syncTemporaryUnlockRules(unlocks);
  await reconcileBlockedTabs(calendarState, unlocks);
}

// ─── Blocked page + unlock handling ──────────────────────────────────────────

export function resolveRequestedTabId(
  sender: chrome.runtime.MessageSender,
  payload?: { tabId?: number },
): number | null {
  if (typeof payload?.tabId === 'number' && payload.tabId >= 0) {
    return payload.tabId;
  }

  return sender.tab?.id ?? null;
}

export async function getBlockedTabContext(
  sender: chrome.runtime.MessageSender,
  message?: Message,
): Promise<{
  ok: boolean;
  blockedTab: BlockedTabState | null;
  unlock: TemporaryUnlockState | null;
  nextUnlockCost: number;
  canSpend: boolean;
  error?: string;
}> {
  const tabId = resolveRequestedTabId(
    sender,
    (message?.payload as { tabId?: number } | undefined) ?? undefined,
  );
  if (tabId === null) {
    return {
      ok: false,
      blockedTab: null,
      unlock: null,
      nextUnlockCost: TEMP_UNLOCK_BASE_COST,
      canSpend: false,
      error: 'Blocked tab context is unavailable for this page.',
    };
  }

  const [blockedTabs, unlocks, calendarState, allTimeStats] = await Promise.all([
    getBlockedTabs(),
    getTemporaryUnlocks(),
    getCalendarState(),
    getAllTimeStats(),
  ]);
  const nextUnlockCost = await getNextUnlockCost(calendarState, blockedTabs[String(tabId)] ?? null);
  const blockedTab = blockedTabs[String(tabId)] ?? null;
  const activeUnlock = blockedTab
    ? findMatchingUnlockForHost(blockedTab.blockedHost, unlocks)
    : null;

  return {
    ok: true,
    blockedTab,
    unlock: activeUnlock,
    nextUnlockCost,
    canSpend: allTimeStats.totalPoints >= nextUnlockCost,
  };
}

export async function spendPointsForTemporaryUnlock(
  sender: chrome.runtime.MessageSender,
  message?: Message,
): Promise<{
  ok: boolean;
  error?: string;
  cost?: number;
  redirectUrl?: string;
  remainingPoints?: number;
}> {
  const tabId = resolveRequestedTabId(
    sender,
    (message?.payload as { tabId?: number } | undefined) ?? undefined,
  );
  if (tabId === null) {
    return { ok: false, error: 'Blocked tab not found.' };
  }

  const [blockedTabs, unlocks, calendarState, allTimeStats] = await Promise.all([
    getBlockedTabs(),
    getTemporaryUnlocks(),
    getCalendarState(),
    getAllTimeStats(),
  ]);

  const blockedTab = blockedTabs[String(tabId)];
  if (!blockedTab) {
    return { ok: false, error: 'There is no blocked site to unlock in this tab.' };
  }

  const existingUnlock = findMatchingUnlockForHost(blockedTab.blockedHost, unlocks);
  if (existingUnlock) {
    return {
      ok: true,
      cost: 0,
      redirectUrl: blockedTab.originalUrl,
      remainingPoints: allTimeStats.totalPoints,
    };
  }

  const cost = await getNextUnlockCost(calendarState, blockedTab);
  if (allTimeStats.totalPoints < cost) {
    return { ok: false, error: `You need ${cost} points for a temporary unlock.` };
  }

  const updatedStats = await applyPointDelta(-cost, { completedTasksDelta: 0 });

  const activeEventKey = getActiveEventKey(calendarState, blockedTab);
  const spendState = await getUnlockSpendState();
  const nextSpendCount = spendState.activeEventKey === activeEventKey ? spendState.spendCount + 1 : 1;
  await setUnlockSpendState({
    activeEventKey,
    spendCount: nextSpendCount,
  });

  const unlock: TemporaryUnlockState = {
    tabId,
    blockedHost: blockedTab.blockedHost,
    originalUrl: blockedTab.originalUrl,
    expiresAt: new Date(Date.now() + TEMP_UNLOCK_DURATION_MINUTES * 60_000).toISOString(),
    ruleId: createTemporaryUnlockRuleId(blockedTab.blockedHost),
    activeEventId: blockedTab.activeEventId,
    activeEventTitle: blockedTab.activeEventTitle,
  };

  const nextUnlocks = {
    ...unlocks,
    [normalizeUnlockKey(blockedTab.blockedHost)]: unlock,
  };
  const nextBlockedTabs = { ...blockedTabs };
  delete nextBlockedTabs[String(tabId)];

  await Promise.all([
    setTemporaryUnlocks(nextUnlocks),
    setBlockedTabs(nextBlockedTabs),
    syncTemporaryUnlockRules(nextUnlocks),
  ]);

  return {
    ok: true,
    cost,
    redirectUrl: blockedTab.originalUrl,
    remainingPoints: updatedStats.totalPoints,
  };
}

async function cleanupExpiredTemporaryUnlocks(
  calendarState: CalendarState,
): Promise<void> {
  const unlocks = await getTemporaryUnlocks();
  const now = Date.now();
  const activeUnlocks: Record<string, TemporaryUnlockState> = {};
  const expiredUnlocks: TemporaryUnlockState[] = [];

  for (const [key, unlock] of Object.entries(unlocks)) {
    if (new Date(unlock.expiresAt).getTime() > now) {
      activeUnlocks[key] = unlock;
    } else {
      expiredUnlocks.push(unlock);
    }
  }

  if (expiredUnlocks.length === 0) return;

  await Promise.all([
    setTemporaryUnlocks(activeUnlocks),
    syncTemporaryUnlockRules(activeUnlocks),
  ]);

  const settings = await getSettings();
  const tabs = await chrome.tabs.query({});

  for (const unlock of expiredUnlocks) {
    for (const tab of tabs) {
      try {
        if (!tab.id || !tab.url || !isHttpUrl(tab.url)) continue;
        const host = new URL(tab.url).hostname;
        if (
          host !== unlock.blockedHost &&
          !host.endsWith(`.${unlock.blockedHost}`)
        ) {
          continue;
        }

        const stillAllowed =
          !settings.enableBlocking ||
          !calendarState.isRestricted ||
          isDomainAllowed(host, calendarState.allowedDomains);
        if (!stillAllowed) {
          await chrome.tabs.reload(tab.id);
        }
      } catch {
        // Ignore tabs that disappeared.
      }
    }
  }
}

async function reconcileBlockedTabs(
  calendarState: CalendarState,
  unlocksInput?: Record<string, TemporaryUnlockState>,
): Promise<void> {
  const [settings, blockedTabs, unlocks] = await Promise.all([
    getSettings(),
    getBlockedTabs(),
    unlocksInput ? Promise.resolve(unlocksInput) : getTemporaryUnlocks(),
  ]);

  const nextBlockedTabs = { ...blockedTabs };

  for (const blockedTab of Object.values(blockedTabs)) {
    const allowed = isUrlReachableNow(
      blockedTab.originalUrl,
      blockedTab.tabId,
      calendarState,
      settings,
      unlocks,
    );

    if (!allowed) continue;

    try {
      await chrome.tabs.update(blockedTab.tabId, { url: blockedTab.originalUrl });
      delete nextBlockedTabs[String(blockedTab.tabId)];
    } catch {
      delete nextBlockedTabs[String(blockedTab.tabId)];
    }
  }

  await setBlockedTabs(nextBlockedTabs);
}

function registerBlockingListeners(): void {
  chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId !== 0) return;
    if (!isHttpUrl(details.url)) return;
    pendingNavigationByTab.set(details.tabId, details.url);
  });

  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return;

    if (isBlockedPageUrl(details.url)) {
      const originalUrl = pendingNavigationByTab.get(details.tabId);
      if (originalUrl) {
        void rememberBlockedTab(details.tabId, originalUrl);
      }
      return;
    }

    if (isHttpUrl(details.url)) {
      pendingNavigationByTab.set(details.tabId, details.url);
      void clearBlockedTab(details.tabId);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    pendingNavigationByTab.delete(tabId);
    void clearBlockedTab(tabId);
  });
}

async function rememberBlockedTab(tabId: number, originalUrl: string): Promise<void> {
  if (!isHttpUrl(originalUrl)) return;

  const calendarState = await getCalendarState();
  const blockedTabs = await getBlockedTabs();
  const blockedHost = new URL(originalUrl).hostname;

  blockedTabs[String(tabId)] = {
    tabId,
    originalUrl,
    blockedHost,
    activeEventId: calendarState.currentEvent?.id ?? null,
    activeEventTitle: calendarState.currentEvent?.title ?? null,
    blockedAt: new Date().toISOString(),
  };

  await setBlockedTabs(blockedTabs);
}

async function clearBlockedTab(tabId: number): Promise<void> {
  const blockedTabs = await getBlockedTabs();
  if (!(String(tabId) in blockedTabs)) return;
  const nextBlockedTabs = { ...blockedTabs };
  delete nextBlockedTabs[String(tabId)];
  await setBlockedTabs(nextBlockedTabs);
}

function isBlockedPageUrl(url: string): boolean {
  return url.startsWith(chrome.runtime.getURL(BLOCKED_PAGE_EXTENSION_PATH));
}

function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

function normalizeUnlockKey(blockedHost: string): string {
  return blockedHost.trim().toLowerCase();
}

function createTemporaryUnlockRuleId(blockedHost: string): number {
  const key = normalizeUnlockKey(blockedHost);
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }

  return TEMP_UNLOCK_RULE_ID_START + (Math.abs(hash) % 900_000);
}

function findMatchingUnlockForHost(
  host: string,
  unlocks: Record<string, TemporaryUnlockState>,
): TemporaryUnlockState | null {
  const lowerHost = host.toLowerCase();

  const match = Object.values(unlocks)
    .filter((unlock) => {
      const unlockHost = unlock.blockedHost.toLowerCase();
      return (
        new Date(unlock.expiresAt).getTime() > Date.now() &&
        (lowerHost === unlockHost || lowerHost.endsWith(`.${unlockHost}`))
      );
    })
    .sort((a, b) => b.blockedHost.length - a.blockedHost.length)[0];

  return match ?? null;
}

function isUrlReachableNow(
  url: string,
  _tabId: number,
  calendarState: CalendarState,
  settings: Awaited<ReturnType<typeof getSettings>>,
  unlocks: Record<string, TemporaryUnlockState>,
): boolean {
  if (!isHttpUrl(url)) return true;
  if (!settings.enableBlocking || !calendarState.isRestricted) return true;

  const host = new URL(url).hostname;
  if (isDomainAllowed(host, calendarState.allowedDomains)) return true;

  const unlock = findMatchingUnlockForHost(host, unlocks);
  if (!unlock) return false;
  if (new Date(unlock.expiresAt).getTime() <= Date.now()) return false;
  return host === unlock.blockedHost || host.endsWith(`.${unlock.blockedHost}`);
}

async function getNextUnlockCost(
  calendarState: CalendarState,
  blockedTab: BlockedTabState | null,
): Promise<number> {
  const spendState = await getUnlockSpendState();
  const activeEventKey = getActiveEventKey(calendarState, blockedTab);
  const spendCount = spendState.activeEventKey === activeEventKey ? spendState.spendCount : 0;
  return TEMP_UNLOCK_BASE_COST + TEMP_UNLOCK_INCREMENT * spendCount;
}

function getActiveEventKey(
  calendarState: CalendarState,
  blockedTab: BlockedTabState | null = null,
): string | null {
  if (calendarState.currentEvent?.id) return calendarState.currentEvent.id;
  if (calendarState.currentEvent?.title) return calendarState.currentEvent.title;
  if (blockedTab?.activeEventId) return blockedTab.activeEventId;
  return blockedTab?.activeEventTitle ?? null;
}

// ─── Task completion and points ──────────────────────────────────────────────

async function handleMarkDone(
  message: Message,
): Promise<{ ok: boolean; pointsAwarded?: number; error?: string }> {
  const payload = message.payload as { taskId?: string; note?: string } | undefined;
  const taskId = payload?.taskId?.trim();
  const note = payload?.note?.trim();

  if (!taskId || !note) {
    return { ok: false, error: 'Missing task completion details.' };
  }

  const taskQueue = await getTaskQueue();
  const task = taskQueue.find((candidate) => candidate.id === taskId);
  if (!task) {
    return { ok: false, error: 'Task not found.' };
  }

  const eligibility = canMarkDone(task);
  if (!eligibility.allowed) {
    return { ok: false, error: eligibility.reason ?? 'Task is not eligible for completion yet.' };
  }

  const completedTask = await markTaskCompleted(taskId, note);
  if (!completedTask) {
    return { ok: false, error: 'Task could not be completed.' };
  }

  const pointsAwarded = calculatePoints({
    task: completedTask,
    consecutiveCompletions: 0,
    usedSnooze: completedTask.snoozesUsed > 0,
    completedEarly: Date.now() < new Date(completedTask.scheduledEnd).getTime(),
    isPerfectDayLastTask: false,
    completionTime: new Date(),
  });

  await applyPointDelta(pointsAwarded, { completedTasksDelta: 1 });
  return { ok: true, pointsAwarded };
}

function canMarkDone(task: Task): { allowed: boolean; reason?: string } {
  const scheduledStart = new Date(task.scheduledStart).getTime();
  const scheduledEnd = new Date(task.scheduledEnd).getTime();
  const duration = scheduledEnd - scheduledStart;
  const minElapsed = duration * 0.5;
  const elapsedSinceStart = Date.now() - scheduledStart;

  if (elapsedSinceStart < minElapsed) {
    const minsLeft = Math.ceil((minElapsed - elapsedSinceStart) / 60_000);
    return {
      allowed: false,
      reason: `Anti-gaming: wait ${minsLeft} more min (50% of block must elapse first).`,
    };
  }

  return { allowed: true };
}

async function applyPointDelta(
  delta: number,
  options: { completedTasksDelta: number },
): Promise<Awaited<ReturnType<typeof getAllTimeStats>>> {
  const [allTimeStats, history] = await Promise.all([
    getAllTimeStats(),
    getPointsHistory(),
  ]);

  const { updated: nextStatsBase, leveledUp } = applyPointsToStats(allTimeStats, delta);
  const currentWeekKey = getWeekKey();
  const currentWeek = history[currentWeekKey] ?? {
    earned: 0,
    tasksCompleted: 0,
    tasksDismissed: 0,
    tasksExpired: 0,
    snoozesUsed: 0,
    perfectDays: 0,
    longestStreak: 0,
  };

  const nextHistory = {
    ...history,
    [currentWeekKey]: {
      ...currentWeek,
      earned: Math.max(0, currentWeek.earned + delta),
      tasksCompleted: currentWeek.tasksCompleted + options.completedTasksDelta,
    },
  };

  const weekScores = Object.values(nextHistory).map((week) => week.earned);
  const nextStats = {
    ...nextStatsBase,
    tasksCompleted: Math.max(0, allTimeStats.tasksCompleted + options.completedTasksDelta),
    bestWeek: weekScores.length > 0 ? Math.max(...weekScores) : 0,
    currentWeekStreak: countCurrentWeekStreak(nextHistory),
  };

  await Promise.all([
    setAllTimeStats(nextStats),
    setPointsHistory(nextHistory),
  ]);

  if (leveledUp) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'src/assets/icons/icon48.png',
      title: 'Level up!',
      message: `You reached Level ${nextStats.level}: ${nextStats.title}`,
    });
  }

  return nextStats;
}

function countCurrentWeekStreak(
  history: Awaited<ReturnType<typeof getPointsHistory>>,
): number {
  let streak = 0;
  let cursor = new Date();

  while (true) {
    const key = getWeekKey(cursor);
    const earned = history[key]?.earned ?? 0;
    if (earned <= 0) break;
    streak += 1;
    cursor = new Date(cursor.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  return streak;
}

// ─── Snooze / assistant / calendar range ─────────────────────────────────────

async function handleSnooze(message: Message): Promise<{ ok: boolean; error?: string }> {
  const payload = message.payload as { durationMinutes?: 5 | 10 | 15 } | undefined;
  const settings = await getSettings();
  const durationMinutes = payload?.durationMinutes ?? settings.breakDurationMinutes;
  const result = await activateSnooze(durationMinutes);
  await reconcileBlockingState();
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

// ─── Side panel behavior ─────────────────────────────────────────────────────

async function syncActionSurfaceBehavior(): Promise<void> {
  const settings = await getSettings();

  await chrome.sidePanel.setOptions({
    enabled: settings.persistentPanelEnabled,
    path: SIDE_PANEL_EXTENSION_PATH,
  });
  await chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: settings.persistentPanelEnabled,
  });
  await chrome.action.setPopup({
    popup: settings.persistentPanelEnabled ? '' : 'src/popup/index.html',
  });
}
