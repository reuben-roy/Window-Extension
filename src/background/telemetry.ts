import {
  finalizeBreakVisits,
  parseDomainFromUrl,
  upsertBreakVisit,
} from '../shared/assistant';
import {
  getActiveBreakVisits,
  getBreakVisitQueue,
  getCalendarState,
  getSettings,
  setActiveBreakVisits,
  setBreakVisitQueue,
} from '../shared/storage';
import { isSnoozeActive } from './snooze';

export function registerTelemetryListeners(): void {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
      void recordBreakVisitFromUrl(changeInfo.url, tabId);
    }
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    void recordActiveTabVisit(tabId);
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void finalizeBreakVisitForTab(tabId);
  });

  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId === 0) {
      void recordBreakVisitFromUrl(details.url, details.tabId);
    }
  });
}

export async function finalizeTrackedBreakVisits(): Promise<void> {
  const [activeBreakVisits, queue] = await Promise.all([
    getActiveBreakVisits(),
    getBreakVisitQueue(),
  ]);
  const finalized = finalizeBreakVisits(activeBreakVisits, new Date().toISOString());
  if (finalized.length === 0) return;

  await Promise.all([
    setActiveBreakVisits({}),
    setBreakVisitQueue([...queue, ...finalized]),
  ]);
}

async function recordActiveTabVisit(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) {
      await recordBreakVisitFromUrl(tab.url, tabId);
    }
  } catch {
    // Ignore tabs that disappear mid-lookup.
  }
}

async function recordBreakVisitFromUrl(url: string, tabId: number): Promise<void> {
  if (!(await shouldTrackBreakTelemetry())) return;

  const domain = parseDomainFromUrl(url);
  if (!domain) return;

  const [activeBreakVisits, queue, calendarState] = await Promise.all([
    getActiveBreakVisits(),
    getBreakVisitQueue(),
    getCalendarState(),
  ]);
  const now = new Date().toISOString();
  const { nextVisits, finalizedVisit } = upsertBreakVisit(
    activeBreakVisits,
    tabId,
    domain,
    calendarState.currentEvent?.title ?? null,
    now,
  );

  await setActiveBreakVisits(nextVisits);

  if (finalizedVisit) {
    await setBreakVisitQueue([...queue, finalizedVisit]);
  }
}

async function finalizeBreakVisitForTab(tabId: number): Promise<void> {
  const activeBreakVisits = await getActiveBreakVisits();
  const key = String(tabId);
  const current = activeBreakVisits[key];
  if (!current) return;

  const queue = await getBreakVisitQueue();
  const { [key]: _removed, ...rest } = activeBreakVisits;
  await Promise.all([
    setActiveBreakVisits(rest),
    setBreakVisitQueue([...queue, { ...current, endedAt: new Date().toISOString() }]),
  ]);
}

async function shouldTrackBreakTelemetry(): Promise<boolean> {
  const [settings, snoozed] = await Promise.all([
    getSettings(),
    isSnoozeActive(),
  ]);
  return settings.breakTelemetryEnabled && snoozed;
}
