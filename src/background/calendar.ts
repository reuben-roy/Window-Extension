import {
  getCalendarState,
  getEventRules,
  getGlobalAllowlist,
  getKeywordRules,
  getSettings,
  setCalendarState,
} from '../shared/storage';
import {
  type CalendarColorDefinition,
  resolveCalendarEventColors,
} from '../shared/calendarColors';
import type {
  ActiveRuleSource,
  CalendarEvent,
  CalendarState,
  EventRule,
  KeywordRule,
  Settings,
} from '../shared/types';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

interface ResolvedRule {
  event: CalendarEvent;
  domains: string[];
  source: Exclude<ActiveRuleSource, 'none'>;
  name: string;
}

export function getAuthToken(interactive: boolean = false): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message ?? 'getAuthToken returned no token'));
      } else {
        resolve(token);
      }
    });
  });
}

export function revokeAuthToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

export async function syncCalendar(): Promise<CalendarState> {
  const [eventRules, keywordRules, globalAllowlist, settings] = await Promise.all([
    getEventRules(),
    getKeywordRules(),
    getGlobalAllowlist(),
    getSettings(),
  ]);

  let token: string;
  try {
    token = await getAuthToken(false);
  } catch (err) {
    return persistError(`Auth failed: ${String(err)}`);
  }

  let events: CalendarEvent[];
  try {
    events = await fetchTodaysEvents(token);
  } catch (err) {
    if (err instanceof CalendarAuthError) {
      await revokeAuthToken(token);
      try {
        token = await getAuthToken(false);
        events = await fetchTodaysEvents(token);
      } catch (retryErr) {
        return persistError(`Auth retry failed: ${String(retryErr)}`);
      }
    } else {
      return persistError(`Calendar fetch failed: ${String(err)}`);
    }
  }

  const state = resolveActiveState(events, eventRules, keywordRules, globalAllowlist, settings);
  await setCalendarState(state);
  return state;
}

export function getAllActiveEvents(events: CalendarEvent[]): CalendarEvent[] {
  const now = Date.now();
  return events.filter((event) => {
    const start = new Date(event.start).getTime();
    const end = new Date(event.end).getTime();
    return now >= start && now < end;
  });
}

export function getCurrentEvent(events: CalendarEvent[]): CalendarEvent | null {
  return getAllActiveEvents(events)[0] ?? null;
}

export function findMatchingKeywordRule(
  eventTitle: string,
  keywordRules: KeywordRule[],
): KeywordRule | null {
  const lowerTitle = eventTitle.toLowerCase();
  const matches = keywordRules.filter((rule) => lowerTitle.includes(rule.keyword.toLowerCase()));

  if (matches.length === 0) return null;

  return [...matches].sort((a, b) => {
    const lengthDiff = b.keyword.length - a.keyword.length;
    if (lengthDiff !== 0) return lengthDiff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  })[0];
}

export function resolveRuleForEvent(
  event: CalendarEvent,
  eventRules: EventRule[],
  keywordRules: KeywordRule[],
  settings: Settings,
): ResolvedRule | null {
  const exactRule = eventRules.find((rule) => rule.eventTitle === event.title);
  if (exactRule) {
    return {
      event,
      domains: exactRule.domains,
      source: 'event',
      name: exactRule.eventTitle,
    };
  }

  if (!settings.keywordAutoMatchEnabled) return null;

  const keywordRule = findMatchingKeywordRule(event.title, keywordRules);
  if (!keywordRule) return null;

  return {
    event,
    domains: keywordRule.domains,
    source: 'keyword',
    name: keywordRule.keyword,
  };
}

export function resolveActiveState(
  events: CalendarEvent[],
  eventRules: EventRule[],
  keywordRules: KeywordRule[],
  globalAllowlist: string[],
  settings: Settings,
): CalendarState {
  const allActiveEvents = getAllActiveEvents(events);
  const recentEventTitles = [...new Set(events.map((event) => event.title.trim()).filter(Boolean))];
  const matched = allActiveEvents
    .map((event) => resolveRuleForEvent(event, eventRules, keywordRules, settings))
    .filter((rule): rule is ResolvedRule => rule !== null);

  if (matched.length === 0) {
    return {
      currentEvent: allActiveEvents[0] ?? null,
      allActiveEvents,
      todaysEvents: events,
      activeProfile: null,
      activeRuleSource: 'none',
      activeRuleName: null,
      allowedDomains: [],
      recentEventTitles,
      isRestricted: false,
      lastSyncedAt: new Date().toISOString(),
      authError: null,
    };
  }

  const intersectedDomains = matched
    .map((rule) => rule.domains)
    .reduce((acc, list, index) => {
      if (index === 0) return [...list];
      return acc.filter((domain) => list.includes(domain));
    }, [] as string[]);
  const allowedDomains = [...new Set([...intersectedDomains, ...globalAllowlist])];
  const primary = matched[0];

  return {
    currentEvent: primary.event,
    allActiveEvents,
    todaysEvents: events,
    activeProfile: primary.name,
    activeRuleSource: primary.source,
    activeRuleName: primary.name,
    allowedDomains,
    recentEventTitles,
    isRestricted: settings.enableBlocking,
    lastSyncedAt: new Date().toISOString(),
    authError: null,
  };
}

class CalendarAuthError extends Error {
  constructor() {
    super('Calendar API returned 401 — token revoked or expired');
  }
}

async function fetchTodaysEvents(token: string): Promise<CalendarEvent[]> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  return fetchCalendarEventsInRange(token, startOfDay, endOfDay);
}

export async function fetchCalendarEventsInRange(
  token: string,
  timeMin: string,
  timeMax: string,
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
  });

  const [data, eventPalette] = await Promise.all([
    fetchCalendarEventItems(token, params),
    fetchGoogleEventColorPalette(token).catch((error) => {
      if (error instanceof CalendarAuthError) throw error;
      console.warn('[Window] Failed to fetch Google Calendar color palette:', error);
      return {};
    }),
  ]);

  return (data.items ?? []).flatMap((raw) => normalizeEvent(raw, eventPalette));
}

async function fetchCalendarEventItems(
  token: string,
  params: URLSearchParams,
): Promise<{ items?: GoogleCalendarEventRaw[] }> {
  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/primary/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (res.status === 401) throw new CalendarAuthError();
  if (!res.ok) throw new Error(`Calendar API error: ${res.status} ${res.statusText}`);

  return (await res.json()) as { items?: GoogleCalendarEventRaw[] };
}

async function fetchGoogleEventColorPalette(
  token: string,
): Promise<Record<string, CalendarColorDefinition>> {
  const res = await fetch(`${CALENDAR_API_BASE}/colors`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) throw new CalendarAuthError();
  if (!res.ok) throw new Error(`Google Calendar colors error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as GoogleCalendarColorsResponse;
  return data.event ?? {};
}

interface GoogleCalendarEventRaw {
  id: string;
  colorId?: string;
  recurringEventId?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  recurrence?: string[];
}

interface GoogleCalendarColorsResponse {
  event?: Record<string, CalendarColorDefinition>;
}

function normalizeEvent(
  raw: GoogleCalendarEventRaw,
  eventPalette: Record<string, CalendarColorDefinition>,
): CalendarEvent[] {
  const title = raw.summary ?? '(No title)';
  const recurrenceHint = raw.recurringEventId || raw.recurrence?.length ? 'Recurring event' : null;
  const colors = resolveCalendarEventColors(title, raw.colorId, eventPalette);

  if (raw.start?.dateTime && raw.end?.dateTime) {
    return [
      {
        id: raw.id,
        title,
        start: raw.start.dateTime,
        end: raw.end.dateTime,
        isAllDay: false,
        googleColorId: colors.googleColorId,
        backgroundColor: colors.backgroundColor,
        foregroundColor: colors.foregroundColor,
        colorSource: colors.colorSource,
        recurringEventId: raw.recurringEventId,
        recurrenceHint,
      },
    ];
  }

  if (raw.start?.date && raw.end?.date) {
    return [
      {
        id: raw.id,
        title,
        start: localMidnightToISOString(raw.start.date),
        end: localMidnightToISOString(raw.end.date),
        isAllDay: true,
        googleColorId: colors.googleColorId,
        backgroundColor: colors.backgroundColor,
        foregroundColor: colors.foregroundColor,
        colorSource: colors.colorSource,
        recurringEventId: raw.recurringEventId,
        recurrenceHint,
      },
    ];
  }

  return [];
}

function localMidnightToISOString(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toISOString();
}

async function persistError(error: string): Promise<CalendarState> {
  const prev = await getCalendarState();
  const state: CalendarState = {
    currentEvent: prev.currentEvent,
    allActiveEvents: prev.allActiveEvents,
    todaysEvents: prev.todaysEvents,
    activeProfile: prev.activeProfile,
    activeRuleSource: prev.activeRuleSource,
    activeRuleName: prev.activeRuleName,
    allowedDomains: prev.allowedDomains,
    recentEventTitles: prev.recentEventTitles,
    isRestricted: false,
    lastSyncedAt: prev.lastSyncedAt,
    authError: error,
  };
  await setCalendarState(state);
  return state;
}
