import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import type {
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventMountArg,
} from '@fullcalendar/core';
import { removeEventRule, removeKeywordRule, upsertEventRule, upsertKeywordRule } from '../shared/eventRules';
import { addToGlobalAllowlist, removeFromGlobalAllowlist } from '../shared/profiles';
import { deriveDifficultyRank } from '../shared/analytics';
import {
  formatBlockingPauseTimeLabel,
  isDailyBlockingPauseActive,
} from '../shared/blockingSchedule';
import AccountStatusControl from '../shared/components/AccountStatusControl';
import CompactSettingRow from '../shared/components/CompactSettingRow';
import InfoTip from '../shared/components/InfoTip';
import SettingsGroup from '../shared/components/SettingsGroup';
import {
  getAccountConflict,
  getAccountSyncState,
  getAccountUser,
  getAnalyticsSnapshot,
  getCalendarState,
  getEventLaunchTargets,
  getEventRules,
  getGlobalAllowlist,
  getKeywordRules,
  getSettings,
  getTaskTags,
  setSettings,
} from '../shared/storage';
import { isRedundantExactRuleCopy } from '../shared/ruleResolution';
import {
  findEventLaunchTarget,
  removeEventLaunchTarget,
  upsertEventLaunchTarget,
} from '../shared/launchTargets';
import { findTaskTag, inferTaskTagKeyFromTitle } from '../shared/tags';
import type {
  AccountConflict,
  AccountSyncState,
  AccountUser,
  AnalyticsSnapshot,
  BreakDurationMinutes,
  CalendarEvent,
  CalendarState,
  DifficultyRank,
  DownloadRedirectFallbackSeconds,
  EventLaunchTarget,
  EventRule,
  FocusSessionRecord,
  KeywordRule,
  Settings,
  TaskTag,
} from '../shared/types';

type CalendarView = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay';
type TooltipMode = 'anchored' | 'modal';
type TooltipPlacement = 'top' | 'bottom';

interface ResolvedWorkspaceEvent {
  event: CalendarEvent;
  source: 'event' | 'keyword' | 'none' | 'override';
  ruleName: string | null;
  domains: string[];
  effectiveDomains: string[];
  tagKey: string | null;
  difficultyRank: DifficultyRank | null;
  fallbackKeyword: string | null;
}

interface SelectedTooltipState {
  eventId: string;
  anchorRect: DOMRect;
}

interface DownloadRescueToggleConfig {
  key:
    | 'downloadRedirectProgrammaticDownloadEnabled'
    | 'downloadRedirectUseDownloadsApi'
    | 'downloadRedirectFallbackPatternMatchEnabled'
    | 'downloadRedirectFallbackSameHostEnabled'
    | 'downloadRedirectFallbackSameSiteEnabled'
    | 'downloadRedirectFallbackAnyAllowedRedirectEnabled'
    | 'downloadRedirectAllowAcrossTabsEnabled';
  title: string;
  description: string;
}

const TOOLTIP_WIDTH = 392;
const TOOLTIP_HEIGHT = 688;
const TOOLTIP_MARGIN = 20;
const DOWNLOAD_RESCUE_MAX_PATCH: Partial<Settings> = {
  downloadRedirectUseDownloadsApi: true,
  downloadRedirectFallbackPatternMatchEnabled: true,
  downloadRedirectFallbackSameHostEnabled: true,
  downloadRedirectFallbackSameSiteEnabled: true,
  downloadRedirectFallbackAnyAllowedRedirectEnabled: true,
  downloadRedirectAllowAcrossTabsEnabled: true,
  downloadRedirectProgrammaticDownloadEnabled: true,
};
const DOWNLOAD_RESCUE_BALANCED_PATCH: Partial<Settings> = {
  downloadRedirectUseDownloadsApi: true,
  downloadRedirectFallbackPatternMatchEnabled: true,
  downloadRedirectFallbackSameHostEnabled: true,
  downloadRedirectFallbackSameSiteEnabled: true,
  downloadRedirectFallbackAnyAllowedRedirectEnabled: false,
  downloadRedirectAllowAcrossTabsEnabled: false,
  downloadRedirectProgrammaticDownloadEnabled: true,
};
const DOWNLOAD_RESCUE_TOGGLES: DownloadRescueToggleConfig[] = [
  {
    key: 'downloadRedirectProgrammaticDownloadEnabled',
    title: 'Programmatic download handoff',
    description: "Start likely downloads through Chrome's downloads API instead of replaying the blocked page navigation.",
  },
  {
    key: 'downloadRedirectUseDownloadsApi',
    title: 'Use downloads API',
    description: 'Trust real Chrome download events and keep the host open until the download settles.',
  },
  {
    key: 'downloadRedirectFallbackPatternMatchEnabled',
    title: 'Pattern match download URLs',
    description: 'Fallback when the blocked URL looks like a file or download endpoint.',
  },
  {
    key: 'downloadRedirectFallbackSameHostEnabled',
    title: 'Allow same-host redirects',
    description: 'Fallback when the blocked redirect stays on the same host family as the source page.',
  },
  {
    key: 'downloadRedirectFallbackSameSiteEnabled',
    title: 'Allow same-site redirects',
    description: 'Fallback when the blocked redirect stays on the same site, even across subdomains.',
  },
  {
    key: 'downloadRedirectFallbackAnyAllowedRedirectEnabled',
    title: 'Allow any redirect from allowed pages',
    description: 'Most aggressive fallback. Useful for signed CDN links that do not look like downloads.',
  },
  {
    key: 'downloadRedirectAllowAcrossTabsEnabled',
    title: 'Allow across tabs',
    description: 'Do not scope the short-lived rescue to a single tab. Helpful when downloads open a new tab or window.',
  },
];

export default function Options(): React.JSX.Element {
  const calendarRef = useRef<FullCalendar | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [calendarState, setCalendarState] = useState<CalendarState | null>(null);
  const [analyticsSnapshot, setAnalyticsSnapshotState] = useState<AnalyticsSnapshot | null>(null);
  const [visibleEvents, setVisibleEvents] = useState<CalendarEvent[]>([]);
  const [hasLoadedVisibleRange, setHasLoadedVisibleRange] = useState(false);
  const [settings, setLocalSettings] = useState<Settings | null>(null);
  const [eventRules, setLocalEventRules] = useState<EventRule[]>([]);
  const [eventLaunchTargets, setEventLaunchTargetsState] = useState<EventLaunchTarget[]>([]);
  const [keywordRules, setLocalKeywordRules] = useState<KeywordRule[]>([]);
  const [taskTags, setTaskTagsState] = useState<TaskTag[]>([]);
  const [calendarView, setCalendarView] = useState<CalendarView>('timeGridWeek');
  const [calendarTitle, setCalendarTitle] = useState('');
  const [surfaceTab, setSurfaceTab] = useState<'workspace' | 'analytics'>('workspace');
  const [selectedTooltip, setSelectedTooltip] = useState<SelectedTooltipState | null>(null);
  const [tooltipMode, setTooltipMode] = useState<TooltipMode>('anchored');
  const [tooltipPlacement, setTooltipPlacement] = useState<TooltipPlacement>('bottom');
  const [accountUser, setAccountUserState] = useState<AccountUser | null>(null);
  const [accountSyncState, setAccountSyncStateState] = useState<AccountSyncState | null>(null);
  const [accountConflict, setAccountConflictState] = useState<AccountConflict | null>(null);
  const [keyword, setKeyword] = useState('');
  const [keywordDomains, setKeywordDomains] = useState('');
  const [keywordTagKey, setKeywordTagKey] = useState<string>('');
  const [keywordError, setKeywordError] = useState('');
  const [globalAllowlist, setGlobalAllowlistState] = useState<string[]>([]);
  const [globalDomainInput, setGlobalDomainInput] = useState('');
  const [globalAllowlistError, setGlobalAllowlistError] = useState('');
  const [savingRule, setSavingRule] = useState(false);

  const loadVisibleRange = useCallback((start: string, end: string) => {
    chrome.runtime.sendMessage(
      {
        type: 'GET_CALENDAR_EVENTS_RANGE',
        payload: { start, end },
      },
      (response: { ok: boolean; events?: CalendarEvent[] }) => {
        if (chrome.runtime.lastError) {
          console.warn('[Window] Failed to load calendar range:', chrome.runtime.lastError.message);
          setVisibleEvents((prev) => (prev.length > 0 ? prev : calendarState?.todaysEvents ?? []));
          return;
        }

        if (response?.ok && response.events) {
          setVisibleEvents(response.events);
          setHasLoadedVisibleRange(true);
        } else {
          console.warn('[Window] Calendar range request returned no events payload.');
          setVisibleEvents((prev) => (prev.length > 0 ? prev : calendarState?.todaysEvents ?? []));
        }
      },
    );
  }, [calendarState?.todaysEvents]);

  const loadData = async () => {
    const [
      calendar,
      nextSettings,
      nextEventRules,
      nextEventLaunchTargets,
      nextKeywordRules,
      nextTaskTags,
      nextAnalyticsSnapshot,
      nextGlobalAllowlist,
      nextAccountUser,
      nextAccountSyncState,
      nextAccountConflict,
    ] = await Promise.all([
      getCalendarState(),
      getSettings(),
      getEventRules(),
      getEventLaunchTargets(),
      getKeywordRules(),
      getTaskTags(),
      getAnalyticsSnapshot(),
      getGlobalAllowlist(),
      getAccountUser(),
      getAccountSyncState(),
      getAccountConflict(),
    ]);
    setCalendarState(calendar);
    setLocalSettings(nextSettings);
    setLocalEventRules(nextEventRules);
    setEventLaunchTargetsState(nextEventLaunchTargets);
    setLocalKeywordRules(nextKeywordRules);
    setTaskTagsState(nextTaskTags);
    setAnalyticsSnapshotState(nextAnalyticsSnapshot);
    setGlobalAllowlistState(nextGlobalAllowlist);
    setAccountUserState(nextAccountUser);
    setAccountSyncStateState(nextAccountSyncState);
    setAccountConflictState(nextAccountConflict);
    setVisibleEvents((prev) => {
      if (!calendar.lastSyncedAt || calendar.authError) {
        return [];
      }
      return prev.length > 0 ? prev : calendar.todaysEvents;
    });
  };

  useEffect(() => {
    loadData();
    void sendMessageAsync({ type: 'REFRESH_ACCOUNT_STATE' }).catch(() => undefined);
    void sendMessageAsync({ type: 'REFRESH_ANALYTICS_STATE' }).catch(() => undefined);
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (
        'calendarState' in changes ||
        'settings' in changes ||
        'eventRules' in changes ||
        'eventLaunchTargets' in changes ||
        'keywordRules' in changes ||
        'taskTags' in changes ||
        'analyticsSnapshot' in changes ||
        'globalAllowlist' in changes ||
        'accountUser' in changes ||
        'accountSyncState' in changes ||
        'accountConflict' in changes ||
        'backendSession' in changes
      ) {
        loadData();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const isConnected =
    calendarState !== null &&
    calendarState.lastSyncedAt !== null &&
    calendarState.authError === null;

  useEffect(() => {
    if (!isConnected) {
      setVisibleEvents([]);
      setHasLoadedVisibleRange(false);
      return;
    }
    const api = calendarApi();
    if (!api) return;
    loadVisibleRange(api.view.activeStart.toISOString(), api.view.activeEnd.toISOString());
  }, [isConnected, calendarView, loadVisibleRange]);

  const todaysEvents = calendarState?.todaysEvents ?? [];

  const workspaceSourceEvents = hasLoadedVisibleRange
    ? visibleEvents
    : visibleEvents.length > 0
      ? visibleEvents
      : todaysEvents;
  const recentAnalyticsSessions = analyticsSnapshot?.recentSessions ?? [];

  const workspaceEvents = useMemo(
    () =>
      workspaceSourceEvents.map((event) =>
        resolveWorkspaceEvent(event, eventRules, keywordRules, taskTags, recentAnalyticsSessions, settings),
      ),
    [workspaceSourceEvents, eventRules, keywordRules, recentAnalyticsSessions, settings, taskTags],
  );

  const selectedResolvedEvent = selectedTooltip
    ? workspaceEvents.find((item) => item.event.id === selectedTooltip.eventId) ?? null
    : null;
  const selectedEventLaunchTarget = selectedResolvedEvent
    ? findEventLaunchTarget(selectedResolvedEvent.event.id, eventLaunchTargets)
    : null;

  const nextEvent = useMemo(() => {
    const now = Date.now();
    return todaysEvents
      .filter((event) => new Date(event.start).getTime() > now)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0] ?? null;
  }, [todaysEvents]);

  const activeEvent = calendarState?.currentEvent ?? null;
  const quietHoursActive = settings ? isDailyBlockingPauseActive(new Date(), settings) : false;
  const downloadRescueRows = DOWNLOAD_RESCUE_TOGGLES.map((toggle) => ({
    ...toggle,
    checked: settings ? settings[toggle.key] : false,
  }));

  useEffect(() => {
    if (!selectedTooltip) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedTooltip(null);
      }
    };

    const handlePointerDown = (event: MouseEvent) => {
      if (!tooltipRef.current) return;
      const target = event.target as Node | null;
      if (target && !tooltipRef.current.contains(target)) {
        setSelectedTooltip(null);
      }
    };

    const refreshAnchor = () => {
      const anchor = document.querySelector<HTMLElement>(
        `[data-window-event-id="${selectedTooltip.eventId}"]`,
      );
      if (!anchor) {
        setSelectedTooltip(null);
        return;
      }
      const nextRect = anchor.getBoundingClientRect();
      setSelectedTooltip((current) =>
        current ? { ...current, anchorRect: nextRect } : current,
      );
      const positioning = chooseTooltipPosition(nextRect);
      setTooltipMode(positioning.mode);
      setTooltipPlacement(positioning.placement);
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', refreshAnchor);
    window.addEventListener('scroll', refreshAnchor, true);

    refreshAnchor();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', refreshAnchor);
      window.removeEventListener('scroll', refreshAnchor, true);
    };
  }, [selectedTooltip]);

  const updateSettings = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setLocalSettings(next);
    await setSettings(next);
  };

  const updateBlockingEnabled = (enabled: boolean) => {
    if (!settings) return;
    setLocalSettings({ ...settings, enableBlocking: enabled });
    chrome.runtime.sendMessage(
      { type: 'TOGGLE_BLOCKING', payload: { enabled } },
      () => {
        loadData();
      },
    );
  };

  const calendarApi = () => calendarRef.current?.getApi();

  const changeView = (view: CalendarView) => {
    setCalendarView(view);
    calendarApi()?.changeView(view);
  };

  const navigateCalendar = (direction: 'prev' | 'next' | 'today') => {
    const api = calendarApi();
    if (!api) return;
    if (direction === 'prev') api.prev();
    if (direction === 'next') api.next();
    if (direction === 'today') api.today();
    setCalendarTitle(api.view.title);
  };

  const handleDatesSet = (arg: DatesSetArg) => {
    setCalendarView(arg.view.type as CalendarView);
    setCalendarTitle(arg.view.title);
    loadVisibleRange(arg.start.toISOString(), arg.end.toISOString());
  };

  const openTooltipAtRect = useCallback((eventId: string, anchorRect: DOMRect) => {
    setSelectedTooltip({ eventId, anchorRect });
    const positioning = chooseTooltipPosition(anchorRect);
    setTooltipMode(positioning.mode);
    setTooltipPlacement(positioning.placement);
  }, []);

  const handleEventClick = (arg: EventClickArg) => {
    arg.jsEvent.preventDefault();
    openTooltipAtRect(arg.event.id, arg.el.getBoundingClientRect());
  };

  const saveKeywordRule = async () => {
    setKeywordError('');
    const result = await upsertKeywordRule(keyword, splitDomains(keywordDomains), {
      tagKey: keywordTagKey || null,
    });
    if (!result.ok) {
      setKeywordError(result.error ?? 'Unable to save keyword rule.');
      return;
    }
    setKeyword('');
    setKeywordDomains('');
    setKeywordTagKey('');
    await loadData();
  };

  const updateKeywordRuleTag = async (rule: KeywordRule, tagKey: string) => {
    await upsertKeywordRule(rule.keyword, rule.domains, {
      tagKey: tagKey || null,
    });
    await loadData();
  };

  const saveSessionOverride = async (
    focusSessionId: string,
    tagKey: string | null,
    difficultyRank: DifficultyRank | null,
  ) => {
    await sendMessageAsync({
      type: 'SAVE_ANALYTICS_OVERRIDE',
      payload: {
        focusSessionId,
        tagKey,
        difficultyRank,
      },
    });
    await loadData();
  };

  const addGlobalDomain = async () => {
    setGlobalAllowlistError('');
    const result = await addToGlobalAllowlist(globalDomainInput);
    if (!result.ok) {
      setGlobalAllowlistError(result.error ?? 'Unable to add domain.');
      return;
    }
    setGlobalDomainInput('');
  };

  if (!settings || !calendarState || !analyticsSnapshot) {
    return (
      <div className="fg-shell min-h-screen flex items-center justify-center">
        <div className="fg-card px-6 py-5 text-sm text-[var(--fg-muted)]">Loading calendar workspace…</div>
      </div>
    );
  }

  return (
    <div className="fg-shell min-h-screen">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--fg-border)] bg-white/70 px-3 py-1 text-xs font-medium text-[var(--fg-muted)] shadow-sm backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Window workspace
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-[var(--fg-text)]">
              Window
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-[var(--fg-muted)]">
              Keep focus controls compact and edit event-specific allowlists directly from the calendar.
            </p>
          </div>

          <div className="flex flex-wrap items-start justify-end gap-3">
            {accountSyncState && (
              <AccountStatusControl
                accountUser={accountUser}
                accountSyncState={accountSyncState}
                accountConflict={accountConflict}
                calendarState={calendarState}
                onSignIn={() =>
                  sendMessageAsync({ type: 'SIGN_IN_WITH_PROVIDER', payload: { provider: 'google' } }).then(loadData)
                }
                onRefresh={() =>
                  sendMessageAsync({ type: 'REFRESH_ACCOUNT_STATE' }).then(loadData)
                }
                onSignOut={() =>
                  sendMessageAsync({ type: 'SIGN_OUT_ACCOUNT' }).then(loadData)
                }
                onResolveConflict={(choice) =>
                  sendMessageAsync({ type: 'RESOLVE_ACCOUNT_CONFLICT', payload: { choice } }).then(loadData)
                }
                onConnectCalendar={() =>
                  sendMessageAsync({ type: 'CONNECT_CALENDAR' }).then(() => {
                    setSelectedTooltip(null);
                    return loadData();
                  })
                }
                onDisconnectCalendar={() =>
                  sendMessageAsync({ type: 'DISCONNECT_CALENDAR' }).then(() => {
                    setSelectedTooltip(null);
                    return loadData();
                  })
                }
              />
            )}
          </div>
        </header>

        <div className="mb-5 inline-flex rounded-[20px] border border-[var(--fg-border)] bg-white p-1 shadow-sm">
          <button
            onClick={() => setSurfaceTab('workspace')}
            className={surfaceTab === 'workspace' ? 'fg-segment-active' : 'fg-segment'}
          >
            Workspace
          </button>
          <button
            onClick={() => setSurfaceTab('analytics')}
            className={surfaceTab === 'analytics' ? 'fg-segment-active' : 'fg-segment'}
          >
            Analytics
          </button>
        </div>

        {surfaceTab === 'workspace' ? (
          <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr),340px]">
            <div className="fg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-[var(--fg-text)]">Focus controls</h2>
                    <InfoTip text="These are the quickest settings to understand the extension at a glance." />
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
                    Keep the essentials close, and let the calendar do the explaining.
                  </p>
                </div>
                <span className="rounded-full border border-[var(--fg-border)] bg-white px-3 py-1 text-[11px] font-medium text-[var(--fg-muted)]">
                  {isConnected ? 'Calendar connected' : 'Calendar disconnected'}
                </span>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                <CompactSettingRow
                  label="Blocking"
                  hint="Master switch for focus blocking."
                  value={
                    !settings.enableBlocking
                      ? 'Off'
                      : quietHoursActive
                        ? 'Paused'
                        : 'On'
                  }
                  meta={
                    quietHoursActive
                      ? `Daily cutoff active after ${formatBlockingPauseTimeLabel(settings.dailyBlockingPauseStartTime)}`
                      : 'Turns restriction rules on or off instantly.'
                  }
                  control={<Toggle checked={settings.enableBlocking} onChange={updateBlockingEnabled} />}
                />

                <CompactSettingRow
                  label="Break duration"
                  hint="Default duration used when starting a break."
                  value={`${settings.breakDurationMinutes} min`}
                  meta="Used by the blocked page and quick break actions."
                  control={
                    <select
                      value={settings.breakDurationMinutes}
                      onChange={(event) =>
                        updateSettings({
                          breakDurationMinutes: Number(event.target.value) as BreakDurationMinutes,
                        })
                      }
                      className="fg-select w-[112px] px-3 py-2 text-sm"
                    >
                      <option value={5}>5 min</option>
                      <option value={10}>10 min</option>
                      <option value={15}>15 min</option>
                    </select>
                  }
                />

                <CompactSettingRow
                  label="Active event"
                  hint="The focus block currently driving your allowed domains."
                  value={activeEvent ? truncate(activeEvent.title, 30) : 'No focus block live'}
                  meta={activeEvent ? formatEventRange(activeEvent) : 'Browsing is unrestricted until the next matching event.'}
                />

                <CompactSettingRow
                  label="Daily cutoff"
                  hint="After this time, blocking pauses for the rest of the day."
                  value={
                    settings.dailyBlockingPauseEnabled
                      ? formatBlockingPauseTimeLabel(settings.dailyBlockingPauseStartTime)
                      : 'Disabled'
                  }
                  meta={
                    settings.dailyBlockingPauseEnabled
                      ? 'Pauses restrictions nightly and resumes tomorrow.'
                      : 'Blocking stays available all day.'
                  }
                  control={
                    <div className="flex items-center gap-2">
                      <Toggle
                        checked={settings.dailyBlockingPauseEnabled}
                        onChange={(checked) =>
                          updateSettings({
                            dailyBlockingPauseEnabled: checked,
                          })
                        }
                      />
                      <input
                        type="time"
                        value={settings.dailyBlockingPauseStartTime}
                        disabled={!settings.dailyBlockingPauseEnabled}
                        onChange={(event) =>
                          updateSettings({
                            dailyBlockingPauseStartTime: event.target.value,
                          })
                        }
                        className="fg-input w-[116px] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </div>
                  }
                />

                <CompactSettingRow
                  label="Next event"
                  hint="The next focus block coming up on your calendar."
                  value={nextEvent ? truncate(nextEvent.title, 30) : 'Nothing upcoming'}
                  meta={nextEvent ? formatEventRange(nextEvent) : 'Today looks clear.'}
                />

                <CompactSettingRow
                  label="Download fallback"
                  hint="Retry window used only when a blocked download redirect needs a short assist."
                  value={`${settings.downloadRedirectFallbackSeconds}s`}
                  meta="Only affects rescue retries, not normal browsing."
                  control={
                    <select
                      value={settings.downloadRedirectFallbackSeconds}
                      onChange={(event) =>
                        updateSettings({
                          downloadRedirectFallbackSeconds: Number(event.target.value) as DownloadRedirectFallbackSeconds,
                        })
                      }
                      className="fg-select w-[124px] px-3 py-2 text-sm"
                    >
                      <option value={1}>1 second</option>
                      <option value={2}>2 seconds</option>
                      <option value={3}>3 seconds</option>
                      <option value={4}>4 seconds</option>
                      <option value={5}>5 seconds</option>
                    </select>
                  }
                />
              </div>
            </div>

            <SettingsGroup
              className="fg-card p-4"
              title="Advanced"
              subtitle="Secondary controls that support fallback matching and long-lived rules."
              hint="Low-frequency settings are grouped here so the calendar remains the main focus."
              collapsible
              defaultOpen={false}
            >
              <CompactSettingRow
                label="Keyword auto-match"
                hint="Only used when an event does not already have an exact Event Rule."
                value={settings.keywordAutoMatchEnabled ? 'On' : 'Off'}
                meta="Automatically checks your fallback keyword rules against unmatched events."
                control={
                  <Toggle
                    checked={settings.keywordAutoMatchEnabled}
                    onChange={(checked) => updateSettings({ keywordAutoMatchEnabled: checked })}
                  />
                }
              />

              <SettingsGroup
                className="rounded-[24px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-3"
                title="Global whitelist"
                subtitle={`${globalAllowlist.length} domain${globalAllowlist.length === 1 ? '' : 's'} always allowed`}
                hint="Domains here stay reachable even when an event-specific rule is active."
                collapsible
                defaultOpen={false}
                bodyClassName="mt-3 space-y-3"
              >
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={globalDomainInput}
                    onChange={(event) => {
                      setGlobalDomainInput(event.target.value);
                      setGlobalAllowlistError('');
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void addGlobalDomain();
                      }
                    }}
                    placeholder="accounts.google.com"
                    className="fg-input px-3 py-2.5"
                  />
                  <button onClick={addGlobalDomain} className="fg-button-primary px-4 py-2.5 text-sm">
                    Add
                  </button>
                </div>

                {globalAllowlistError ? (
                  <p className="text-xs text-rose-600">{globalAllowlistError}</p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {globalAllowlist.length > 0 ? (
                    globalAllowlist.map((domain) => (
                      <button
                        key={domain}
                        onClick={() => {
                          void removeFromGlobalAllowlist(domain);
                        }}
                        className="rounded-full border border-[var(--fg-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--fg-text)] transition hover:border-rose-200 hover:text-rose-600"
                        title={`Remove ${domain}`}
                      >
                        {domain} ×
                      </button>
                    ))
                  ) : (
                    <EmptyCard text="No globally whitelisted domains yet." />
                  )}
                </div>
              </SettingsGroup>

              <SettingsGroup
                className="rounded-[24px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-3"
                title="Download rescue"
                subtitle="Short-lived rules that help real downloads complete without opening browsing holes."
                hint="Use the preset buttons for testing, then fine-tune the individual rescue paths if needed."
                collapsible
                defaultOpen={false}
                bodyClassName="mt-3 space-y-3"
              >
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => updateSettings(DOWNLOAD_RESCUE_MAX_PATCH)}
                    className="fg-button-secondary px-3 py-2 text-xs"
                  >
                    Enable Every Rescue Path
                  </button>
                  <button
                    onClick={() => updateSettings(DOWNLOAD_RESCUE_BALANCED_PATCH)}
                    className="fg-button-ghost px-3 py-2 text-xs"
                  >
                    Reset To Balanced
                  </button>
                </div>

                <div className="grid gap-2">
                  {downloadRescueRows.map((toggle) => (
                    <CompactSettingRow
                      key={toggle.key}
                      label={toggle.title}
                      hint={toggle.description}
                      value={toggle.checked ? 'On' : 'Off'}
                      meta={toggle.description}
                      control={
                        <Toggle
                          checked={toggle.checked}
                          onChange={(checked) =>
                            updateSettings({ [toggle.key]: checked } as Partial<Settings>)
                          }
                        />
                      }
                    />
                  ))}
                </div>
              </SettingsGroup>

              <SettingsGroup
                className="rounded-[24px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-3"
                title="Keyword rules"
                subtitle={`${keywordRules.length} saved fallback rule${keywordRules.length === 1 ? '' : 's'}`}
                hint="Longest keyword match wins. Exact Event Rules always override these fallbacks."
                collapsible
                defaultOpen={false}
                bodyClassName="mt-3 space-y-3"
              >
                <div className="grid gap-3">
                  <input
                    type="text"
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="deep work"
                    className="fg-input"
                  />
                  <input
                    type="text"
                    value={keywordDomains}
                    onChange={(event) => setKeywordDomains(event.target.value)}
                    placeholder="github.com, docs.google.com"
                    className="fg-input"
                  />
                  <select
                    value={keywordTagKey}
                    onChange={(event) => setKeywordTagKey(event.target.value)}
                    className="fg-select"
                  >
                    <option value="">Link to a tag</option>
                    {taskTags.map((tag) => (
                      <option key={tag.key} value={tag.key}>
                        {tag.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-[var(--fg-muted)]">
                      Save a keyword, the domains it should unlock, and the tag it should feed when no exact rule exists.
                    </p>
                    <button onClick={saveKeywordRule} className="fg-button-primary px-4 py-2.5 text-sm">
                      Save Keyword Rule
                    </button>
                  </div>
                  {keywordError ? <p className="text-xs text-rose-600">{keywordError}</p> : null}
                </div>

                <div className="space-y-2">
                  {keywordRules.length === 0 ? (
                    <EmptyCard text="No keyword rules yet." />
                  ) : (
                    keywordRules.map((rule) => (
                      <KeywordRuleListItem
                        key={rule.keyword}
                        rule={rule}
                        taskTags={taskTags}
                        onTagChange={(tagKey) => {
                          void updateKeywordRuleTag(rule, tagKey);
                        }}
                        onDelete={async () => {
                          await removeKeywordRule(rule.keyword);
                          await loadData();
                        }}
                      />
                    ))
                  )}
                </div>
              </SettingsGroup>
            </SettingsGroup>
          </section>
        ) : null}

        {surfaceTab === 'workspace' ? (
          <>
            <section className="fg-card relative overflow-hidden p-5">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold tracking-[-0.02em] text-[var(--fg-text)]">
                    Calendar Workspace
                  </h2>
                  <InfoTip text="Click an event to edit its exact allowlist. Exact Event Rules override keyword fallbacks immediately." />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => navigateCalendar('today')} className="fg-button-secondary">
                    Today
                  </button>
                  <button onClick={() => navigateCalendar('prev')} className="fg-button-ghost">
                    Prev
                  </button>
                  <button onClick={() => navigateCalendar('next')} className="fg-button-ghost">
                    Next
                  </button>
                  <div className="ml-1 inline-flex rounded-2xl border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] p-1">
                    {(['dayGridMonth', 'timeGridWeek', 'timeGridDay'] as CalendarView[]).map((view) => (
                      <button
                        key={view}
                        onClick={() => changeView(view)}
                        className={calendarView === view ? 'fg-segment-active' : 'fg-segment'}
                      >
                        {view === 'dayGridMonth' ? 'Month' : view === 'timeGridWeek' ? 'Week' : 'Day'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-xl font-semibold tracking-[-0.03em] text-[var(--fg-text)]">
                  {calendarTitle || 'Today'}
                </p>
                <div className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
                  <LegendDot tone="emerald" label="Exact rule" />
                  <LegendDot tone="amber" label="Keyword fallback" />
                  <LegendDot tone="slate" label="Unrestricted" />
                </div>
              </div>

              {isConnected ? (
                <div className="fg-calendar-wrap">
                  <FullCalendar
                    ref={calendarRef}
                    plugins={[dayGridPlugin, timeGridPlugin]}
                    initialView={calendarView}
                    headerToolbar={false}
                    height="auto"
                    dayMaxEvents={3}
                    events={workspaceEvents.map((item) => ({
                      ...calendarEventAppearance(item.event),
                      id: item.event.id,
                      title: item.event.title,
                      start: item.event.start,
                      end: item.event.end,
                      allDay: item.event.isAllDay,
                      extendedProps: {
                        ruleSource: item.source,
                        ruleName: item.ruleName,
                        domains: item.domains,
                        recurrenceHint: item.event.recurrenceHint,
                      },
                    }))}
                    datesSet={handleDatesSet}
                    eventClick={handleEventClick}
                eventDidMount={(arg: EventMountArg) => {
                  arg.el.dataset.windowEventId = arg.event.id;
                  arg.el.tabIndex = 0;
                  arg.el.style.cursor = 'pointer';
                  arg.el.onkeydown = (event: KeyboardEvent) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openTooltipAtRect(arg.event.id, arg.el.getBoundingClientRect());
                    }
                  };
                  if (selectedTooltip?.eventId === arg.event.id) {
                    arg.el.dataset.windowSelected = 'true';
                  } else {
                    delete arg.el.dataset.windowSelected;
                  }
                }}
                eventContent={(arg: EventContentArg) => (
                  <CalendarEventChip
                    eventId={arg.event.id}
                    title={arg.event.title}
                    timeText={arg.timeText}
                    backgroundColor={arg.event.backgroundColor}
                    foregroundColor={arg.event.textColor}
                    onQuickOpen={(eventId, element) => {
                      openTooltipAtRect(eventId, element.getBoundingClientRect());
                    }}
                  />
                )}
                  />
                </div>
              ) : (
                <div className="rounded-[28px] border border-dashed border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-8 py-12 text-center">
                  <p className="text-lg font-medium text-[var(--fg-text)]">Connect your calendar to unlock the workspace.</p>
                  <p className="mt-2 text-sm text-[var(--fg-muted)]">
                    Once connected, you’ll get a Google-Calendar-like view where each event can own its whitelist.
                  </p>
                </div>
              )}
            </section>

            <section className="mt-5">
              <div className="fg-card p-5">
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-[var(--fg-text)]">Exact Event Rules</h2>
                  <InfoTip text="These rules are created from the calendar tooltip and always take precedence over keyword fallback matches." />
                </div>
                <div className="space-y-2">
                  {eventRules.length === 0 ? (
                    <EmptyCard text="No Event Rules yet. Click an event in the calendar to start." />
                  ) : (
                    eventRules.map((rule) => (
                      <RuleListItem
                        key={rule.eventTitle}
                        title={rule.eventTitle}
                        subtitle={rule.domains.length === 0 ? 'Exact unrestricted override' : 'Exact title rule'}
                        domains={rule.domains}
                        tagLabel={taskTags.find((tag) => tag.key === rule.tagKey)?.label ?? null}
                        difficultyRank={rule.difficultyOverride}
                        isUnrestrictedOverride={rule.domains.length === 0}
                        onDelete={async () => {
                          await removeEventRule(rule.eventTitle);
                          await loadData();
                        }}
                      />
                    ))
                  )}
                </div>
              </div>
            </section>
          </>
        ) : (
          <AnalyticsWorkspace
            analyticsSnapshot={analyticsSnapshot}
            taskTags={taskTags}
            onRefresh={() => sendMessageAsync({ type: 'REFRESH_ANALYTICS_STATE' }).then(loadData)}
            onSaveOverride={saveSessionOverride}
          />
        )}
      </div>

      {selectedResolvedEvent && selectedTooltip && (
        <EventRuleTooltip
          key={selectedResolvedEvent.event.id}
          ref={tooltipRef}
          resolvedEvent={selectedResolvedEvent}
          launchTarget={selectedEventLaunchTarget}
          taskTags={taskTags}
          anchorRect={selectedTooltip.anchorRect}
          mode={tooltipMode}
          placement={tooltipPlacement}
          onClose={() => setSelectedTooltip(null)}
          onSaved={async () => {
            await loadData();
          }}
          savingRule={savingRule}
          onSavingChange={setSavingRule}
        />
      )}
    </div>
  );
}

const EventRuleTooltip = React.forwardRef<HTMLDivElement, {
  resolvedEvent: ResolvedWorkspaceEvent;
  launchTarget: EventLaunchTarget | null;
  taskTags: TaskTag[];
  anchorRect: DOMRect;
  mode: TooltipMode;
  placement: TooltipPlacement;
  onClose: () => void;
  onSaved: () => Promise<void>;
  savingRule: boolean;
  onSavingChange: (value: boolean) => void;
}>(
  (
    {
      resolvedEvent,
      launchTarget,
      taskTags,
      anchorRect,
      mode,
      placement,
      onClose,
      onSaved,
      savingRule,
      onSavingChange,
    },
    ref,
  ) => {
    const exactRuleExists = resolvedEvent.source === 'event' || resolvedEvent.source === 'override';
    const hasUnrestrictedOverride = resolvedEvent.source === 'override';
    const keywordFallbackActive = resolvedEvent.source === 'keyword';
    const startsInEditing = resolvedEvent.source === 'none';
    const currentDomainsValue = exactRuleExists ? resolvedEvent.domains.join(', ') : '';
    const currentEffectiveDomainsValue = resolvedEvent.effectiveDomains.join(', ');
    const currentLaunchUrlValue = launchTarget?.launchUrl ?? '';
    const displayedDomains = exactRuleExists ? resolvedEvent.domains : resolvedEvent.effectiveDomains;
    const canCopyFallbackDomains = keywordFallbackActive && resolvedEvent.effectiveDomains.length > 0;
    const [domainsInput, setDomainsInput] = useState(currentDomainsValue);
    const [launchUrlInput, setLaunchUrlInput] = useState(currentLaunchUrlValue);
    const [tagKey, setTagKey] = useState(resolvedEvent.tagKey ?? '');
    const [difficultyRank, setDifficultyRank] = useState<string>(
      resolvedEvent.difficultyRank ? String(resolvedEvent.difficultyRank) : '',
    );
    const [editing, setEditing] = useState(startsInEditing);
    const [editingLaunchTarget, setEditingLaunchTarget] = useState(false);
    const [error, setError] = useState('');
    const [launchError, setLaunchError] = useState('');
    const [savingLaunchTarget, setSavingLaunchTarget] = useState(false);
    const previousEventIdRef = useRef(resolvedEvent.event.id);

    // Only reset the draft when switching events. Background storage refreshes
    // happen often enough that syncing on every prop change can wipe mid-typing edits.
    useEffect(() => {
      if (previousEventIdRef.current === resolvedEvent.event.id) {
        return;
      }
      previousEventIdRef.current = resolvedEvent.event.id;
      setDomainsInput(currentDomainsValue);
      setLaunchUrlInput(currentLaunchUrlValue);
      setTagKey(resolvedEvent.tagKey ?? '');
      setDifficultyRank(resolvedEvent.difficultyRank ? String(resolvedEvent.difficultyRank) : '');
      setEditing(startsInEditing);
      setError('');
      setLaunchError('');
      setEditingLaunchTarget(false);
    }, [currentDomainsValue, currentLaunchUrlValue, resolvedEvent.difficultyRank, resolvedEvent.event.id, resolvedEvent.tagKey, startsInEditing]);

    const positioning = mode === 'modal'
      ? {
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }
      : {
          top:
            placement === 'bottom'
              ? `${Math.min(window.innerHeight - TOOLTIP_HEIGHT - TOOLTIP_MARGIN, anchorRect.bottom + 14)}px`
              : `${Math.max(TOOLTIP_MARGIN, anchorRect.top - TOOLTIP_HEIGHT - 14)}px`,
          left: `${clamp(anchorRect.left + anchorRect.width / 2 - TOOLTIP_WIDTH / 2, TOOLTIP_MARGIN, window.innerWidth - TOOLTIP_WIDTH - TOOLTIP_MARGIN)}px`,
          transform: 'none',
        };
    const saveAsUnrestricted = splitDomains(domainsInput).length === 0;
    const titleModeLabel =
      resolvedEvent.source === 'event'
        ? 'Exact Event Rule'
        : resolvedEvent.source === 'keyword'
          ? 'Keyword fallback'
          : resolvedEvent.source === 'override'
            ? 'Unrestricted override'
            : 'Unrestricted';
    const summaryTitle =
      resolvedEvent.source === 'event'
        ? `Using exact title rule “${resolvedEvent.ruleName}”`
        : resolvedEvent.source === 'keyword'
          ? `Using keyword fallback “${resolvedEvent.ruleName}”`
          : resolvedEvent.source === 'override'
            ? 'This title is explicitly unrestricted'
            : 'No exact rule yet';
    const summaryBody =
      resolvedEvent.source === 'event'
        ? 'Editing here updates the exact Event Rule used by every event with this title.'
        : resolvedEvent.source === 'keyword'
          ? 'These sites are coming from a keyword match. Create an exact rule only if this title should pin custom sites or stay unrestricted.'
          : resolvedEvent.source === 'override'
            ? resolvedEvent.fallbackKeyword
              ? `Keyword fallback “${resolvedEvent.fallbackKeyword}” is currently suppressed for this exact title.`
              : 'This exact-title override keeps the event unrestricted until you add allowed sites again.'
            : 'Browsing stays unrestricted unless you save allowed sites for this event title.';
    const saveButtonLabel = saveAsUnrestricted
      ? resolvedEvent.source === 'none'
        ? 'Keep Unrestricted'
        : hasUnrestrictedOverride
          ? 'Save Unrestricted Override'
          : 'Create Unrestricted Override'
      : exactRuleExists
        ? 'Save Rule'
        : 'Create Exact Rule';
    const unrestrictedBadgeLabel = saveAsUnrestricted
      ? resolvedEvent.source === 'none'
        ? 'Keeps unrestricted'
        : exactRuleExists
          ? 'Saves as unrestricted override'
          : 'Creates unrestricted override'
      : null;
    const editButtonLabel = exactRuleExists ? 'Edit' : keywordFallbackActive ? 'Create Rule' : 'Edit';
    const hasLaunchTarget = launchTarget !== null;
    const launchTargetHost = launchTarget ? safeHostname(launchTarget.launchUrl) : null;

    return (
      <>
        {mode === 'modal' ? (
          <div
            className="fixed inset-0 z-40 bg-[rgba(9,14,30,0.12)] backdrop-blur-[2px]"
            onClick={onClose}
          />
        ) : null}
        <div
          ref={ref}
          className={`fixed z-50 w-[min(392px,calc(100vw-24px))] rounded-[28px] border border-white/80 bg-[rgba(255,255,255,0.98)] p-5 shadow-[0_26px_80px_rgba(15,23,42,0.18)] ring-1 ring-[rgba(148,163,184,0.12)] ${
            mode === 'modal' ? 'max-h-[min(620px,calc(100vh-40px))] overflow-auto' : 'max-h-[min(620px,calc(100vh-32px))] overflow-auto'
          }`}
          style={positioning}
          role="dialog"
          aria-modal="true"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(148,163,184,0.25)] bg-[rgba(241,245,249,0.78)] px-2.5 py-1 text-[11px] font-semibold text-[var(--fg-muted)]">
                <span className={`h-2 w-2 rounded-full ${statusDot(resolvedEvent.source)}`} />
                {titleModeLabel}
              </div>
              <h3 className="text-[1.9rem] font-semibold tracking-[-0.04em] text-[var(--fg-text)]">
                {resolvedEvent.event.title}
              </h3>
              <p className="text-sm font-medium text-[var(--fg-muted)]">
                {formatTooltipDate(resolvedEvent.event)}
              </p>
              {resolvedEvent.event.recurrenceHint && (
                <p className="max-w-[30ch] text-xs leading-5 text-[var(--fg-muted)]">
                  {resolvedEvent.event.recurrenceHint}. Changes here apply to all events with this exact title.
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-full border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-1.5 text-sm font-medium text-[var(--fg-muted)] transition hover:bg-white hover:text-[var(--fg-text)]"
              aria-label="Close event rule editor"
            >
              Close
            </button>
          </div>

          <div className="mb-4 rounded-[22px] border border-[rgba(148,163,184,0.18)] bg-[linear-gradient(180deg,rgba(248,250,252,0.96),rgba(241,245,249,0.9))] px-4 py-3.5">
            <p className="text-sm font-medium text-[var(--fg-text)]">
              {summaryTitle}
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
              {summaryBody}
            </p>
          </div>

          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-[22px] border border-[rgba(148,163,184,0.16)] bg-[var(--fg-panel-soft)] px-4 py-3">
                <p className="text-sm font-medium text-[var(--fg-text)]">Primary tag</p>
                <select
                  value={tagKey}
                  onChange={(event) => setTagKey(event.target.value)}
                  disabled={!editing}
                  className="fg-select mt-2 w-full disabled:cursor-not-allowed disabled:bg-[rgba(248,250,252,0.92)] disabled:text-[var(--fg-muted)]"
                >
                  <option value="">No explicit tag</option>
                  {taskTags.map((tag) => (
                    <option key={tag.key} value={tag.key}>
                      {tag.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[var(--fg-muted)]">
                  Exact rules can pin a tag instead of relying on keyword inference.
                </p>
              </div>

              <div className="rounded-[22px] border border-[rgba(148,163,184,0.16)] bg-[var(--fg-panel-soft)] px-4 py-3">
                <p className="text-sm font-medium text-[var(--fg-text)]">Difficulty</p>
                <select
                  value={difficultyRank}
                  onChange={(event) => setDifficultyRank(event.target.value)}
                  disabled={!editing}
                  className="fg-select mt-2 w-full disabled:cursor-not-allowed disabled:bg-[rgba(248,250,252,0.92)] disabled:text-[var(--fg-muted)]"
                >
                  <option value="">Auto from tag and history</option>
                  <option value="1">1 · Routine</option>
                  <option value="2">2 · Light</option>
                  <option value="3">3 · Standard</option>
                  <option value="5">5 · Demanding</option>
                  <option value="8">8 · Deep</option>
                </select>
                <p className="text-xs text-[var(--fg-muted)]">
                  Use an exact override only when this block is consistently easier or harder than the tag default.
                </p>
              </div>
            </div>

            <div className="rounded-[24px] border border-[rgba(148,163,184,0.16)] bg-white px-4 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[var(--fg-text)]">Allowed sites</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                    Leave this empty to keep this event unrestricted, even if a keyword fallback matches.
                  </p>
                </div>
              {!editing && (
                <button
                  onClick={() => {
                    setDomainsInput(currentDomainsValue);
                    setError('');
                    setEditing(true);
                  }}
                  className="fg-button-ghost"
                >
                  {editButtonLabel}
                </button>
              )}
              </div>

              {editing ? (
                <>
                {canCopyFallbackDomains ? (
                  <div className="mb-3 rounded-[20px] border border-[rgba(59,130,246,0.14)] bg-[rgba(239,246,255,0.78)] px-3.5 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="max-w-[22rem]">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-700">
                          Current keyword fallback
                        </p>
                        <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                          These sites are active now through the keyword rule. Copy them only if you want to pin this exact title to the same list.
                        </p>
                      </div>
                      <button
                        onClick={() => setDomainsInput(currentEffectiveDomainsValue)}
                        className="rounded-full border border-[rgba(59,130,246,0.18)] bg-white px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:border-[rgba(59,130,246,0.26)] hover:bg-sky-50"
                      >
                        Copy current sites
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {resolvedEvent.effectiveDomains.map((domain) => (
                        <span
                          key={domain}
                          className="rounded-full border border-[rgba(148,163,184,0.2)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--fg-text)]"
                        >
                          {domain}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                <textarea
                  rows={4}
                  value={domainsInput}
                  onChange={(event) => setDomainsInput(event.target.value)}
                  className="fg-input min-h-[132px] resize-none"
                  placeholder="github.com, claude.ai, docs.google.com"
                  autoFocus
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs leading-5 text-[var(--fg-muted)]">
                    Enter domains separated by commas. Subdomains are allowed automatically by the block rule.
                  </p>
                  {unrestrictedBadgeLabel ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                      {unrestrictedBadgeLabel}
                    </span>
                  ) : null}
                </div>
                {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        setError('');
                        onSavingChange(true);
                        const result = await upsertEventRule(
                          resolvedEvent.event.title,
                          splitDomains(domainsInput),
                          {
                            tagKey: tagKey || null,
                            difficultyOverride: parseDifficultyRank(difficultyRank),
                          },
                        );
                        onSavingChange(false);
                        if (!result.ok) {
                          setError(result.error ?? 'Unable to save Event Rule.');
                          return;
                        }
                        setEditing(false);
                        await onSaved();
                      }}
                      disabled={savingRule}
                      className="fg-button-primary"
                    >
                      {savingRule ? 'Saving…' : saveButtonLabel}
                    </button>
                    <button
                      onClick={() => {
                        setDomainsInput(currentDomainsValue);
                        setTagKey(resolvedEvent.tagKey ?? '');
                        setDifficultyRank(resolvedEvent.difficultyRank ? String(resolvedEvent.difficultyRank) : '');
                        setError('');
                        setEditing(false);
                      }}
                      className="fg-button-secondary"
                    >
                      Cancel
                    </button>
                  </div>

                  {exactRuleExists && (
                    <button
                      onClick={async () => {
                        await removeEventRule(resolvedEvent.event.title);
                        await onSaved();
                      }}
                      className="text-sm font-medium text-rose-600 transition hover:text-rose-700"
                    >
                      {hasUnrestrictedOverride ? 'Delete unrestricted override' : 'Remove exact rule'}
                    </button>
                  )}
                </div>
                </>
              ) : (
                <div>
                  {displayedDomains.length > 0 ? (
                    <>
                    {keywordFallbackActive ? (
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
                        From keyword fallback
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {displayedDomains.map((domain) => (
                      <span
                        key={domain}
                        className="rounded-full border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-1.5 text-xs font-medium text-[var(--fg-text)]"
                      >
                        {domain}
                      </span>
                      ))}
                    </div>
                    {keywordFallbackActive ? (
                      <p className="mt-3 text-xs leading-5 text-[var(--fg-muted)]">
                        This title is still following the shared keyword rule. Create an exact rule only if you want this event title to stop inheriting those sites.
                      </p>
                    ) : null}
                    </>
                  ) : hasUnrestrictedOverride ? (
                    <p className="text-sm leading-6 text-[var(--fg-muted)]">
                      This exact-title override keeps the event unrestricted.
                      {resolvedEvent.fallbackKeyword
                        ? ` Keyword fallback "${resolvedEvent.fallbackKeyword}" will stay off until you delete the override.`
                        : ''}
                    </p>
                  ) : (
                    <p className="text-sm text-[var(--fg-muted)]">No domains saved yet.</p>
                  )}
                  {exactRuleExists ? (
                    <button
                      onClick={async () => {
                        await removeEventRule(resolvedEvent.event.title);
                        await onSaved();
                      }}
                      className="mt-4 text-sm font-medium text-rose-600 transition hover:text-rose-700"
                    >
                      {hasUnrestrictedOverride ? 'Delete unrestricted override' : 'Remove exact rule'}
                    </button>
                  ) : null}
                </div>
              )}
            </div>

            <div className="rounded-[24px] border border-[rgba(148,163,184,0.16)] bg-white px-4 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[var(--fg-text)]">Launch page</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                    Save one exact task URL for this calendar occurrence. Window can bring that page forward automatically when the block starts.
                  </p>
                </div>
                {!editingLaunchTarget && (
                  <button
                    onClick={() => {
                      setLaunchUrlInput(currentLaunchUrlValue);
                      setLaunchError('');
                      setEditingLaunchTarget(true);
                    }}
                    className="fg-button-ghost"
                  >
                    {hasLaunchTarget ? 'Edit' : 'Add'}
                  </button>
                )}
              </div>

              {editingLaunchTarget ? (
                <>
                  <input
                    type="url"
                    value={launchUrlInput}
                    onChange={(event) => setLaunchUrlInput(event.target.value)}
                    className="fg-input"
                    placeholder="https://leetcode.com/problems/two-sum/"
                    autoFocus={!editing}
                  />
                  <p className="mt-3 text-xs leading-5 text-[var(--fg-muted)]">
                    Exact `http://` or `https://` only. This launch page is saved for this event occurrence only and does not create an exact Event Rule.
                  </p>
                  {launchError && <p className="mt-3 text-xs text-rose-600">{launchError}</p>}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          setLaunchError('');
                          setSavingLaunchTarget(true);
                          const result = await upsertEventLaunchTarget(
                            resolvedEvent.event,
                            launchUrlInput,
                          );
                          setSavingLaunchTarget(false);
                          if (!result.ok) {
                            setLaunchError(result.error ?? 'Unable to save launch page.');
                            return;
                          }
                          setEditingLaunchTarget(false);
                          await onSaved();
                        }}
                        disabled={savingLaunchTarget}
                        className="fg-button-primary"
                      >
                        {savingLaunchTarget ? 'Saving…' : hasLaunchTarget ? 'Save launch page' : 'Add launch page'}
                      </button>
                      <button
                        onClick={() => {
                          setLaunchUrlInput(currentLaunchUrlValue);
                          setLaunchError('');
                          setEditingLaunchTarget(false);
                        }}
                        className="fg-button-secondary"
                      >
                        Cancel
                      </button>
                    </div>

                    {hasLaunchTarget ? (
                      <button
                        onClick={async () => {
                          await removeEventLaunchTarget(resolvedEvent.event.id);
                          setLaunchError('');
                          setEditingLaunchTarget(false);
                          await onSaved();
                        }}
                        className="text-sm font-medium text-rose-600 transition hover:text-rose-700"
                      >
                        Remove launch page
                      </button>
                    ) : null}
                  </div>
                </>
              ) : hasLaunchTarget ? (
                <div className="space-y-3">
                  <div className="rounded-[20px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3.5 py-3">
                    <p className="truncate text-sm font-medium text-[var(--fg-text)]">
                      {launchTargetHost}
                    </p>
                    <p className="mt-1 break-all text-xs leading-5 text-[var(--fg-muted)]">
                      {launchTarget.launchUrl}
                    </p>
                  </div>
                  <p className="text-xs leading-5 text-[var(--fg-muted)]">
                    This launch page stays tied to this occurrence only. Saving it does not change the title-wide allowlist rule.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-[var(--fg-muted)]">No launch page saved for this occurrence.</p>
              )}
            </div>
          </div>
        </div>
      </>
    );
  },
);

EventRuleTooltip.displayName = 'EventRuleTooltip';

function CalendarEventChip({
  eventId,
  title,
  timeText,
  backgroundColor,
  foregroundColor,
  onQuickOpen,
}: {
  eventId: string;
  title: string;
  timeText: string;
  backgroundColor: string;
  foregroundColor: string;
  onQuickOpen: (eventId: string, element: HTMLElement) => void;
}): React.JSX.Element {
  return (
    <div
      className="fg-event-chip cursor-pointer transition duration-150 hover:brightness-[1.03]"
      style={{ background: backgroundColor, color: foregroundColor }}
      onPointerDownCapture={(event) => {
        onQuickOpen(eventId, event.currentTarget as HTMLElement);
      }}
    >
      {timeText && <span className="fg-event-time">{timeText}</span>}
      <span className="fg-event-title">{title}</span>
    </div>
  );
}

function RuleListItem({
  title,
  subtitle,
  domains,
  tagLabel,
  difficultyRank,
  isUnrestrictedOverride = false,
  onDelete,
}: {
  title: string;
  subtitle: string;
  domains: string[];
  tagLabel?: string | null;
  difficultyRank?: DifficultyRank | null;
  isUnrestrictedOverride?: boolean;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <div className="rounded-[22px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--fg-text)]">{title}</p>
          <p className="text-xs text-[var(--fg-muted)]">{subtitle}</p>
          {(tagLabel || difficultyRank) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {tagLabel ? (
                <span className="rounded-full border border-[var(--fg-border)] bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
                  {tagLabel}
                </span>
              ) : null}
              {difficultyRank ? (
                <span className="rounded-full border border-[var(--fg-border)] bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
                  D{difficultyRank}
                </span>
              ) : null}
            </div>
          )}
        </div>
        <button onClick={onDelete} className="text-sm font-medium text-rose-600 transition hover:text-rose-700">
          Delete
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {domains.length > 0 ? (
          domains.map((domain) => (
            <span
              key={domain}
              className="rounded-full border border-[var(--fg-border)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--fg-text)]"
            >
              {domain}
            </span>
          ))
        ) : isUnrestrictedOverride ? (
          <span className="text-xs text-[var(--fg-muted)]">Keeps this event title unrestricted.</span>
        ) : (
          <span className="text-xs text-[var(--fg-muted)]">No allowed domains configured.</span>
        )}
      </div>
    </div>
  );
}

function KeywordRuleListItem({
  rule,
  taskTags,
  onTagChange,
  onDelete,
}: {
  rule: KeywordRule;
  taskTags: TaskTag[];
  onTagChange: (tagKey: string) => void;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <div className="rounded-[22px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--fg-text)]">{rule.keyword}</p>
          <p className="text-xs text-[var(--fg-muted)]">Fallback keyword rule</p>
        </div>
        <button onClick={onDelete} className="text-sm font-medium text-rose-600 transition hover:text-rose-700">
          Delete
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr),180px]">
        <div className="flex flex-wrap gap-2">
          {rule.domains.length > 0 ? (
            rule.domains.map((domain) => (
              <span
                key={domain}
                className="rounded-full border border-[var(--fg-border)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--fg-text)]"
              >
                {domain}
              </span>
            ))
          ) : (
            <span className="text-xs text-[var(--fg-muted)]">No allowed domains configured.</span>
          )}
        </div>

        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--fg-muted)]">
            Linked tag
          </p>
          <select
            value={rule.tagKey ?? ''}
            onChange={(event) => onTagChange(event.target.value)}
            className="fg-select w-full"
          >
            <option value="">No linked tag</option>
            {taskTags.map((tag) => (
              <option key={tag.key} value={tag.key}>
                {tag.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function AnalyticsWorkspace({
  analyticsSnapshot,
  taskTags,
  onRefresh,
  onSaveOverride,
}: {
  analyticsSnapshot: AnalyticsSnapshot;
  taskTags: TaskTag[];
  onRefresh: () => void;
  onSaveOverride: (
    focusSessionId: string,
    tagKey: string | null,
    difficultyRank: DifficultyRank | null,
  ) => void;
}): React.JSX.Element {
  const summary = analyticsSnapshot.summary7d;
  const recentSessions = analyticsSnapshot.recentSessions.slice(0, 12);
  const dailyTrend = buildDailyTrend(analyticsSnapshot.recentSessions);

  return (
    <div className="space-y-5">
      <section className="fg-card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.02em] text-[var(--fg-text)]">Analytics</h2>
            <p className="mt-1 text-sm text-[var(--fg-muted)]">
              Last 7 days of calendar-linked focus sessions, grouped by time quality, tags, and inferred difficulty.
            </p>
          </div>
          <button onClick={onRefresh} className="fg-button-secondary px-3 py-2 text-sm">
            Refresh Analytics
          </button>
        </div>

        <div className="mb-3 grid gap-3 xl:grid-cols-[minmax(0,1.45fr),repeat(3,minmax(0,0.55fr))]">
          <div className="rounded-[22px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--fg-muted)]">
              What We Track
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--fg-muted)]">
              Window only scores time while a calendar event is active. Each minute is marked productive on allowed domains, supportive on helper domains, distracted on everything else, away when you go idle, and break while focus blocking is snoozed.
            </p>
          </div>
          <AnalyticsMetricCard label="Sessions" value={String(summary.totalFocusSessions)} />
          <AnalyticsMetricCard label="Break" value={formatMinutes(summary.breakMinutes)} />
          <AnalyticsMetricCard label="Left early" value={String(summary.leftEarlyCount)} />
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <AnalyticsMetricCard label="Productive" value={formatMinutes(summary.productiveMinutes)} />
          <AnalyticsMetricCard label="Supportive" value={formatMinutes(summary.supportiveMinutes)} />
          <AnalyticsMetricCard label="Distracted" value={formatMinutes(summary.distractedMinutes)} />
          <AnalyticsMetricCard label="Away" value={formatMinutes(summary.awayMinutes)} />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr),minmax(0,1.1fr)]">
        <div className="fg-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--fg-text)]">Weekly trend</h3>
            <InfoTip text="Derived from recent focus sessions. Taller bars mean more productive minutes." />
          </div>
          <div className="grid gap-2">
            {dailyTrend.length === 0 ? (
              <EmptyCard text="No recent sessions yet." />
            ) : (
              dailyTrend.map((day) => (
                <div key={day.label} className="grid grid-cols-[88px,minmax(0,1fr),72px] items-center gap-3">
                  <span className="text-xs text-[var(--fg-muted)]">{day.label}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--fg-panel-soft)]">
                    <div
                      className="h-full rounded-full bg-[var(--fg-accent)]"
                      style={{ width: `${day.percent}%` }}
                    />
                  </div>
                  <span className="text-xs text-[var(--fg-text)]">{formatMinutes(day.productiveMinutes)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="fg-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--fg-text)]">Time by tag</h3>
            <InfoTip text="Grouped by the primary task tag on each focus session." />
          </div>
          <div className="space-y-2">
            {analyticsSnapshot.tagBreakdown7d.length === 0 ? (
              <EmptyCard text="No tagged focus sessions yet." />
            ) : (
              analyticsSnapshot.tagBreakdown7d.map((item) => (
                <div
                  key={item.tagKey}
                  className="rounded-[20px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
                      <p className="text-sm font-medium text-[var(--fg-text)]">{item.label}</p>
                    </div>
                    <p className="text-xs text-[var(--fg-muted)]">{formatMinutes(item.productiveMinutes)}</p>
                  </div>
                  <p className="mt-1 text-xs text-[var(--fg-muted)]">
                    {item.sessions} session{item.sessions === 1 ? '' : 's'} · {formatMinutes(item.distractedMinutes)} distracted
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.82fr),minmax(0,1.18fr)]">
        <div className="fg-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--fg-text)]">Difficulty matrix</h3>
            <InfoTip text="Difficulty is a five-rank scale. Focus score measures productive minutes against distracted and away time." />
          </div>
          <div className="space-y-2">
            {analyticsSnapshot.difficultyBreakdown7d.length === 0 ? (
              <EmptyCard text="No difficulty data yet." />
            ) : (
              analyticsSnapshot.difficultyBreakdown7d.map((item) => (
                <div
                  key={item.difficultyRank}
                  className="rounded-[20px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-[var(--fg-text)]">Difficulty {item.difficultyRank}</p>
                    <p className="text-xs text-[var(--fg-muted)]">{item.focusScore}% focus score</p>
                  </div>
                  <p className="mt-1 text-xs text-[var(--fg-muted)]">
                    {formatMinutes(item.productiveMinutes)} productive · {formatMinutes(item.distractedMinutes)} distracted · {item.sessions} session{item.sessions === 1 ? '' : 's'}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="fg-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--fg-text)]">Recent sessions</h3>
            <InfoTip text="Override tag or difficulty here when Window inferred the wrong classification." />
          </div>
          <div className="space-y-3">
            {recentSessions.length === 0 ? (
              <EmptyCard text="No focus sessions recorded yet." />
            ) : (
              recentSessions.map((session) => (
                <SessionAnalyticsRow
                  key={session.id}
                  session={session}
                  taskTags={taskTags}
                  onSaveOverride={onSaveOverride}
                />
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function AnalyticsMetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="rounded-[22px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--fg-muted)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[var(--fg-text)]">{value}</p>
    </div>
  );
}

function SessionAnalyticsRow({
  session,
  taskTags,
  onSaveOverride,
}: {
  session: FocusSessionRecord;
  taskTags: TaskTag[];
  onSaveOverride: (
    focusSessionId: string,
    tagKey: string | null,
    difficultyRank: DifficultyRank | null,
  ) => void;
}): React.JSX.Element {
  const [tagKey, setTagKey] = useState(session.tagKey ?? '');
  const [difficulty, setDifficulty] = useState(session.difficultyRank ? String(session.difficultyRank) : '');

  useEffect(() => {
    setTagKey(session.tagKey ?? '');
    setDifficulty(session.difficultyRank ? String(session.difficultyRank) : '');
  }, [session.difficultyRank, session.id, session.tagKey]);

  return (
    <div className="rounded-[20px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--fg-text)]">{session.eventTitle}</p>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            {formatSessionRange(session)} · {formatMinutes(session.productiveMinutes)} productive · {formatMinutes(session.distractedMinutes)} distracted
          </p>
        </div>
        {session.leftEarly ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-800">
            Left early
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr),140px,120px]">
        <select
          value={tagKey}
          onChange={(event) => setTagKey(event.target.value)}
          className="fg-select"
        >
          <option value="">No tag</option>
          {taskTags.map((tag) => (
            <option key={tag.key} value={tag.key}>
              {tag.label}
            </option>
          ))}
        </select>

        <select
          value={difficulty}
          onChange={(event) => setDifficulty(event.target.value)}
          className="fg-select"
        >
          <option value="">Auto</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="5">5</option>
          <option value="8">8</option>
        </select>

        <button
          onClick={() => onSaveOverride(session.id, tagKey || null, parseDifficultyRank(difficulty))}
          className="fg-button-secondary px-3 py-2 text-sm"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function EmptyCard({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="rounded-[22px] border border-dashed border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-5 text-sm text-[var(--fg-muted)]">
      {text}
    </div>
  );
}

function LegendDot({
  tone,
  label,
}: {
  tone: 'emerald' | 'amber' | 'slate';
  label: string;
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${tone === 'emerald' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-slate-400'}`} />
      {label}
    </span>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full p-[2px] transition-colors ${
        checked ? 'bg-[var(--fg-accent)]' : 'bg-slate-300'
      }`}
    >
      <span
        className={`h-6 w-6 rounded-full bg-white shadow-[0_6px_16px_rgba(15,23,42,0.18)] transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function chooseTooltipPosition(anchorRect: DOMRect): {
  mode: TooltipMode;
  placement: TooltipPlacement;
} {
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const spaceAbove = anchorRect.top;
  const canAnchorHorizontally = window.innerWidth >= TOOLTIP_WIDTH + TOOLTIP_MARGIN * 2;
  const canAnchorVertically = spaceBelow >= TOOLTIP_HEIGHT + 16 || spaceAbove >= TOOLTIP_HEIGHT + 16;

  if (!canAnchorHorizontally || !canAnchorVertically || window.innerWidth < 760) {
    return { mode: 'modal', placement: 'bottom' };
  }

  return {
    mode: 'anchored',
    placement: spaceBelow >= TOOLTIP_HEIGHT + 16 ? 'bottom' : 'top',
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function splitDomains(value: string): string[] {
  return value
    .split(',')
    .map((domain) => domain.trim())
    .filter(Boolean);
}

function safeHostname(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function resolveWorkspaceEvent(
  event: CalendarEvent,
  eventRules: EventRule[],
  keywordRules: KeywordRule[],
  taskTags: TaskTag[],
  recentSessions: FocusSessionRecord[],
  settings: Settings | null,
): ResolvedWorkspaceEvent {
  const exactRule = eventRules.find((rule) => rule.eventTitle === event.title);
  const keywordRule = settings?.keywordAutoMatchEnabled
    ? findBestKeywordRule(event.title, keywordRules)
    : null;
  const treatExactRuleAsFallback =
    exactRule !== undefined &&
    exactRule.domains.length > 0 &&
    keywordRule !== null &&
    isRedundantExactRuleCopy(exactRule, keywordRule);
  const inferredTagKey = exactRule?.tagKey ?? keywordRule?.tagKey ?? inferTaskTagKeyFromTitle(event.title, taskTags);
  const tag = findTaskTag(taskTags, inferredTagKey);
  const difficultyRank = inferredTagKey
    ? deriveDifficultyRank({
        baselineDifficulty: tag?.baselineDifficulty ?? null,
        scheduledStart: event.start,
        scheduledEnd: event.end,
        priorSessions: recentSessions.filter((session) => session.tagKey === inferredTagKey),
        override: exactRule?.difficultyOverride ?? null,
      })
    : exactRule?.difficultyOverride ?? null;

  if (exactRule && !treatExactRuleAsFallback) {
    return {
      event,
      source: exactRule.domains.length > 0 ? 'event' : 'override',
      ruleName: exactRule.eventTitle,
      domains: exactRule.domains,
      effectiveDomains: exactRule.domains,
      tagKey: inferredTagKey,
      difficultyRank,
      fallbackKeyword: keywordRule?.keyword ?? null,
    };
  }

  if (keywordRule) {
    return {
      event,
      source: 'keyword',
      ruleName: keywordRule.keyword,
      domains: [],
      effectiveDomains: keywordRule.domains,
      tagKey: inferredTagKey,
      difficultyRank,
      fallbackKeyword: null,
    };
  }

  return {
    event,
    source: 'none',
    ruleName: null,
    domains: [],
    effectiveDomains: [],
    tagKey: inferredTagKey,
    difficultyRank,
    fallbackKeyword: null,
  };
}

function findBestKeywordRule(eventTitle: string, rules: KeywordRule[]): KeywordRule | null {
  const lower = eventTitle.toLowerCase();
  const matches = rules.filter(
    (rule) => rule.domains.length > 0 && lower.includes(rule.keyword.toLowerCase()),
  );
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => {
    const diff = b.keyword.length - a.keyword.length;
    if (diff !== 0) return diff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  })[0];
}

function statusDot(source: 'event' | 'keyword' | 'none' | 'override'): string {
  if (source === 'event') return 'bg-emerald-500';
  if (source === 'keyword') return 'bg-amber-500';
  if (source === 'override') return 'bg-sky-500';
  return 'bg-slate-400';
}

function calendarEventAppearance(event: CalendarEvent): {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
} {
  return {
    backgroundColor: event.backgroundColor ?? '#64748b',
    borderColor: event.backgroundColor ?? '#64748b',
    textColor: event.foregroundColor ?? '#ffffff',
  };
}

function formatTooltipDate(event: CalendarEvent): string {
  const startDate = new Date(event.start);
  const endDate = new Date(event.end);

  if (event.isAllDay) {
    const lastDay = new Date(endDate.getTime() - 86_400_000);
    const startLabel = startDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    const endLabel = lastDay.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    return startLabel === endLabel ? `${startLabel} · All day` : `${startLabel} – ${endLabel} · All day`;
  }

  return `${startDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · ${startDate.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })} – ${endDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function formatEventRange(event: CalendarEvent): string {
  if (event.isAllDay) {
    const spanDays = Math.max(
      1,
      Math.round((new Date(event.end).getTime() - new Date(event.start).getTime()) / 86_400_000),
    );
    return spanDays > 1 ? `All day · ${spanDays} days` : 'All day';
  }

  return `${new Date(event.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${new Date(event.end).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function formatSessionRange(session: FocusSessionRecord): string {
  return `${new Date(session.scheduledStart).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })} · ${new Date(session.scheduledStart).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })} – ${new Date(session.scheduledEnd).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function buildDailyTrend(sessions: FocusSessionRecord[]): Array<{
  label: string;
  productiveMinutes: number;
  percent: number;
}> {
  const byDay = new Map<string, number>();
  for (const session of sessions.slice(0, 21)) {
    const label = new Date(session.startedAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    byDay.set(label, (byDay.get(label) ?? 0) + session.productiveMinutes);
  }

  const max = Math.max(0, ...byDay.values());
  return [...byDay.entries()].map(([label, productiveMinutes]) => ({
    label,
    productiveMinutes,
    percent: max > 0 ? (productiveMinutes / max) * 100 : 0,
  }));
}

function formatMinutes(value: number): string {
  if (value <= 0) return '0m';
  if (value >= 60) {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${value}m`;
}

function parseDifficultyRank(value: string): DifficultyRank | null {
  const next = Number(value);
  if (next === 1 || next === 2 || next === 3 || next === 5 || next === 8) {
    return next;
  }

  return null;
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function sendMessageAsync<T = unknown>(message: { type: string; payload?: unknown }): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T & { error?: string }) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (response && typeof response === 'object' && 'error' in response && response.error) {
        reject(new Error(String(response.error)));
        return;
      }

      resolve(response);
    });
  });
}
