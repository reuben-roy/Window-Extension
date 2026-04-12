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
import {
  getCalendarState,
  getEventRules,
  getKeywordRules,
  getSettings,
  setSettings,
} from '../shared/storage';
import type {
  BreakDurationMinutes,
  CalendarEvent,
  CalendarState,
  EventRule,
  KeywordRule,
  Settings,
} from '../shared/types';

type CalendarView = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay';
type TooltipMode = 'anchored' | 'modal';
type TooltipPlacement = 'top' | 'bottom';

interface ResolvedWorkspaceEvent {
  event: CalendarEvent;
  source: 'event' | 'keyword' | 'none';
  ruleName: string | null;
  domains: string[];
}

interface SelectedTooltipState {
  eventId: string;
  anchorRect: DOMRect;
}

const TOOLTIP_WIDTH = 368;
const TOOLTIP_HEIGHT = 360;
const TOOLTIP_MARGIN = 20;

export default function Options(): React.JSX.Element {
  const calendarRef = useRef<FullCalendar | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [calendarState, setCalendarState] = useState<CalendarState | null>(null);
  const [visibleEvents, setVisibleEvents] = useState<CalendarEvent[]>([]);
  const [hasLoadedVisibleRange, setHasLoadedVisibleRange] = useState(false);
  const [settings, setLocalSettings] = useState<Settings | null>(null);
  const [eventRules, setLocalEventRules] = useState<EventRule[]>([]);
  const [keywordRules, setLocalKeywordRules] = useState<KeywordRule[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [calendarView, setCalendarView] = useState<CalendarView>('timeGridWeek');
  const [calendarTitle, setCalendarTitle] = useState('');
  const [selectedTooltip, setSelectedTooltip] = useState<SelectedTooltipState | null>(null);
  const [tooltipMode, setTooltipMode] = useState<TooltipMode>('anchored');
  const [tooltipPlacement, setTooltipPlacement] = useState<TooltipPlacement>('bottom');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [keywordDomains, setKeywordDomains] = useState('');
  const [keywordError, setKeywordError] = useState('');
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
    const [calendar, nextSettings, nextEventRules, nextKeywordRules] = await Promise.all([
      getCalendarState(),
      getSettings(),
      getEventRules(),
      getKeywordRules(),
    ]);
    setCalendarState(calendar);
    setLocalSettings(nextSettings);
    setLocalEventRules(nextEventRules);
    setLocalKeywordRules(nextKeywordRules);
    setVisibleEvents((prev) => {
      if (!calendar.lastSyncedAt || calendar.authError) {
        return [];
      }
      return prev.length > 0 ? prev : calendar.todaysEvents;
    });
  };

  useEffect(() => {
    loadData();
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (
        'calendarState' in changes ||
        'settings' in changes ||
        'eventRules' in changes ||
        'keywordRules' in changes
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

  const workspaceEvents = useMemo(
    () =>
      workspaceSourceEvents.map((event) => {
        const exactRule = eventRules.find((rule) => rule.eventTitle === event.title);
        if (exactRule) {
          return {
            event,
            source: 'event' as const,
            ruleName: exactRule.eventTitle,
            domains: exactRule.domains,
          };
        }

        if (settings?.keywordAutoMatchEnabled) {
          const keywordRule = findBestKeywordRule(event.title, keywordRules);
          if (keywordRule) {
            return {
              event,
              source: 'keyword' as const,
              ruleName: keywordRule.keyword,
              domains: keywordRule.domains,
            };
          }
        }

        return {
          event,
          source: 'none' as const,
          ruleName: null,
          domains: [],
        };
      }),
    [workspaceSourceEvents, eventRules, keywordRules, settings?.keywordAutoMatchEnabled],
  );

  const selectedResolvedEvent = selectedTooltip
    ? workspaceEvents.find((item) => item.event.id === selectedTooltip.eventId) ?? null
    : null;

  const nextEvent = useMemo(() => {
    const now = Date.now();
    return todaysEvents
      .filter((event) => new Date(event.start).getTime() > now)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0] ?? null;
  }, [todaysEvents]);

  const activeEvent = calendarState?.currentEvent ?? null;

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

  const handleConnect = () => {
    setConnecting(true);
    chrome.runtime.sendMessage({ type: 'CONNECT_CALENDAR' }, () => {
      setConnecting(false);
      loadData();
    });
  };

  const handleDisconnect = () => {
    setDisconnecting(true);
    chrome.runtime.sendMessage({ type: 'DISCONNECT_CALENDAR' }, () => {
      setDisconnecting(false);
      loadData();
      setSelectedTooltip(null);
    });
  };

  const updateSettings = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setLocalSettings(next);
    await setSettings(next);
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

  const handleEventClick = (arg: EventClickArg) => {
    arg.jsEvent.preventDefault();
    const rect = arg.el.getBoundingClientRect();
    setSelectedTooltip({ eventId: arg.event.id, anchorRect: rect });
    const positioning = chooseTooltipPosition(rect);
    setTooltipMode(positioning.mode);
    setTooltipPlacement(positioning.placement);
  };

  const saveKeywordRule = async () => {
    setKeywordError('');
    const result = await upsertKeywordRule(keyword, splitDomains(keywordDomains));
    if (!result.ok) {
      setKeywordError(result.error ?? 'Unable to save keyword rule.');
      return;
    }
    setKeyword('');
    setKeywordDomains('');
    await loadData();
  };

  if (!settings || !calendarState) {
    return (
      <div className="fg-shell min-h-screen flex items-center justify-center">
        <div className="fg-card px-6 py-5 text-sm text-[var(--fg-muted)]">Loading calendar workspace…</div>
      </div>
    );
  }

  return (
    <div className="fg-shell min-h-screen">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--fg-border)] bg-white/70 px-3 py-1 text-xs font-medium text-[var(--fg-muted)] shadow-sm backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Window workspace
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-[var(--fg-text)]">
              Window
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-[var(--fg-muted)]">
              Manage event-specific whitelist rules directly from your calendar. Exact rules override
              keyword fallback, and unmatched events stay unrestricted.
            </p>
          </div>

          <div className="fg-card flex items-center gap-3 px-4 py-3">
            {isConnected ? (
              <>
                <div className="text-right">
                  <p className="text-sm font-medium text-emerald-700">Calendar connected</p>
                  <p className="text-xs text-[var(--fg-muted)]">
                    Synced {formatRelativeSync(calendarState.lastSyncedAt)}
                  </p>
                </div>
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="fg-button-secondary"
                >
                  {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </>
            ) : (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="fg-button-primary"
              >
                {connecting ? 'Connecting…' : 'Connect Calendar'}
              </button>
            )}
          </div>
        </header>

        <section className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1fr),320px]">
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard
              label="Blocking"
              value={settings.enableBlocking ? 'On' : 'Off'}
              accent={settings.enableBlocking ? 'emerald' : 'gray'}
              action={
                <Toggle
                  checked={settings.enableBlocking}
                  onChange={(checked) => updateSettings({ enableBlocking: checked })}
                />
              }
            />
            <MetricCard
              label="Break Duration"
              value={`${settings.breakDurationMinutes} min`}
              accent="blue"
              action={
                <select
                  value={settings.breakDurationMinutes}
                  onChange={(event) =>
                    updateSettings({
                      breakDurationMinutes: Number(event.target.value) as BreakDurationMinutes,
                    })
                  }
                  className="fg-select"
                >
                  <option value={5}>5 min</option>
                  <option value={10}>10 min</option>
                  <option value={15}>15 min</option>
                </select>
              }
            />
            <MetricCard
              label="Active Event"
              value={activeEvent ? truncate(activeEvent.title, 26) : 'None'}
              accent={activeEvent ? 'violet' : 'gray'}
              subvalue={activeEvent ? formatEventRange(activeEvent) : 'No focus block live'}
            />
            <MetricCard
              label="Next Event"
              value={nextEvent ? truncate(nextEvent.title, 26) : 'Nothing upcoming'}
              accent={nextEvent ? 'amber' : 'gray'}
              subvalue={nextEvent ? formatEventRange(nextEvent) : 'Today looks clear'}
            />
          </div>

          <div className="fg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[var(--fg-text)]">Advanced</h2>
                <p className="text-xs text-[var(--fg-muted)]">
                  Secondary controls that support fallback matching.
                </p>
              </div>
              <button
                onClick={() => setAdvancedOpen((open) => !open)}
                className="fg-button-ghost"
              >
                {advancedOpen ? 'Hide' : 'Show'}
              </button>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--fg-text)]">Keyword auto-match</p>
                    <p className="text-xs text-[var(--fg-muted)]">
                      Only applies when an event has no exact Event Rule.
                    </p>
                  </div>
                  <Toggle
                    checked={settings.keywordAutoMatchEnabled}
                    onChange={(checked) => updateSettings({ keywordAutoMatchEnabled: checked })}
                  />
                </div>
              </div>

              {advancedOpen && (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] p-4">
                    <p className="mb-3 text-sm font-medium text-[var(--fg-text)]">Keyword Rules</p>
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
                      <div className="flex justify-between gap-3">
                        <p className="text-xs text-[var(--fg-muted)]">
                          Longest keyword wins. Exact Event Rules always take precedence.
                        </p>
                        <button onClick={saveKeywordRule} className="fg-button-primary">
                          Save Keyword Rule
                        </button>
                      </div>
                      {keywordError && <p className="text-xs text-rose-600">{keywordError}</p>}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {keywordRules.length === 0 ? (
                      <EmptyCard text="No keyword rules yet." />
                    ) : (
                      keywordRules.map((rule) => (
                        <RuleListItem
                          key={rule.keyword}
                          title={rule.keyword}
                          subtitle="Fallback keyword rule"
                          domains={rule.domains}
                          onDelete={async () => {
                            await removeKeywordRule(rule.keyword);
                            await loadData();
                          }}
                        />
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="fg-card relative overflow-hidden p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-[var(--fg-text)]">
                Calendar Workspace
              </h2>
              <p className="text-sm text-[var(--fg-muted)]">
                Click any event to open its whitelist tooltip and edit allowed sites inline.
              </p>
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
                  if (selectedTooltip?.eventId === arg.event.id) {
                    arg.el.dataset.windowSelected = 'true';
                  } else {
                    delete arg.el.dataset.windowSelected;
                  }
                }}
                eventContent={(arg: EventContentArg) => (
                  <CalendarEventChip
                    title={arg.event.title}
                    timeText={arg.timeText}
                    backgroundColor={arg.event.backgroundColor}
                    foregroundColor={arg.event.textColor}
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

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="fg-card p-5">
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-[var(--fg-text)]">Exact Event Rules</h2>
              <p className="text-xs text-[var(--fg-muted)]">
                These are created from the calendar tooltip and always override keyword fallback.
              </p>
            </div>
            <div className="space-y-2">
              {eventRules.length === 0 ? (
                <EmptyCard text="No Event Rules yet. Click an event in the calendar to start." />
              ) : (
                eventRules.map((rule) => (
                  <RuleListItem
                    key={rule.eventTitle}
                    title={rule.eventTitle}
                    subtitle="Exact title rule"
                    domains={rule.domains}
                    onDelete={async () => {
                      await removeEventRule(rule.eventTitle);
                      await loadData();
                    }}
                  />
                ))
              )}
            </div>
          </div>

          <div className="fg-card p-5">
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-[var(--fg-text)]">Workspace Notes</h2>
              <p className="text-xs text-[var(--fg-muted)]">
                The tooltip chooses anchored placement when there is room, then falls back to a modal sheet on tight viewports or unsafe edges.
              </p>
            </div>
            <ul className="space-y-2 text-sm text-[var(--fg-muted)]">
              <li>Events near edges flip above or below and clamp within the viewport.</li>
              <li>Small or crowded events still open the same editor, even inside FullCalendar overflow popovers.</li>
              <li>Recurring events show a hint that changes apply to all events with the same exact title.</li>
              <li>Outside click and `Esc` close the tooltip, while storage sync keeps it fresh when possible.</li>
            </ul>
          </div>
        </section>
      </div>

      {selectedResolvedEvent && selectedTooltip && (
        <EventRuleTooltip
          key={selectedResolvedEvent.event.id}
          ref={tooltipRef}
          resolvedEvent={selectedResolvedEvent}
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
    const exactRuleExists = resolvedEvent.source === 'event';
    const [domainsInput, setDomainsInput] = useState(resolvedEvent.domains.join(', '));
    const [editing, setEditing] = useState(!exactRuleExists);
    const [error, setError] = useState('');

    useEffect(() => {
      setDomainsInput(resolvedEvent.domains.join(', '));
      setEditing(resolvedEvent.source !== 'event');
      setError('');
    }, [resolvedEvent.event.id, resolvedEvent.domains, resolvedEvent.source]);

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

    return (
      <>
        <div className="fixed inset-0 z-40 bg-[rgba(6,9,20,0.12)] backdrop-blur-[1.5px]" onClick={onClose} />
        <div
          ref={ref}
          className={`fixed z-50 w-[min(368px,calc(100vw-24px))] rounded-[30px] border border-[var(--fg-border)] bg-white/95 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.18)] backdrop-blur-xl ${
            mode === 'modal' ? 'max-h-[min(560px,calc(100vh-48px))] overflow-auto' : ''
          }`}
          style={positioning}
          role="dialog"
          aria-modal="true"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--fg-muted)]">
                <span className={`h-2 w-2 rounded-full ${statusDot(resolvedEvent.source)}`} />
                {resolvedEvent.source === 'event'
                  ? 'Exact Event Rule'
                  : resolvedEvent.source === 'keyword'
                    ? 'Keyword fallback'
                    : 'Unrestricted'}
              </div>
              <h3 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--fg-text)]">
                {resolvedEvent.event.title}
              </h3>
              <p className="text-sm text-[var(--fg-muted)]">
                {formatTooltipDate(resolvedEvent.event)}
              </p>
              {resolvedEvent.event.recurrenceHint && (
                <p className="text-xs text-[var(--fg-muted)]">
                  {resolvedEvent.event.recurrenceHint}. Changes here apply to all events with this exact title.
                </p>
              )}
            </div>
            <button onClick={onClose} className="fg-button-ghost" aria-label="Close event rule editor">
              Close
            </button>
          </div>

          <div className="mb-4 rounded-2xl border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-3">
            <p className="text-sm font-medium text-[var(--fg-text)]">
              {resolvedEvent.source === 'none'
                ? 'No exact rule yet'
                : resolvedEvent.source === 'keyword'
                  ? `Using keyword fallback “${resolvedEvent.ruleName}”`
                  : `Using exact title rule “${resolvedEvent.ruleName}”`}
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
              {resolvedEvent.source === 'none'
                ? 'Browsing stays unrestricted unless you save allowed sites for this event title.'
                : resolvedEvent.source === 'keyword'
                  ? 'Saving here creates an exact Event Rule and overrides the fallback immediately.'
                  : 'Editing here updates the exact Event Rule used by every event with this title.'}
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-[var(--fg-text)]">Allowed sites</p>
              {!editing && (
                <button onClick={() => setEditing(true)} className="fg-button-ghost">
                  Edit
                </button>
              )}
            </div>

            {editing ? (
              <>
                <textarea
                  rows={4}
                  value={domainsInput}
                  onChange={(event) => setDomainsInput(event.target.value)}
                  className="fg-input min-h-[112px] resize-none"
                  placeholder="github.com, claude.ai, docs.google.com"
                  autoFocus
                />
                <p className="text-xs text-[var(--fg-muted)]">
                  Enter domains separated by commas. Subdomains are allowed automatically by the block rule.
                </p>
                {error && <p className="text-xs text-rose-600">{error}</p>}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        setError('');
                        onSavingChange(true);
                        const result = await upsertEventRule(
                          resolvedEvent.event.title,
                          splitDomains(domainsInput),
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
                      {savingRule ? 'Saving…' : 'Save Rule'}
                    </button>
                    <button onClick={() => setEditing(false)} className="fg-button-secondary">
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
                      Remove exact rule
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-wrap gap-2">
                {resolvedEvent.domains.length > 0 ? (
                  resolvedEvent.domains.map((domain) => (
                    <span
                      key={domain}
                      className="rounded-full border border-[var(--fg-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--fg-text)]"
                    >
                      {domain}
                    </span>
                  ))
                ) : (
                  <p className="text-sm text-[var(--fg-muted)]">No domains saved yet.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </>
    );
  },
);

EventRuleTooltip.displayName = 'EventRuleTooltip';

function CalendarEventChip({
  title,
  timeText,
  backgroundColor,
  foregroundColor,
}: {
  title: string;
  timeText: string;
  backgroundColor: string;
  foregroundColor: string;
}): React.JSX.Element {
  return (
    <div className="fg-event-chip" style={{ background: backgroundColor, color: foregroundColor }}>
      {timeText && <span className="fg-event-time">{timeText}</span>}
      <span className="fg-event-title">{title}</span>
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent: _accent,
  action,
  subvalue,
}: {
  label: string;
  value: string;
  accent: 'emerald' | 'blue' | 'violet' | 'amber' | 'gray';
  action?: React.ReactNode;
  subvalue?: string;
}): React.JSX.Element {
  return (
    <div className="fg-card p-4">
      <div className="mb-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--fg-muted)]">{label}</p>
          <p className="text-lg font-semibold tracking-[-0.03em] text-[var(--fg-text)]">{value}</p>
          {subvalue && <p className="text-xs text-[var(--fg-muted)]">{subvalue}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

function RuleListItem({
  title,
  subtitle,
  domains,
  onDelete,
}: {
  title: string;
  subtitle: string;
  domains: string[];
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <div className="rounded-[22px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--fg-text)]">{title}</p>
          <p className="text-xs text-[var(--fg-muted)]">{subtitle}</p>
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
        ) : (
          <span className="text-xs text-[var(--fg-muted)]">No allowed domains configured.</span>
        )}
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

  if (!canAnchorHorizontally || !canAnchorVertically || window.innerWidth < 980) {
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

function findBestKeywordRule(eventTitle: string, rules: KeywordRule[]): KeywordRule | null {
  const lower = eventTitle.toLowerCase();
  const matches = rules.filter((rule) => lower.includes(rule.keyword.toLowerCase()));
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => {
    const diff = b.keyword.length - a.keyword.length;
    if (diff !== 0) return diff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  })[0];
}

function statusDot(source: 'event' | 'keyword' | 'none'): string {
  if (source === 'event') return 'bg-emerald-500';
  if (source === 'keyword') return 'bg-amber-500';
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

function formatRelativeSync(value: string | null): string {
  if (!value) return 'never';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
