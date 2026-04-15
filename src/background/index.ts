import {
  ALARM_SNOOZE_END,
  ALARM_TICK,
  ALARM_TICK_PERIOD_MINUTES,
  BLOCKED_PAGE_EXTENSION_PATH,
  DOWNLOAD_ALLOWANCE_RULE_ID_START,
  DOWNLOAD_ALLOWANCE_TIMEOUT_MS,
  SIDE_PANEL_EXTENSION_PATH,
  TEMP_UNLOCK_BASE_COST,
  TEMP_UNLOCK_DURATION_MINUTES,
  TEMP_UNLOCK_INCREMENT,
  TEMP_UNLOCK_RULE_ID_START,
} from '../shared/constants';
import {
  getAccountConflict,
  getAccountSyncState,
  getAccountUser,
  getAssistantOptions,
  getAllTimeStats,
  getBackendSession,
  getBackendSyncState,
  getBlockedTabs,
  getCalendarState,
  getDownloadAllowances,
  getEventRules,
  getGlobalAllowlist,
  getIdeaRecords,
  getKeywordRules,
  getOpenClawState,
  getPointsHistory,
  getWeekKey,
  getSettings,
  getSnoozeState,
  getTabDocumentUrls,
  getTaskQueue,
  getTemporaryUnlocks,
  getUnlockSpendState,
  setAllTimeStats,
  setBlockedTabs,
  setCalendarState,
  setDownloadAllowances,
  setPointsHistory,
  setSettings,
  setTabDocumentUrls,
  setTemporaryUnlocks,
  setUnlockSpendState,
} from '../shared/storage';
import type {
  BlockedTabState,
  CalendarEvent,
  CalendarState,
  DownloadAllowance,
  Message,
  StateResponse,
  Task,
  TemporaryUnlockState,
} from '../shared/types';
import {
  cancelOpenClawJob,
  decideIdea,
  handleSyncedStorageChanges,
  refreshAccountState,
  refreshAssistantState,
  resolveAccountConflict,
  restoreAccountSession,
  retryIdea,
  signInWithProvider,
  signOutAccount,
  startOpenClawSession,
  submitIdea,
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
const currentDocumentUrlByTab = new Map<number, string>();
const navigationSourceTabByTab = new Map<number, number>();
const recentProgrammaticDownloadAttempts = new Map<string, number>();

// ─── Lifecycle ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_TICK, { periodInMinutes: ALARM_TICK_PERIOD_MINUTES });
  void ensureDemoStatsSeeded();
  void hydrateOpenTabsDocumentUrls();
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
registerDownloadListeners();
void ensureDemoStatsSeeded();
void hydrateOpenTabsDocumentUrls();
void syncActionSurfaceBehavior();
void restoreAccountSession();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && ('settings' in changes || 'eventRules' in changes || 'keywordRules' in changes || 'globalAllowlist' in changes)) {
    void reconcileBlockingState();
  }

  if (areaName === 'sync' && 'settings' in changes) {
    void syncActionSurfaceBehavior();
  }

  void handleSyncedStorageChanges(changes, areaName);
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
  await cleanupExpiredDownloadAllowances(calendarState);

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

    case 'REFRESH_ACCOUNT_STATE':
      return refreshAccountState();

    case 'REFRESH_ASSISTANT_STATE':
      return refreshAssistantState();

    case 'SIGN_IN_WITH_PROVIDER':
      return signInWithProvider(
        ((message.payload as { provider?: 'google' | 'github' } | undefined)?.provider ?? 'google'),
      );

    case 'SIGN_OUT_ACCOUNT':
      return signOutAccount().then(() => ({ ok: true }));

    case 'RESOLVE_ACCOUNT_CONFLICT':
      return resolveAccountConflict(
        ((message.payload as { choice?: 'local' | 'remote' } | undefined)?.choice ?? 'local'),
      ).then(() => ({ ok: true }));

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
    accountUser,
    accountSyncState,
    accountConflict,
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
    getAccountUser(),
    getAccountSyncState(),
    getAccountConflict(),
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
    accountUser,
    accountSyncState,
    accountConflict,
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
    setDownloadAllowances({}),
    updateBlockingRules([], false),
    syncTemporaryUnlockRules({}, {}),
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
  await cleanupExpiredDownloadAllowances(nextCalendarState);

  if (!snoozed) {
    await applyBlockingState(nextCalendarState);
  } else {
    await reconcileBlockedTabs(nextCalendarState);
  }
}

async function applyBlockingState(calendarState: CalendarState): Promise<void> {
  const [settings, unlocks, downloadAllowances] = await Promise.all([
    getSettings(),
    getTemporaryUnlocks(),
    getDownloadAllowances(),
  ]);

  await updateBlockingRules(
    calendarState.allowedDomains,
    settings.enableBlocking && calendarState.isRestricted,
  );
  await syncTemporaryUnlockRules(unlocks, downloadAllowances);
  await reconcileBlockedTabs(calendarState, unlocks, downloadAllowances);
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
    syncTemporaryAllowances(nextUnlocks),
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
  const [unlocks, downloadAllowances] = await Promise.all([
    getTemporaryUnlocks(),
    getDownloadAllowances(),
  ]);
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
    syncTemporaryAllowances(activeUnlocks, downloadAllowances),
  ]);

  await reloadTabsForExpiredHosts(
    expiredUnlocks.map((unlock) => unlock.blockedHost),
    calendarState,
  );
}

async function cleanupExpiredDownloadAllowances(
  calendarState: CalendarState,
): Promise<void> {
  const [unlocks, allowances] = await Promise.all([
    getTemporaryUnlocks(),
    getDownloadAllowances(),
  ]);
  const now = Date.now();
  const activeAllowances: Record<string, DownloadAllowance> = {};
  const expiredHosts = new Set<string>();

  for (const [key, allowance] of Object.entries(allowances)) {
    if (new Date(allowance.expiresAt).getTime() > now) {
      activeAllowances[key] = allowance;
    } else {
      expiredHosts.add(allowance.targetHost);
    }
  }

  if (expiredHosts.size === 0) return;

  await Promise.all([
    setDownloadAllowances(activeAllowances),
    syncTemporaryAllowances(unlocks, activeAllowances),
  ]);

  await reloadTabsForExpiredHosts([...expiredHosts], calendarState);
}

async function reconcileBlockedTabs(
  calendarState: CalendarState,
  unlocksInput?: Record<string, TemporaryUnlockState>,
  downloadAllowancesInput?: Record<string, DownloadAllowance>,
): Promise<void> {
  const [settings, blockedTabs, unlocks, downloadAllowances] = await Promise.all([
    getSettings(),
    getBlockedTabs(),
    unlocksInput ? Promise.resolve(unlocksInput) : getTemporaryUnlocks(),
    downloadAllowancesInput ? Promise.resolve(downloadAllowancesInput) : getDownloadAllowances(),
  ]);

  const nextBlockedTabs = { ...blockedTabs };

  for (const blockedTab of Object.values(blockedTabs)) {
    const allowed = isUrlReachableNow(
      blockedTab.originalUrl,
      blockedTab.tabId,
      calendarState,
      settings,
      unlocks,
      downloadAllowances,
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

  chrome.webNavigation.onCreatedNavigationTarget?.addListener((details) => {
    navigationSourceTabByTab.set(details.tabId, details.sourceTabId);
  });

  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return;

    if (isBlockedPageUrl(details.url)) {
      const originalUrl = pendingNavigationByTab.get(details.tabId);
      if (originalUrl) {
        void rememberBlockedTab(details.tabId, originalUrl);
        void handleBlockedDownloadRedirect(
          details.tabId,
          currentDocumentUrlByTab.get(details.tabId) ?? null,
          originalUrl,
        );
      }
      return;
    }

    if (isHttpUrl(details.url)) {
      recordCommittedDocumentUrl(details.tabId, details.url);
      navigationSourceTabByTab.delete(details.tabId);
      for (const key of recentProgrammaticDownloadAttempts.keys()) {
        if (key.startsWith(`${details.tabId}:`)) {
          recentProgrammaticDownloadAttempts.delete(key);
        }
      }
      void clearBlockedTab(details.tabId);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    pendingNavigationByTab.delete(tabId);
    currentDocumentUrlByTab.delete(tabId);
    navigationSourceTabByTab.delete(tabId);
    for (const key of recentProgrammaticDownloadAttempts.keys()) {
      if (key.startsWith(`${tabId}:`)) {
        recentProgrammaticDownloadAttempts.delete(key);
      }
    }
    void clearBlockedTab(tabId);
    void clearStoredDocumentUrl(tabId);
  });
}

function registerDownloadListeners(): void {
  chrome.downloads.onCreated.addListener((item) => {
    void handleDownloadCreated(item);
  });

  chrome.downloads.onChanged.addListener((delta) => {
    void handleDownloadChanged(delta);
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

export function recordCommittedDocumentUrl(tabId: number, url: string): void {
  currentDocumentUrlByTab.set(tabId, url);
  pendingNavigationByTab.set(tabId, url);
  void persistDocumentUrl(tabId, url);
}

export async function hydrateOpenTabsDocumentUrls(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url || !isHttpUrl(tab.url)) continue;
    recordCommittedDocumentUrl(tab.id, tab.url);
  }
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

function createDownloadAllowanceRuleId(
  host: string,
  seed: string,
): number {
  const key = `${normalizeUnlockKey(host)}:${seed}`;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 33 + key.charCodeAt(index)) | 0;
  }

  return DOWNLOAD_ALLOWANCE_RULE_ID_START + (Math.abs(hash) % 700_000);
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
  tabId: number,
  calendarState: CalendarState,
  settings: Awaited<ReturnType<typeof getSettings>>,
  unlocks: Record<string, TemporaryUnlockState>,
  downloadAllowances: Record<string, DownloadAllowance>,
): boolean {
  if (!isHttpUrl(url)) return true;
  if (!settings.enableBlocking || !calendarState.isRestricted) return true;

  const host = new URL(url).hostname;
  if (isDomainAllowed(host, calendarState.allowedDomains)) return true;

  const unlock = findMatchingUnlockForHost(host, unlocks);
  if (unlock && new Date(unlock.expiresAt).getTime() > Date.now()) {
    return host === unlock.blockedHost || host.endsWith(`.${unlock.blockedHost}`);
  }

  const allowance = findMatchingDownloadAllowance(host, tabId, downloadAllowances);
  if (!allowance) return false;
  if (new Date(allowance.expiresAt).getTime() <= Date.now()) return false;
  return host === allowance.targetHost || host.endsWith(`.${allowance.targetHost}`);
}

function findMatchingDownloadAllowance(
  host: string,
  tabId: number,
  allowances: Record<string, DownloadAllowance>,
): DownloadAllowance | null {
  const lowerHost = host.toLowerCase();

  const match = Object.values(allowances)
    .filter((allowance) => {
      const targetHost = allowance.targetHost.toLowerCase();
      const matchesHost = lowerHost === targetHost || lowerHost.endsWith(`.${targetHost}`);
      const matchesTab = allowance.tabId === null || allowance.tabId === tabId;
      return matchesHost && matchesTab && new Date(allowance.expiresAt).getTime() > Date.now();
    })
    .sort((a, b) => b.targetHost.length - a.targetHost.length)[0];

  return match ?? null;
}

async function syncTemporaryAllowances(
  unlocksInput?: Record<string, TemporaryUnlockState>,
  downloadAllowancesInput?: Record<string, DownloadAllowance>,
): Promise<void> {
  const [unlocks, downloadAllowances] = await Promise.all([
    unlocksInput ? Promise.resolve(unlocksInput) : getTemporaryUnlocks(),
    downloadAllowancesInput ? Promise.resolve(downloadAllowancesInput) : getDownloadAllowances(),
  ]);

  await syncTemporaryUnlockRules(unlocks, downloadAllowances);
}

async function reloadTabsForExpiredHosts(
  hosts: string[],
  calendarState: CalendarState,
): Promise<void> {
  if (hosts.length === 0) return;

  const settings = await getSettings();
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    try {
      if (!tab.id || !tab.url || !isHttpUrl(tab.url)) continue;
      const host = new URL(tab.url).hostname;
      const matchesExpiredHost = hosts.some(
        (expiredHost) => host === expiredHost || host.endsWith(`.${expiredHost}`),
      );
      if (!matchesExpiredHost) continue;

      const stillAllowed =
        !settings.enableBlocking ||
        !calendarState.isRestricted ||
        isDomainAllowed(host, calendarState.allowedDomains);

      if (!stillAllowed) {
        await chrome.tabs.reload(tab.id);
      }
    } catch {
      // Ignore tabs that disappeared during cleanup.
    }
  }
}

export async function handleDownloadCreated(
  item: chrome.downloads.DownloadItem,
): Promise<void> {
  const targetUrl = item.finalUrl || item.url;
  if (!targetUrl || !isHttpUrl(targetUrl)) return;

  const targetHost = new URL(targetUrl).hostname;
  const sourceUrl = item.referrer && isHttpUrl(item.referrer) ? item.referrer : null;
  const [settings, allowances] = await Promise.all([
    getSettings(),
    getDownloadAllowances(),
  ]);
  if (!settings.downloadRedirectUseDownloadsApi) return;

  const inferredTabId = await inferTabIdForSourceUrl(sourceUrl);
  const tabId = settings.downloadRedirectAllowAcrossTabsEnabled ? null : inferredTabId;

  if (!(await isAllowedDownloadSource(sourceUrl, inferredTabId))) return;
  const key = buildDownloadAllowanceKey('download', item.id, targetHost, tabId);
  const allowance: DownloadAllowance = {
    key,
    allowanceType: 'download',
    downloadId: item.id,
    tabId,
    sourceUrl,
    sourceHost: sourceUrl && isHttpUrl(sourceUrl) ? new URL(sourceUrl).hostname : null,
    targetUrl,
    targetHost,
    ruleId: createDownloadAllowanceRuleId(targetHost, `download:${item.id}`),
    expiresAt: new Date(Date.now() + DOWNLOAD_ALLOWANCE_TIMEOUT_MS).toISOString(),
  };

  const nextAllowances = removeMatchingFallbackAllowances(allowances, tabId, targetHost);
  nextAllowances[key] = allowance;

  await Promise.all([
    setDownloadAllowances(nextAllowances),
    syncTemporaryAllowances(undefined, nextAllowances),
  ]);

  const calendarState = await getCalendarState();
  await reconcileBlockedTabs(calendarState, undefined, nextAllowances);
}

export async function handleDownloadChanged(
  delta: chrome.downloads.DownloadDelta,
): Promise<void> {
  const allowances = await getDownloadAllowances();
  const matching = Object.entries(allowances).filter(([, allowance]) => allowance.downloadId === delta.id);
  if (matching.length === 0) return;

  let nextAllowances = { ...allowances };
  let mutated = false;
  const removedHosts = new Set<string>();

  const nextUrl = delta.finalUrl?.current ?? delta.url?.current ?? null;
  if (nextUrl && isHttpUrl(nextUrl)) {
    const nextHost = new URL(nextUrl).hostname;
    for (const [key, allowance] of matching) {
      const nextKey = buildDownloadAllowanceKey(allowance.allowanceType, delta.id, nextHost, allowance.tabId);
      delete nextAllowances[key];
      nextAllowances[nextKey] = {
        ...allowance,
        key: nextKey,
        targetUrl: nextUrl,
        targetHost: nextHost,
        ruleId: createDownloadAllowanceRuleId(nextHost, `download:${delta.id}`),
        expiresAt: new Date(Date.now() + DOWNLOAD_ALLOWANCE_TIMEOUT_MS).toISOString(),
      };
      mutated = true;
    }
  }

  const nextState = delta.state?.current ?? null;
  if (nextState === 'complete' || nextState === 'interrupted') {
    for (const [, allowance] of matching) {
      removedHosts.add(allowance.targetHost);
    }
    nextAllowances = Object.fromEntries(
      Object.entries(nextAllowances).filter(([, allowance]) => allowance.downloadId !== delta.id),
    );
    mutated = true;
  }

  if (!mutated) return;

  await Promise.all([
    setDownloadAllowances(nextAllowances),
    syncTemporaryAllowances(undefined, nextAllowances),
  ]);

  if (removedHosts.size > 0) {
    const calendarState = await getCalendarState();
    await reloadTabsForExpiredHosts([...removedHosts], calendarState);
  }
}

export async function maybeStartDownloadRedirectFallback(
  tabId: number,
  sourceUrl: string | null,
  blockedUrl: string,
): Promise<void> {
  const resolvedSourceUrl = await getLikelySourceUrlForTab(tabId, sourceUrl);

  const [settings, allowances] = await Promise.all([
    getSettings(),
    getDownloadAllowances(),
  ]);
  if (!(await shouldAllowDownloadFallback(tabId, resolvedSourceUrl, blockedUrl, settings))) return;
  const targetHost = new URL(blockedUrl).hostname;
  if (findMatchingDownloadAllowance(targetHost, tabId, allowances)) return;

  const allowanceTabId = settings.downloadRedirectAllowAcrossTabsEnabled ? null : tabId;
  const key = buildDownloadAllowanceKey('fallback', null, targetHost, allowanceTabId);
  const fallbackAllowance: DownloadAllowance = {
    key,
    allowanceType: 'fallback',
    downloadId: null,
    tabId: allowanceTabId,
    sourceUrl: resolvedSourceUrl,
    sourceHost: resolvedSourceUrl && isHttpUrl(resolvedSourceUrl) ? new URL(resolvedSourceUrl).hostname : null,
    targetUrl: blockedUrl,
    targetHost,
    ruleId: createDownloadAllowanceRuleId(targetHost, `fallback:${tabId}`),
    expiresAt: new Date(
      Date.now() + settings.downloadRedirectFallbackSeconds * 1_000,
    ).toISOString(),
  };
  const nextAllowances = {
    ...allowances,
    [key]: fallbackAllowance,
  };

  await Promise.all([
    setDownloadAllowances(nextAllowances),
    syncTemporaryAllowances(undefined, nextAllowances),
  ]);

  try {
    await chrome.tabs.update(tabId, { url: blockedUrl });
  } catch {
    // Tab may have disappeared before retrying the navigation.
  }
}

export async function handleBlockedDownloadRedirect(
  tabId: number,
  sourceUrl: string | null,
  blockedUrl: string,
): Promise<void> {
  const resolvedSourceUrl = await getLikelySourceUrlForTab(tabId, sourceUrl);
  const settings = await getSettings();

  const startedProgrammaticDownload = await maybeStartProgrammaticBlockedDownload(
    tabId,
    resolvedSourceUrl,
    blockedUrl,
    settings,
  );
  if (startedProgrammaticDownload) {
    return;
  }

  await maybeStartDownloadRedirectFallback(tabId, resolvedSourceUrl, blockedUrl);
}

export async function maybeStartProgrammaticBlockedDownload(
  tabId: number,
  sourceUrl: string | null,
  blockedUrl: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
): Promise<boolean> {
  if (!settings.downloadRedirectProgrammaticDownloadEnabled) return false;
  if (!looksLikeDownloadRedirect(blockedUrl)) return false;
  if (!(await isAllowedDownloadSource(sourceUrl, tabId))) return false;
  if (hasRecentProgrammaticDownloadAttempt(tabId, blockedUrl)) return false;

  rememberProgrammaticDownloadAttempt(tabId, blockedUrl);

  try {
    await chrome.downloads.download({
      url: blockedUrl,
      saveAs: false,
    });

    await clearBlockedTab(tabId);

    if (sourceUrl && sourceUrl !== blockedUrl) {
      await chrome.tabs.update(tabId, { url: sourceUrl });
    }

    return true;
  } catch (error) {
    console.warn('[Window] Programmatic download handoff failed:', error);
    return false;
  }
}

async function isAllowedDownloadSource(
  sourceUrl: string | null,
  tabId: number | null,
): Promise<boolean> {
  if (!sourceUrl || !isHttpUrl(sourceUrl)) return false;

  const [calendarState, settings, unlocks, downloadAllowances] = await Promise.all([
    getCalendarState(),
    getSettings(),
    getTemporaryUnlocks(),
    getDownloadAllowances(),
  ]);

  return isUrlReachableNow(
    sourceUrl,
    tabId ?? -1,
    calendarState,
    settings,
    unlocks,
    downloadAllowances,
  );
}

function buildDownloadAllowanceKey(
  allowanceType: DownloadAllowance['allowanceType'],
  downloadId: number | null,
  host: string,
  tabId: number | null,
): string {
  return `${allowanceType}:${downloadId ?? 'none'}:${tabId ?? 'any'}:${normalizeUnlockKey(host)}`;
}

function removeMatchingFallbackAllowances(
  allowances: Record<string, DownloadAllowance>,
  tabId: number | null,
  targetHost: string,
): Record<string, DownloadAllowance> {
  return Object.fromEntries(
    Object.entries(allowances).filter(([, allowance]) => {
      if (allowance.allowanceType !== 'fallback') return true;
      if (allowance.targetHost !== targetHost) return true;
      return allowance.tabId !== tabId;
    }),
  );
}

function looksLikeDownloadRedirect(url: string): boolean {
  if (!isHttpUrl(url)) return false;

  const parsed = new URL(url);
  const pathname = parsed.pathname.toLowerCase();
  const query = parsed.search.toLowerCase();

  if (/\.(zip|pdf|csv|dmg|pkg|exe|msi|tar|gz|tgz|mp4|mp3|mov|xlsx|docx|pptx)$/i.test(pathname)) {
    return true;
  }

  return [
    '/download',
    '/files/',
    'download=',
    'download_',
    'filename=',
    'attachment',
    'content-disposition',
    'response-content-disposition',
    'export=download',
    'verifier=',
  ].some((token) => pathname.includes(token) || query.includes(token));
}

function buildProgrammaticDownloadAttemptKey(tabId: number, url: string): string {
  return `${tabId}:${normalizeComparableUrl(url)}`;
}

function hasRecentProgrammaticDownloadAttempt(tabId: number, url: string): boolean {
  const now = Date.now();
  for (const [key, attemptedAt] of recentProgrammaticDownloadAttempts.entries()) {
    if (now - attemptedAt > 15_000) {
      recentProgrammaticDownloadAttempts.delete(key);
    }
  }

  const attemptedAt = recentProgrammaticDownloadAttempts.get(
    buildProgrammaticDownloadAttemptKey(tabId, url),
  );
  return typeof attemptedAt === 'number' && now - attemptedAt < 15_000;
}

function rememberProgrammaticDownloadAttempt(tabId: number, url: string): void {
  recentProgrammaticDownloadAttempts.set(
    buildProgrammaticDownloadAttemptKey(tabId, url),
    Date.now(),
  );
}

async function shouldAllowDownloadFallback(
  tabId: number,
  sourceUrl: string | null,
  blockedUrl: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
): Promise<boolean> {
  if (!sourceUrl || !isHttpUrl(sourceUrl) || !isHttpUrl(blockedUrl)) return false;
  if (!(await isAllowedDownloadSource(sourceUrl, tabId))) return false;

  const sourceHost = new URL(sourceUrl).hostname;
  const targetHost = new URL(blockedUrl).hostname;

  if (
    settings.downloadRedirectFallbackPatternMatchEnabled &&
    looksLikeDownloadRedirect(blockedUrl)
  ) {
    return true;
  }

  if (
    settings.downloadRedirectFallbackSameHostEnabled &&
    areHostsEquivalentOrNested(sourceHost, targetHost)
  ) {
    return true;
  }

  if (
    settings.downloadRedirectFallbackSameSiteEnabled &&
    getApproximateSiteKey(sourceHost) === getApproximateSiteKey(targetHost)
  ) {
    return true;
  }

  return settings.downloadRedirectFallbackAnyAllowedRedirectEnabled;
}

function areHostsEquivalentOrNested(left: string, right: string): boolean {
  const leftHost = left.toLowerCase();
  const rightHost = right.toLowerCase();
  return (
    leftHost === rightHost ||
    leftHost.endsWith(`.${rightHost}`) ||
    rightHost.endsWith(`.${leftHost}`)
  );
}

function getApproximateSiteKey(host: string): string {
  const lowerHost = host.trim().toLowerCase();
  if (!lowerHost) return '';

  const labels = lowerHost.split('.').filter(Boolean);
  if (labels.length <= 2) return lowerHost;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(lowerHost) || lowerHost === 'localhost') {
    return lowerHost;
  }

  return labels.slice(-2).join('.');
}

function normalizeComparableUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    if (parsed.pathname !== '/') {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function urlsMatchForSourceLookup(left: string, right: string): boolean {
  return normalizeComparableUrl(left) === normalizeComparableUrl(right);
}

async function inferTabIdForSourceUrl(sourceUrl: string | null): Promise<number | null> {
  if (!sourceUrl) return null;

  for (const [tabId, currentUrl] of currentDocumentUrlByTab.entries()) {
    if (urlsMatchForSourceLookup(currentUrl, sourceUrl)) {
      return tabId;
    }
  }

  const stored = await getTabDocumentUrls();
  for (const [tabId, currentUrl] of Object.entries(stored)) {
    if (urlsMatchForSourceLookup(currentUrl, sourceUrl)) {
      const numericTabId = Number(tabId);
      if (Number.isFinite(numericTabId)) {
        currentDocumentUrlByTab.set(numericTabId, currentUrl);
        return numericTabId;
      }
    }
  }

  return null;
}

async function getLikelySourceUrlForTab(
  tabId: number,
  explicitSourceUrl: string | null,
): Promise<string | null> {
  if (explicitSourceUrl && isHttpUrl(explicitSourceUrl)) {
    return explicitSourceUrl;
  }

  const directUrl = await getStoredDocumentUrl(tabId);
  if (directUrl) {
    return directUrl;
  }

  const sourceTabId = navigationSourceTabByTab.get(tabId);
  if (typeof sourceTabId === 'number') {
    return getStoredDocumentUrl(sourceTabId);
  }

  return null;
}

async function persistDocumentUrl(tabId: number, url: string): Promise<void> {
  const stored = await getTabDocumentUrls();
  if (stored[String(tabId)] === url) return;
  await setTabDocumentUrls({
    ...stored,
    [String(tabId)]: url,
  });
}

async function getStoredDocumentUrl(tabId: number): Promise<string | null> {
  const inMemory = currentDocumentUrlByTab.get(tabId);
  if (inMemory) return inMemory;

  const stored = await getTabDocumentUrls();
  const value = stored[String(tabId)] ?? null;
  if (value) {
    currentDocumentUrlByTab.set(tabId, value);
  }
  return value;
}

async function clearStoredDocumentUrl(tabId: number): Promise<void> {
  const stored = await getTabDocumentUrls();
  if (!(String(tabId) in stored)) return;
  const nextStored = { ...stored };
  delete nextStored[String(tabId)];
  await setTabDocumentUrls(nextStored);
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
