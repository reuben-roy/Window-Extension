import {
  AWAY_THRESHOLD_SECONDS,
  buildAnalyticsSnapshot,
  classifyActivityDomain,
  createEmptyFocusSession,
  finalizeActivitySession,
  finalizeLocalActivityRecord,
  getDurationMinutes,
  LOCAL_DAILY_CONSUMPTION_ROLLUP_RETENTION_DAYS,
  summarizeFocusSession,
  trimActivityHistory,
  trimLocalActivityHistory,
  trimFocusSessionsHistory,
  upsertActivitySession,
  upsertLocalActivityRecord,
} from '../shared/analytics';
import { parseDomainFromUrl } from '../shared/assistant';
import {
  getActiveActivitySession,
  getActiveFocusSession,
  getActiveLocalActivity,
  getActivityHistory,
  getActivitySessionQueue,
  getAnalyticsSnapshot,
  getCalendarState,
  getDailyConsumptionRollups,
  getEventPatternStats,
  getFocusSessionHistory,
  getFocusSessionQueue,
  getLocalActivityHistory,
  getTaskTags,
  setActiveActivitySession,
  setActiveFocusSession,
  setActiveLocalActivity,
  setActivityHistory,
  setActivitySessionQueue,
  setAnalyticsSnapshot,
  setDailyConsumptionRollups,
  setEventPatternStats,
  setFocusSessionHistory,
  setFocusSessionQueue,
  setLocalActivityHistory,
  setTaskTags,
} from '../shared/storage';
import { applyTagCorrection, findTaskTag } from '../shared/tags';
import type {
  ActivityClass,
  ActivitySessionRecord,
  AnalyticsOverrideInput,
  CalendarState,
} from '../shared/types';
import type { DailyConsumptionRollup, DailyConsumptionRollupStore } from '../shared/types';
import { isSnoozeActive } from './snooze';

export function registerAnalyticsListeners(): void {
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.url) {
      void recordActivityFromUrl(changeInfo.url);
    }
  });

  chrome.tabs.onActivated.addListener(() => {
    void recordCurrentActiveTab();
  });

  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId === 0) {
      void recordActivityFromUrl(details.url);
    }
  });
}

export async function handleAnalyticsHeartbeat(
  calendarState?: CalendarState,
): Promise<void> {
  const state = calendarState ?? (await getCalendarState());
  const now = new Date().toISOString();
  await synchronizeFocusSession(state, now);

  if (!state.currentEvent) {
    await refreshLocalAnalyticsSnapshot();
    return;
  }

  const idle = await queryIdleState();
  if (idle) {
    await recordActivity(null, null, 'away', now, state);
    return;
  }

  await recordCurrentActiveTab(state);
}

export async function finalizeAnalyticsTracking(): Promise<void> {
  const now = new Date().toISOString();
  await finalizeActiveTracking(now);
  await refreshLocalAnalyticsSnapshot();
}

export async function saveAnalyticsOverrideLocally(
  input: AnalyticsOverrideInput,
): Promise<void> {
  const [focusHistory, activeFocusSession, taskTags, eventPatternStats] = await Promise.all([
    getFocusSessionHistory(),
    getActiveFocusSession(),
    getTaskTags(),
    getEventPatternStats(),
  ]);

  const nextHistory = focusHistory.map((session) =>
    session.id === input.focusSessionId
      ? {
          ...session,
          tagKey: input.tagKey,
          difficultyRank: input.difficultyRank,
        }
      : session,
  );

  let nextActive = activeFocusSession;
  if (activeFocusSession?.session.id === input.focusSessionId) {
    nextActive = {
      ...activeFocusSession,
      session: {
        ...activeFocusSession.session,
        tagKey: input.tagKey,
        difficultyRank: input.difficultyRank,
      },
    };
  }

  let nextStats = eventPatternStats;
  let nextTags = taskTags;
  const correctedSession =
    nextHistory.find((session) => session.id === input.focusSessionId) ??
    nextActive?.session ??
    null;

  if (correctedSession?.eventTitle && input.tagKey) {
    const correction = applyTagCorrection(
      correctedSession.eventTitle,
      input.tagKey,
      eventPatternStats,
      taskTags,
    );
    nextStats = correction.stats;
    nextTags = correction.taskTags;
  }

  await Promise.all([
    setFocusSessionHistory(nextHistory),
    setActiveFocusSession(nextActive),
    setEventPatternStats(nextStats),
    setTaskTags(nextTags),
  ]);
  await refreshLocalAnalyticsSnapshot();
}

async function recordCurrentActiveTab(calendarState?: CalendarState): Promise<void> {
  try {
    const state = calendarState ?? (await getCalendarState());
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const url = tabs[0]?.url ?? null;
    const tabTitle = tabs[0]?.title ?? null;
    if (!url) {
      await recordActivity(null, null, 'away', new Date().toISOString(), state);
      return;
    }
    await recordActivityFromUrl(url, state, tabTitle);
  } catch {
    await refreshLocalAnalyticsSnapshot();
  }
}

async function recordActivityFromUrl(
  url: string,
  calendarState?: CalendarState,
  tabTitle?: string | null,
): Promise<void> {
  const domain = parseDomainFromUrl(url);
  if (!domain) return;
  const state = calendarState ?? (await getCalendarState());
  await recordActivity(domain, tabTitle ?? null, null, new Date().toISOString(), state);
}

async function recordActivity(
  domain: string | null,
  tabTitle: string | null,
  forcedClass: ActivityClass | null,
  at: string,
  calendarState: CalendarState,
): Promise<void> {
  const [taskTags, snoozed] = await Promise.all([
    getTaskTags(),
    isSnoozeActive(),
  ]);
  const activeFocusSession = await synchronizeFocusSession(calendarState, at);
  if (!activeFocusSession) {
    await refreshLocalAnalyticsSnapshot();
    return;
  }

  const tag = findTaskTag(taskTags, activeFocusSession.session.tagKey);
  const activityClass = forcedClass ?? classifyActivityDomain({
    domain,
    calendarState,
    tag,
    snoozed,
    idle: false,
  });
  const currentActivity = await getActiveActivitySession();
  const upserted = upsertActivitySession(currentActivity, {
    id: currentActivity?.id ?? safeId(),
    focusSessionId: activeFocusSession.session.id,
    calendarEventId: activeFocusSession.session.calendarEventId,
    eventTitle: activeFocusSession.session.eventTitle,
    domain,
    activityClass,
    tagKey: activeFocusSession.session.tagKey,
    secondaryTagKeys: activeFocusSession.session.secondaryTagKeys,
    difficultyRank: activeFocusSession.session.difficultyRank,
    sourceRuleType: activeFocusSession.session.sourceRuleType,
    sourceRuleName: activeFocusSession.session.sourceRuleName,
    at,
  });

  const currentLocalActivity = await getActiveLocalActivity();
  const upsertedLocal = upsertLocalActivityRecord(currentLocalActivity, {
    id: currentLocalActivity?.id ?? safeId(),
    focusSessionId: activeFocusSession.session.id,
    calendarEventId: activeFocusSession.session.calendarEventId,
    eventTitle: activeFocusSession.session.eventTitle,
    domain,
    tabTitle,
    activityClass,
    primaryTagKey: activeFocusSession.session.tagKey,
    secondaryTagKeys: activeFocusSession.session.secondaryTagKeys,
    at,
  });

  const [activityHistory, activityQueue, localActivityHistory] = await Promise.all([
    getActivityHistory(),
    getActivitySessionQueue(),
    getLocalActivityHistory(),
  ]);

  const nextHistory = upserted.finalized
    ? trimActivityHistory([...activityHistory, upserted.finalized])
    : activityHistory;
  const nextQueue = upserted.finalized ? [...activityQueue, upserted.finalized] : activityQueue;
  const nextLocalHistory = upsertedLocal.finalized
    ? trimLocalActivityHistory([...localActivityHistory, upsertedLocal.finalized])
    : localActivityHistory;
  const nextLastProductiveAt =
    activityClass === 'aligned' || activityClass === 'supportive'
      ? at
      : activeFocusSession.lastProductiveAt;

  if (upserted.finalized) {
    await updateDailyConsumptionRollups(upserted.finalized);
  }

  await Promise.all([
    setActivityHistory(nextHistory),
    setActivitySessionQueue(nextQueue),
    setLocalActivityHistory(nextLocalHistory),
    setActiveActivitySession(upserted.current),
    setActiveLocalActivity(upsertedLocal.current),
    setActiveFocusSession({
      ...activeFocusSession,
      session: {
        ...activeFocusSession.session,
        endedAt: at,
      },
      lastProductiveAt: nextLastProductiveAt,
    }),
  ]);

  await refreshLocalAnalyticsSnapshot();
}

async function synchronizeFocusSession(
  calendarState: CalendarState,
  at: string,
) {
  const activeFocusSession = await getActiveFocusSession();
  const activeEventId = calendarState.currentEvent?.id ?? null;

  if (
    activeFocusSession &&
    (!activeEventId || activeFocusSession.session.calendarEventId !== activeEventId)
  ) {
    await finalizeActiveTracking(at);
  }

  if (!activeEventId) {
    return null;
  }

  const refreshed = await getActiveFocusSession();
  if (refreshed?.session.calendarEventId === activeEventId) {
    const next = {
      ...refreshed,
      session: {
        ...refreshed.session,
        sourceRuleType: calendarState.activeRuleSource,
        sourceRuleName: calendarState.activeRuleName,
        tagKey: calendarState.primaryTagKey,
        secondaryTagKeys: calendarState.secondaryTagKeys,
        difficultyRank: calendarState.difficultyRank,
        endedAt: at,
      },
    };
    await setActiveFocusSession(next);
    return next;
  }

  const created = createEmptyFocusSession(safeId(), calendarState, at);
  if (!created) return null;

  const next = {
    session: created,
    lastProductiveAt: null,
  };
  await setActiveFocusSession(next);
  return next;
}

async function finalizeActiveTracking(at: string): Promise<void> {
  const [
    activeFocusSession,
    activeActivitySession,
    activeLocalActivity,
    activityHistory,
    activityQueue,
    localActivityHistory,
    focusHistory,
    focusQueue,
  ] =
    await Promise.all([
      getActiveFocusSession(),
      getActiveActivitySession(),
      getActiveLocalActivity(),
      getActivityHistory(),
      getActivitySessionQueue(),
      getLocalActivityHistory(),
      getFocusSessionHistory(),
      getFocusSessionQueue(),
    ]);

  if (!activeFocusSession) {
    await setActiveActivitySession(null);
    await setActiveLocalActivity(null);
    return;
  }

  const finalizedActivity = finalizeActivitySession(activeActivitySession, at);
  const finalizedLocalActivity = finalizeLocalActivityRecord(activeLocalActivity, at);
  const nextActivityHistory = finalizedActivity
    ? trimActivityHistory([...activityHistory, finalizedActivity])
    : activityHistory;
  const nextActivityQueue = finalizedActivity
    ? [...activityQueue, finalizedActivity]
    : activityQueue;
  const nextLocalActivityHistory = finalizedLocalActivity
    ? trimLocalActivityHistory([...localActivityHistory, finalizedLocalActivity])
    : localActivityHistory;
  const finalizedFocus = summarizeFocusSession(
    {
      ...activeFocusSession.session,
      endedAt: at,
    },
    nextActivityHistory,
    activeFocusSession.lastProductiveAt,
  );
  const nextFocusHistory = trimFocusSessionsHistory([...focusHistory, finalizedFocus]);
  const nextFocusQueue = [...focusQueue, finalizedFocus];

  if (finalizedActivity) {
    await updateDailyConsumptionRollups(finalizedActivity);
  }

  await Promise.all([
    setActivityHistory(nextActivityHistory),
    setActivitySessionQueue(nextActivityQueue),
    setLocalActivityHistory(nextLocalActivityHistory),
    setFocusSessionHistory(nextFocusHistory),
    setFocusSessionQueue(nextFocusQueue),
    setActiveActivitySession(null),
    setActiveLocalActivity(null),
    setActiveFocusSession(null),
  ]);
}

async function refreshLocalAnalyticsSnapshot(): Promise<void> {
  const [
    taskTags,
    focusHistory,
    activeFocusSession,
    activeActivitySession,
    existingSnapshot,
    activityHistory,
    dailyConsumptionRollups,
  ] =
    await Promise.all([
      getTaskTags(),
      getFocusSessionHistory(),
      getActiveFocusSession(),
      getActiveActivitySession(),
      getAnalyticsSnapshot(),
      getActivityHistory(),
      getDailyConsumptionRollups(),
    ]);
  const activityHistoryWithCurrent = activeActivitySession
    ? [...activityHistory, activeActivitySession as ActivitySessionRecord]
    : activityHistory;

  const currentSession = activeFocusSession
    ? summarizeFocusSession(
        {
          ...activeFocusSession.session,
          endedAt: activeActivitySession?.endedAt ?? new Date().toISOString(),
        },
        activityHistoryWithCurrent,
        activeFocusSession.lastProductiveAt,
      )
    : null;

  const next = buildAnalyticsSnapshot({
    taskTags,
    focusHistory,
    activityHistory: activityHistoryWithCurrent,
    dailyConsumptionRollups,
    currentSession,
    currentActivityClass: activeActivitySession?.activityClass ?? null,
    lastCalculatedAt: new Date().toISOString(),
    lastSyncedAt: existingSnapshot.lastSyncedAt,
  });

  await setAnalyticsSnapshot(next);
}

async function updateDailyConsumptionRollups(activity: ActivitySessionRecord): Promise<void> {
  const minutes = getDurationMinutes(activity.startedAt, activity.endedAt);
  if (minutes <= 0) return;

  const store = await getDailyConsumptionRollups();
  const dateKey = new Date(activity.startedAt).toISOString().slice(0, 10);
  const existing: DailyConsumptionRollup = store[dateKey] ?? {
    dateKey,
    productiveMinutes: 0,
    supportiveMinutes: 0,
    distractedMinutes: 0,
    awayMinutes: 0,
    breakMinutes: 0,
    totalMinutes: 0,
    topDomains: [],
    otherDomainMinutes: 0,
  };

  const next = { ...existing };
  if (activity.activityClass === 'aligned') next.productiveMinutes += minutes;
  else if (activity.activityClass === 'supportive') next.supportiveMinutes += minutes;
  else if (activity.activityClass === 'distracted') next.distractedMinutes += minutes;
  else if (activity.activityClass === 'away') next.awayMinutes += minutes;
  else next.breakMinutes += minutes;
  next.totalMinutes += minutes;

  const normalizedDomain = (activity.domain ?? '').replace(/^www\./, '').toLowerCase();
  if (normalizedDomain) {
    const topLimit = 12;
    const existingIndex = next.topDomains.findIndex((entry) => entry.domain === normalizedDomain);
    if (existingIndex >= 0) {
      const entry = { ...next.topDomains[existingIndex] };
      entry.visits += 1;
      entry.totalMinutes += minutes;
      if (activity.activityClass === 'aligned') entry.productiveMinutes += minutes;
      else if (activity.activityClass === 'supportive') entry.supportiveMinutes += minutes;
      else if (activity.activityClass === 'distracted') entry.distractedMinutes += minutes;
      else if (activity.activityClass === 'away') entry.awayMinutes += minutes;
      else entry.breakMinutes += minutes;
      next.topDomains = [
        ...next.topDomains.slice(0, existingIndex),
        entry,
        ...next.topDomains.slice(existingIndex + 1),
      ];
    } else if (next.topDomains.length < topLimit) {
      next.topDomains = [
        ...next.topDomains,
        {
          domain: normalizedDomain,
          label: normalizedDomain,
          productiveMinutes: activity.activityClass === 'aligned' ? minutes : 0,
          supportiveMinutes: activity.activityClass === 'supportive' ? minutes : 0,
          distractedMinutes: activity.activityClass === 'distracted' ? minutes : 0,
          awayMinutes: activity.activityClass === 'away' ? minutes : 0,
          breakMinutes: activity.activityClass === 'break' ? minutes : 0,
          totalMinutes: minutes,
          visits: 1,
        },
      ];
    } else {
      next.otherDomainMinutes += minutes;
    }
    next.topDomains = [...next.topDomains].sort((a, b) => b.totalMinutes - a.totalMinutes).slice(0, topLimit);
  }

  const trimmed = trimDailyConsumptionRollupStore({ ...store, [dateKey]: next });
  await setDailyConsumptionRollups(trimmed);
}

function trimDailyConsumptionRollupStore(store: DailyConsumptionRollupStore): DailyConsumptionRollupStore {
  const cutoff = Date.now() - LOCAL_DAILY_CONSUMPTION_ROLLUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const next: DailyConsumptionRollupStore = {};
  for (const [key, rollup] of Object.entries(store)) {
    const dateMs = new Date(`${key}T00:00:00.000Z`).getTime();
    if (Number.isFinite(dateMs) && dateMs >= cutoff) {
      next[key] = rollup;
    }
  }
  return next;
}

function queryIdleState(): Promise<boolean> {
  if (!chrome.idle?.queryState) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    chrome.idle.queryState(AWAY_THRESHOLD_SECONDS, (state) => {
      resolve(state === 'idle' || state === 'locked');
    });
  });
}

function safeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `analytics-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
