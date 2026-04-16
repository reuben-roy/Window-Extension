import {
  AWAY_THRESHOLD_SECONDS,
  buildAnalyticsSnapshot,
  classifyActivityDomain,
  createEmptyFocusSession,
  finalizeActivitySession,
  summarizeFocusSession,
  trimActivityHistory,
  trimFocusSessionsHistory,
  upsertActivitySession,
} from '../shared/analytics';
import { parseDomainFromUrl } from '../shared/assistant';
import {
  getActiveActivitySession,
  getActiveFocusSession,
  getActivityHistory,
  getActivitySessionQueue,
  getAnalyticsSnapshot,
  getCalendarState,
  getEventPatternStats,
  getFocusSessionHistory,
  getFocusSessionQueue,
  getTaskTags,
  setActiveActivitySession,
  setActiveFocusSession,
  setActivityHistory,
  setActivitySessionQueue,
  setAnalyticsSnapshot,
  setEventPatternStats,
  setFocusSessionHistory,
  setFocusSessionQueue,
  setTaskTags,
} from '../shared/storage';
import { applyTagCorrection, findTaskTag } from '../shared/tags';
import type {
  ActivityClass,
  ActivitySessionRecord,
  AnalyticsOverrideInput,
  CalendarState,
} from '../shared/types';
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
    await recordActivity(null, 'away', now, state);
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
    if (!url) {
      await recordActivity(null, 'away', new Date().toISOString(), state);
      return;
    }
    await recordActivityFromUrl(url, state);
  } catch {
    await refreshLocalAnalyticsSnapshot();
  }
}

async function recordActivityFromUrl(
  url: string,
  calendarState?: CalendarState,
): Promise<void> {
  const domain = parseDomainFromUrl(url);
  if (!domain) return;
  const state = calendarState ?? (await getCalendarState());
  await recordActivity(domain, null, new Date().toISOString(), state);
}

async function recordActivity(
  domain: string | null,
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
    difficultyRank: activeFocusSession.session.difficultyRank,
    sourceRuleType: activeFocusSession.session.sourceRuleType,
    sourceRuleName: activeFocusSession.session.sourceRuleName,
    at,
  });

  const [activityHistory, activityQueue] = await Promise.all([
    getActivityHistory(),
    getActivitySessionQueue(),
  ]);

  const nextHistory = upserted.finalized
    ? trimActivityHistory([...activityHistory, upserted.finalized])
    : activityHistory;
  const nextQueue = upserted.finalized ? [...activityQueue, upserted.finalized] : activityQueue;
  const nextLastProductiveAt =
    activityClass === 'aligned' || activityClass === 'supportive'
      ? at
      : activeFocusSession.lastProductiveAt;

  await Promise.all([
    setActivityHistory(nextHistory),
    setActivitySessionQueue(nextQueue),
    setActiveActivitySession(upserted.current),
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
  const [activeFocusSession, activeActivitySession, activityHistory, activityQueue, focusHistory, focusQueue] =
    await Promise.all([
      getActiveFocusSession(),
      getActiveActivitySession(),
      getActivityHistory(),
      getActivitySessionQueue(),
      getFocusSessionHistory(),
      getFocusSessionQueue(),
    ]);

  if (!activeFocusSession) {
    await setActiveActivitySession(null);
    return;
  }

  const finalizedActivity = finalizeActivitySession(activeActivitySession, at);
  const nextActivityHistory = finalizedActivity
    ? trimActivityHistory([...activityHistory, finalizedActivity])
    : activityHistory;
  const nextActivityQueue = finalizedActivity
    ? [...activityQueue, finalizedActivity]
    : activityQueue;
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

  await Promise.all([
    setActivityHistory(nextActivityHistory),
    setActivitySessionQueue(nextActivityQueue),
    setFocusSessionHistory(nextFocusHistory),
    setFocusSessionQueue(nextFocusQueue),
    setActiveActivitySession(null),
    setActiveFocusSession(null),
  ]);
}

async function refreshLocalAnalyticsSnapshot(): Promise<void> {
  const [taskTags, focusHistory, activeFocusSession, activeActivitySession, existingSnapshot, activityHistory] =
    await Promise.all([
      getTaskTags(),
      getFocusSessionHistory(),
      getActiveFocusSession(),
      getActiveActivitySession(),
      getAnalyticsSnapshot(),
      getActivityHistory(),
    ]);

  const currentSession = activeFocusSession
    ? summarizeFocusSession(
        {
          ...activeFocusSession.session,
          endedAt: activeActivitySession?.endedAt ?? new Date().toISOString(),
        },
        activeActivitySession
          ? [...activityHistory, activeActivitySession as ActivitySessionRecord]
          : activityHistory,
        activeFocusSession.lastProductiveAt,
      )
    : null;

  const next = buildAnalyticsSnapshot({
    taskTags,
    focusHistory,
    currentSession,
    currentActivityClass: activeActivitySession?.activityClass ?? null,
    lastCalculatedAt: new Date().toISOString(),
    lastSyncedAt: existingSnapshot.lastSyncedAt,
  });

  await setAnalyticsSnapshot(next);
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
