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
import Toggle from '../shared/components/Toggle';
import SettingsGroup from '../shared/components/SettingsGroup';
import {
  getAccountConflict,
  getAccountSyncState,
  getAccountUser,
  getAnalyticsSnapshot,
  getAssistantOptions,
  getCalendarState,
  getExtendedTaskAssignments,
  getExtendedTaskSets,
  getEventLaunchTargets,
  getEventRules,
  getGlobalAllowlist,
  getKeywordRules,
  getOpenClawState,
  getSettings,
  getTaskTags,
  setExtendedTaskSets,
  setTaskTags,
  setSettings,
} from '../shared/storage';
import {
  assignExtendedTaskSetToEvent,
  findExtendedTaskAssignment,
  normalizeExtendedTaskUrl,
  removeExtendedTaskAssignment,
} from '../shared/extendedTasks';
import {
  BUILT_IN_LEETCODE_MASTER_TEMPLATE_ID,
  BUILT_IN_EXTENDED_TASK_TEMPLATES,
  duplicateExtendedTaskTemplate,
  encodeExtendedTaskLibraryEntryDragPayload,
  EXTENDED_TASK_LIBRARY_DRAG_MIME,
  resolveDraggedExtendedTaskLibraryEntry,
  toExtendedTaskLibraryEntry,
} from '../shared/extendedTaskLibrary';
import { MODEL_PLACEHOLDER_OPTIONS } from '../shared/constants';
import { isRedundantExactRuleCopy } from '../shared/ruleResolution';
import {
  findEventLaunchTarget,
  removeEventLaunchTarget,
  upsertEventLaunchTarget,
} from '../shared/launchTargets';
import {
  ensureDefaultTaskTags,
  findTaskTag,
  inferTaskTagKeyFromTitle,
  inferTaskTagKeysFromText,
  normalizeTaskTag,
  slugifyTagKey,
} from '../shared/tags';
import type {
  AccountConflict,
  AccountSyncState,
  AccountUser,
  AnalyticsSnapshot,
  AssistantOptions,
  BreakDurationMinutes,
  CalendarEvent,
  CalendarState,
  ConsumptionTimelinePoint,
  DifficultyRank,
  DownloadRedirectFallbackSeconds,
  ExtendedTaskAssignment,
  ExtendedTaskLibraryEntry,
  ExtendedTaskSet,
  EventLaunchTarget,
  EventRule,
  FocusSessionRecord,
  KeywordRule,
  OpenClawInstanceConnectionTest,
  OpenClawInstanceSettings,
  OpenClawState,
  Settings,
  TaskNotificationMode,
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
  secondaryTagKeys: string[];
  difficultyRank: DifficultyRank | null;
  fallbackKeyword: string | null;
}

interface SelectedTooltipState {
  eventId: string;
  anchorRect: DOMRect;
}

const OCCURRENCE_CHECKLIST_PREVIEW_COUNT = 5;

interface ExtendedTaskListPreview {
  title: string;
  subtitle?: string;
  rows: Array<{ id: string; label: string; url?: string }>;
}

interface ExtendedTaskSetDraftItem {
  id: string;
  label: string;
  url: string;
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

/** Wide enough for two-column event editor (tags + allowlist | task set + launch). */
const TOOLTIP_WIDTH = 720;
const TOOLTIP_HEIGHT = 720;
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
const DEFAULT_TIME_GRID_START_MINUTES = 7 * 60;
const DEFAULT_TIME_GRID_END_MINUTES = 21 * 60;
const MIN_TIME_GRID_SPAN_MINUTES = 8 * 60;
const TIME_GRID_ROUNDING_MINUTES = 30;
const TIME_GRID_TOP_PADDING_MINUTES = 45;
const TIME_GRID_BOTTOM_PADDING_MINUTES = 60;

const TASK_NOTIFICATION_MODE_OPTIONS: Array<{
  value: TaskNotificationMode;
  label: string;
  description: string;
}> = [
  {
    value: 'after_focus',
    label: 'After focus',
    description: 'Hold completion notifications until the current Window focus context ends.',
  },
  {
    value: 'immediate',
    label: 'Immediate',
    description: 'Notify as soon as the remote assistant finishes the task.',
  },
  {
    value: 'inbox_only',
    label: 'Inbox only',
    description: 'Keep completed handoffs in the assistant inbox without a browser notification.',
  },
];

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
  const tooltipRefreshFrameRef = useRef<number | null>(null);
  const [calendarState, setCalendarState] = useState<CalendarState | null>(null);
  const [assistantOptions, setAssistantOptionsState] = useState<AssistantOptions | null>(null);
  const [openClawState, setOpenClawStateState] = useState<OpenClawState | null>(null);
  const [openClawInstanceLoaded, setOpenClawInstanceLoaded] = useState<OpenClawInstanceSettings | null>(null);
  const [openClawInstanceDraft, setOpenClawInstanceDraft] = useState({
    baseUrl: '',
    apiToken: '',
    clearStoredToken: false,
  });
  const [openClawInstanceBusy, setOpenClawInstanceBusy] = useState<
    false | 'test' | 'save'
  >(false);
  const [openClawInstanceBanner, setOpenClawInstanceBanner] = useState<
    null | { kind: 'ok' | 'err'; message: string }
  >(null);
  const [analyticsSnapshot, setAnalyticsSnapshotState] = useState<AnalyticsSnapshot | null>(null);
  const [visibleEvents, setVisibleEvents] = useState<CalendarEvent[]>([]);
  const [hasLoadedVisibleRange, setHasLoadedVisibleRange] = useState(false);
  const [settings, setLocalSettings] = useState<Settings | null>(null);
  const [eventRules, setLocalEventRules] = useState<EventRule[]>([]);
  const [eventLaunchTargets, setEventLaunchTargetsState] = useState<EventLaunchTarget[]>([]);
  const [keywordRules, setLocalKeywordRules] = useState<KeywordRule[]>([]);
  const [taskTags, setTaskTagsState] = useState<TaskTag[]>([]);
  const [extendedTaskSets, setExtendedTaskSetsState] = useState<ExtendedTaskSet[]>([]);
  const [extendedTaskAssignments, setExtendedTaskAssignmentsState] = useState<ExtendedTaskAssignment[]>([]);
  const [calendarView, setCalendarView] = useState<CalendarView>('timeGridWeek');
  const [calendarTitle, setCalendarTitle] = useState('');
  const [surfaceTab, setSurfaceTab] = useState<'workspace' | 'analytics'>('workspace');
  const [selectedTooltip, setSelectedTooltip] = useState<SelectedTooltipState | null>(null);
  const [tooltipMode, setTooltipMode] = useState<TooltipMode>('anchored');
  const [tooltipPlacement, setTooltipPlacement] = useState<TooltipPlacement>('bottom');
  const [expandedDefaultRoadmapId, setExpandedDefaultRoadmapId] = useState<string | null>(
    BUILT_IN_LEETCODE_MASTER_TEMPLATE_ID,
  );
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
  const [draggingExtendedTaskEntry, setDraggingExtendedTaskEntry] = useState<ExtendedTaskLibraryEntry | null>(null);
  const [editingExtendedTaskSetId, setEditingExtendedTaskSetId] = useState<string | null>(null);
  const [extendedTaskSetTitle, setExtendedTaskSetTitle] = useState('');
  const [extendedTaskSetItems, setExtendedTaskSetItems] = useState<ExtendedTaskSetDraftItem[]>([
    createEmptyExtendedTaskSetDraftItem(),
  ]);
  const [extendedTaskSetError, setExtendedTaskSetError] = useState('');
  const [savingExtendedTaskSet, setSavingExtendedTaskSet] = useState(false);
  const [showExtendedTaskEditor, setShowExtendedTaskEditor] = useState(false);
  const [completingExtendedTaskItemId, setCompletingExtendedTaskItemId] = useState<string | null>(null);
  const [extendedTaskActionError, setExtendedTaskActionError] = useState('');
  const [occurrenceChecklistExpanded, setOccurrenceChecklistExpanded] = useState(false);
  const [extendedTaskListPreview, setExtendedTaskListPreview] = useState<ExtendedTaskListPreview | null>(null);
  const workspaceEventsRef = useRef<ResolvedWorkspaceEvent[]>([]);
  const extendedTaskSetsRef = useRef<ExtendedTaskSet[]>([]);
  const draggingExtendedTaskEntryRef = useRef<ExtendedTaskLibraryEntry | null>(null);

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
      nextExtendedTaskSets,
      nextExtendedTaskAssignments,
      nextAnalyticsSnapshot,
      nextGlobalAllowlist,
      nextAccountUser,
      nextAccountSyncState,
      nextAccountConflict,
      nextAssistantOptions,
      nextOpenClawState,
    ] = await Promise.all([
      getCalendarState(),
      getSettings(),
      getEventRules(),
      getEventLaunchTargets(),
      getKeywordRules(),
      getTaskTags(),
      getExtendedTaskSets(),
      getExtendedTaskAssignments(),
      getAnalyticsSnapshot(),
      getGlobalAllowlist(),
      getAccountUser(),
      getAccountSyncState(),
      getAccountConflict(),
      getAssistantOptions(),
      getOpenClawState(),
    ]);
    setCalendarState(calendar);
    setLocalSettings(nextSettings);
    setLocalEventRules(nextEventRules);
    setEventLaunchTargetsState(nextEventLaunchTargets);
    setLocalKeywordRules(nextKeywordRules);
    setTaskTagsState(nextTaskTags);
    setExtendedTaskSetsState(nextExtendedTaskSets);
    setExtendedTaskAssignmentsState(nextExtendedTaskAssignments);
    setAnalyticsSnapshotState(nextAnalyticsSnapshot);
    setGlobalAllowlistState(nextGlobalAllowlist);
    setAccountUserState(nextAccountUser);
    setAccountSyncStateState(nextAccountSyncState);
    setAccountConflictState(nextAccountConflict);
    setAssistantOptionsState(nextAssistantOptions);
    setOpenClawStateState(nextOpenClawState);
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
        'extendedTaskSets' in changes ||
        'extendedTaskAssignments' in changes ||
        'analyticsSnapshot' in changes ||
        'globalAllowlist' in changes ||
        'accountUser' in changes ||
        'accountSyncState' in changes ||
        'accountConflict' in changes ||
        'backendSession' in changes ||
        'assistantOptions' in changes ||
        'openClawState' in changes
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

  useEffect(() => {
    if (!accountUser || !assistantOptions?.assistantFeatureEnabled) {
      setOpenClawInstanceLoaded(null);
      setOpenClawInstanceBanner(null);
      setOpenClawInstanceDraft({
        baseUrl: '',
        apiToken: '',
        clearStoredToken: false,
      });
      return;
    }

    let cancelled = false;
    void sendMessageAsync<
      | { ok: true; settings: OpenClawInstanceSettings }
      | { ok: false; error?: string }
    >({ type: 'LOAD_OPENCLAW_INSTANCE_SETTINGS' }).then((res) => {
      if (cancelled || !res.ok) return;
      setOpenClawInstanceLoaded(res.settings);
      setOpenClawInstanceDraft((previous) => ({
        ...previous,
        baseUrl: res.settings.baseUrl ?? '',
        apiToken: '',
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [accountUser, assistantOptions?.assistantFeatureEnabled]);

  const openClawInstanceExplanation = useMemo(() => {
    if (!accountUser) {
      return 'Sign in to configure where your self-hosted OpenClaw instance listens.';
    }

    if (!openClawInstanceLoaded) {
      return 'Paste the HTTP or HTTPS origin where OpenClaw serves the `/api/window/*` routes. Include hostname and port (for example `http://127.0.0.1:18789`).';
    }

    const suffixHint = openClawInstanceLoaded.hasHostSuffixAllowlist
      ? ' This Window server restricts hostnames using OPENCLAW_ALLOWED_HOST_SUFFIXES.'
      : '';

    if (openClawInstanceLoaded.fetchMode === 'strict') {
      return `Window’s backend runs in strict OpenClaw URL mode: localhost and private IPs are rejected. Paste a hostname or HTTPS origin that the deployed backend machine can resolve and reach—for example Tailscale DNS or another shared tunnel.${suffixHint}`;
    }

    return 'Permissive mode: localhost works when Window’s backend and your SSH tunnel (if any) run on the same computer as OpenClaw is forwarded to.';
  }, [accountUser, openClawInstanceLoaded]);

  const handleTestOpenClawInstance = useCallback(async () => {
    if (!accountUser) return;
    setOpenClawInstanceBanner(null);
    setOpenClawInstanceBusy('test');
    try {
      const res = await sendMessageAsync<
        | { ok: true; result: OpenClawInstanceConnectionTest }
        | { ok: false; error: string }
      >({
        type: 'TEST_OPENCLAW_INSTANCE_SETTINGS',
        payload: {
          baseUrl: openClawInstanceDraft.baseUrl.trim(),
          ...(openClawInstanceDraft.apiToken.trim()
            ? { apiToken: openClawInstanceDraft.apiToken.trim() }
            : {}),
        },
      });
      if (!res.ok || !('result' in res)) {
        setOpenClawInstanceBanner({
          kind: 'err',
          message:
            typeof res.error === 'string'
              ? res.error
              : 'Connection test failed.',
        });
        return;
      }
      const messageText =
        res.result.ok && res.result.connected
          ? res.result.message ?? 'OpenClaw responded successfully.'
          : res.result.message ?? 'OpenClaw health check did not succeed.';
      setOpenClawInstanceBanner({
        kind: res.result.ok ? 'ok' : 'err',
        message: messageText,
      });
    } finally {
      setOpenClawInstanceBusy(false);
    }
  }, [accountUser, openClawInstanceDraft.apiToken, openClawInstanceDraft.baseUrl]);

  const handleSaveOpenClawInstance = useCallback(async () => {
    if (!accountUser) return;
    setOpenClawInstanceBanner(null);
    setOpenClawInstanceBusy('save');
    try {
      const trimmedBase = openClawInstanceDraft.baseUrl.trim();
      if (!trimmedBase) {
        setOpenClawInstanceBanner({
          kind: 'err',
          message: 'Provide an OpenClaw base URL before saving.',
        });
        return;
      }

      const res = await sendMessageAsync<
        | { ok: true; settings: OpenClawInstanceSettings }
        | { ok: false; error: string }
      >({
        type: 'SAVE_OPENCLAW_INSTANCE_SETTINGS',
        payload: {
          baseUrl: trimmedBase,
          clearApiToken: openClawInstanceDraft.clearStoredToken,
          ...(openClawInstanceDraft.apiToken.trim()
            ? { apiToken: openClawInstanceDraft.apiToken.trim() }
            : {}),
        },
      });

      if (!res.ok || !('settings' in res)) {
        setOpenClawInstanceBanner({
          kind: 'err',
          message:
            typeof res.error === 'string'
              ? res.error
              : 'Failed to save.',
        });
        return;
      }
      setOpenClawInstanceLoaded(res.settings);
      setOpenClawInstanceDraft((prev) => ({
        ...prev,
        apiToken: '',
        clearStoredToken: false,
        baseUrl: res.settings.baseUrl ?? prev.baseUrl,
      }));
      setOpenClawInstanceBanner({
        kind: 'ok',
        message: 'Saved. Refreshing assistant state.',
      });
    } finally {
      setOpenClawInstanceBusy(false);
    }
  }, [
    accountUser,
    openClawInstanceDraft.apiToken,
    openClawInstanceDraft.baseUrl,
    openClawInstanceDraft.clearStoredToken,
  ]);

  const todaysEvents = calendarState?.todaysEvents ?? [];

  const workspaceSourceEvents = hasLoadedVisibleRange
    ? visibleEvents
    : visibleEvents.length > 0
      ? visibleEvents
      : todaysEvents;
  const calendarTimeBounds = useMemo(
    () => deriveTimeGridWindow(workspaceSourceEvents),
    [workspaceSourceEvents],
  );
  const recentAnalyticsSessions = analyticsSnapshot?.recentSessions ?? [];
  const activeTaskTags = useMemo(
    () => taskTags.filter((tag) => tag.archivedAt === null),
    [taskTags],
  );
  const tagReferenceKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const rule of eventRules) {
      if (rule.tagKey) keys.add(rule.tagKey);
      for (const secondaryTagKey of rule.secondaryTagKeys) {
        keys.add(secondaryTagKey);
      }
    }
    for (const rule of keywordRules) {
      if (rule.tagKey) keys.add(rule.tagKey);
    }
    for (const session of recentAnalyticsSessions) {
      if (session.tagKey) keys.add(session.tagKey);
      for (const secondaryTagKey of session.secondaryTagKeys) {
        keys.add(secondaryTagKey);
      }
    }
    return keys;
  }, [eventRules, keywordRules, recentAnalyticsSessions]);

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
  const activeEvent = calendarState?.currentEvent ?? null;
  const selectedExtendedTaskAssignment = selectedResolvedEvent
    ? findExtendedTaskAssignment(selectedResolvedEvent.event.id, extendedTaskAssignments)
    : null;
  const fallbackActiveExtendedTaskAssignment = activeEvent
    ? findExtendedTaskAssignment(activeEvent.id, extendedTaskAssignments)
    : null;
  const occurrenceExtendedTaskEvent = selectedResolvedEvent?.event
    ?? (fallbackActiveExtendedTaskAssignment ? activeEvent : null);
  const occurrenceExtendedTaskAssignment = selectedResolvedEvent
    ? selectedExtendedTaskAssignment
    : fallbackActiveExtendedTaskAssignment;
  const activeExtendedTaskSets = useMemo(
    () =>
      [...extendedTaskSets]
        .filter((taskSet) => taskSet.archivedAt === null)
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
    [extendedTaskSets],
  );
  const defaultExtendedTaskEntries = useMemo(
    () => BUILT_IN_EXTENDED_TASK_TEMPLATES,
    [],
  );
  const leetcodeMasterEntry = useMemo(
    () =>
      defaultExtendedTaskEntries.find(
        (entry) => entry.id === BUILT_IN_LEETCODE_MASTER_TEMPLATE_ID,
      ) ?? null,
    [defaultExtendedTaskEntries],
  );
  const leetcodeSubgroupEntries = useMemo(
    () =>
      defaultExtendedTaskEntries.filter(
        (entry) => entry.id !== BUILT_IN_LEETCODE_MASTER_TEMPLATE_ID,
      ),
    [defaultExtendedTaskEntries],
  );
  const userExtendedTaskEntries = useMemo(
    () => activeExtendedTaskSets.map((taskSet) => toExtendedTaskLibraryEntry(taskSet)),
    [activeExtendedTaskSets],
  );
  const occurrenceApplyButtonLabel = selectedResolvedEvent ? 'Apply to selected' : 'Apply to current';

  const nextEvent = useMemo(() => {
    const now = Date.now();
    return todaysEvents
      .filter((event) => new Date(event.start).getTime() > now)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0] ?? null;
  }, [todaysEvents]);

  const quietHoursActive = settings ? isDailyBlockingPauseActive(new Date(), settings) : false;
  const downloadRescueRows = DOWNLOAD_RESCUE_TOGGLES.map((toggle) => ({
    ...toggle,
    checked: settings ? settings[toggle.key] : false,
  }));

  useEffect(() => {
    workspaceEventsRef.current = workspaceEvents;
  }, [workspaceEvents]);

  useEffect(() => {
    extendedTaskSetsRef.current = extendedTaskSets;
  }, [extendedTaskSets]);

  useEffect(() => {
    draggingExtendedTaskEntryRef.current = draggingExtendedTaskEntry;
    if (draggingExtendedTaskEntry === null) {
      clearExtendedTaskDropTargets();
    }
  }, [draggingExtendedTaskEntry]);

  useEffect(() => {
    setOccurrenceChecklistExpanded(false);
  }, [occurrenceExtendedTaskAssignment?.id]);

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
        current && areRectsEqual(current.anchorRect, nextRect)
          ? current
          : current
            ? { ...current, anchorRect: nextRect }
            : current,
      );
      const positioning = chooseTooltipPosition(nextRect);
      setTooltipMode((current) => (current === positioning.mode ? current : positioning.mode));
      setTooltipPlacement((current) =>
        current === positioning.placement ? current : positioning.placement,
      );
    };

    const scheduleAnchorRefresh = () => {
      if (tooltipRefreshFrameRef.current !== null) {
        return;
      }
      tooltipRefreshFrameRef.current = window.requestAnimationFrame(() => {
        tooltipRefreshFrameRef.current = null;
        refreshAnchor();
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', scheduleAnchorRefresh);
    window.addEventListener('scroll', scheduleAnchorRefresh, true);

    refreshAnchor();

    return () => {
      if (tooltipRefreshFrameRef.current !== null) {
        window.cancelAnimationFrame(tooltipRefreshFrameRef.current);
        tooltipRefreshFrameRef.current = null;
      }
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', scheduleAnchorRefresh);
      window.removeEventListener('scroll', scheduleAnchorRefresh, true);
    };
  }, [selectedTooltip]);

  const updateSettings = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setLocalSettings(next);
    await setSettings(next);
  };

  const updateAssistantOptions = async (patch: Partial<AssistantOptions>) => {
    if (!assistantOptions) return;
    await sendMessageAsync<AssistantOptions>({
      type: 'UPDATE_ASSISTANT_OPTIONS',
      payload: patch,
    });
    await loadData();
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

  const saveTaskTagDefinition = async (input: {
    existingKey?: string | null;
    label: string;
    color: string;
    aliases: string[];
    baselineDifficulty: DifficultyRank;
    alignedDomains: string[];
    supportiveDomains: string[];
    archivedAt?: string | null;
  }): Promise<{ ok: boolean; error?: string }> => {
    const nextKey = slugifyTagKey(input.existingKey || input.label);
    if (!nextKey) {
      return { ok: false, error: 'Tag needs a label.' };
    }

    const duplicate = taskTags.find(
      (tag) => tag.key === nextKey && tag.key !== (input.existingKey ?? null),
    );
    if (duplicate) {
      return { ok: false, error: 'Another tag already uses that key.' };
    }

    const nextTag = normalizeTaskTag({
      key: nextKey,
      label: input.label,
      color: input.color,
      aliases: input.aliases,
      baselineDifficulty: input.baselineDifficulty,
      alignedDomains: input.alignedDomains,
      supportiveDomains: input.supportiveDomains,
      source: input.existingKey ? findTaskTag(taskTags, input.existingKey)?.source ?? 'user' : 'user',
      archivedAt: input.archivedAt ?? null,
      updatedAt: new Date().toISOString(),
    });

    const nextTags = ensureDefaultTaskTags([
      ...taskTags.filter((tag) => tag.key !== (input.existingKey ?? null)),
      nextTag,
    ]);
    await setTaskTags(nextTags);
    await loadData();
    return { ok: true };
  };

  const toggleTaskTagArchive = async (tagKey: string, archived: boolean) => {
    const nextTags = ensureDefaultTaskTags(
      taskTags.map((tag) =>
        tag.key === tagKey
          ? {
              ...tag,
              archivedAt: archived ? new Date().toISOString() : null,
              updatedAt: new Date().toISOString(),
            }
          : tag,
      ),
    );
    await setTaskTags(nextTags);
    await loadData();
  };

  const deleteTaskTagDefinition = async (tagKey: string): Promise<{ ok: boolean; error?: string }> => {
    if (tagReferenceKeys.has(tagKey)) {
      return { ok: false, error: 'This tag is still referenced by a rule or session. Archive it or reassign those references first.' };
    }

    await setTaskTags(taskTags.filter((tag) => tag.key !== tagKey));
    await loadData();
    return { ok: true };
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

  const resetExtendedTaskSetDraft = useCallback(() => {
    setEditingExtendedTaskSetId(null);
    setExtendedTaskSetTitle('');
    setExtendedTaskSetItems([createEmptyExtendedTaskSetDraftItem()]);
    setExtendedTaskSetError('');
    setShowExtendedTaskEditor(true);
  }, []);

  const closeExtendedTaskEditor = useCallback(() => {
    setEditingExtendedTaskSetId(null);
    setExtendedTaskSetTitle('');
    setExtendedTaskSetItems([createEmptyExtendedTaskSetDraftItem()]);
    setExtendedTaskSetError('');
    setShowExtendedTaskEditor(false);
  }, []);

  const loadExtendedTaskSetDraft = useCallback((taskSet: ExtendedTaskSet) => {
    setEditingExtendedTaskSetId(taskSet.id);
    setExtendedTaskSetTitle(taskSet.title);
    setExtendedTaskSetItems(
      taskSet.items.length > 0
        ? taskSet.items.map((item) => ({
            id: item.id,
            label: item.label,
            url: item.url,
          }))
        : [createEmptyExtendedTaskSetDraftItem()],
    );
    setExtendedTaskSetError('');
    setShowExtendedTaskEditor(true);
  }, []);

  const saveExtendedTaskSetDefinition = useCallback(async () => {
    const title = extendedTaskSetTitle.trim();
    if (!title) {
      setExtendedTaskSetError('Task set title is required.');
      return;
    }

    const normalizedItems = extendedTaskSetItems
      .map((item) => ({
        id: item.id || safeId(),
        label: item.label.trim(),
        url: normalizeExtendedTaskUrl(item.url) ?? '',
      }))
      .filter((item) => item.label.length > 0 || item.url.length > 0);

    if (normalizedItems.length === 0) {
      setExtendedTaskSetError('Add at least one link.');
      return;
    }

    if (normalizedItems.some((item) => !item.label || !item.url)) {
      setExtendedTaskSetError('Each link needs both a label and a valid http:// or https:// URL.');
      return;
    }

    const now = new Date().toISOString();
    const existing = editingExtendedTaskSetId
      ? extendedTaskSets.find((taskSet) => taskSet.id === editingExtendedTaskSetId) ?? null
      : null;
    const nextTaskSet: ExtendedTaskSet = {
      id: existing?.id ?? safeId(),
      title,
      items: normalizedItems,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      archivedAt: existing?.archivedAt ?? null,
    };

    setSavingExtendedTaskSet(true);
    try {
      await setExtendedTaskSets([
        ...extendedTaskSets.filter((taskSet) => taskSet.id !== nextTaskSet.id),
        nextTaskSet,
      ]);
      closeExtendedTaskEditor();
      await loadData();
    } catch (error) {
      setExtendedTaskSetError(error instanceof Error ? error.message : 'Unable to save the task set.');
    } finally {
      setSavingExtendedTaskSet(false);
    }
  }, [
    editingExtendedTaskSetId,
    extendedTaskSetItems,
    extendedTaskSetTitle,
    extendedTaskSets,
    loadData,
    closeExtendedTaskEditor,
  ]);

  const deleteExtendedTaskSetDefinition = useCallback(async (taskSetId: string) => {
    try {
      await setExtendedTaskSets(extendedTaskSets.filter((taskSet) => taskSet.id !== taskSetId));
      if (editingExtendedTaskSetId === taskSetId) {
        closeExtendedTaskEditor();
      }
      await loadData();
    } catch (error) {
      setExtendedTaskActionError(error instanceof Error ? error.message : 'Unable to delete the task set.');
    }
  }, [editingExtendedTaskSetId, extendedTaskSets, loadData, closeExtendedTaskEditor]);

  const duplicateBuiltInExtendedTaskTemplateDefinition = useCallback(async (templateId: string) => {
    setExtendedTaskActionError('');
    const template = BUILT_IN_EXTENDED_TASK_TEMPLATES.find((candidate) => candidate.id === templateId) ?? null;
    if (!template) {
      setExtendedTaskActionError('The default roadmap could not be found.');
      return;
    }

    const duplicatedTaskSet = duplicateExtendedTaskTemplate(template);

    try {
      await setExtendedTaskSets([
        ...extendedTaskSets,
        duplicatedTaskSet,
      ]);
      loadExtendedTaskSetDraft(duplicatedTaskSet);
      await loadData();
    } catch (error) {
      setExtendedTaskActionError(error instanceof Error ? error.message : 'Unable to duplicate the roadmap.');
    }
  }, [extendedTaskSets, loadData, loadExtendedTaskSetDraft]);

  const startExtendedTaskEntryDrag = useCallback((
    draggedEntry: ExtendedTaskLibraryEntry,
    event: React.DragEvent<HTMLElement>,
  ) => {
    draggingExtendedTaskEntryRef.current = draggedEntry;
    setDraggingExtendedTaskEntry(draggedEntry);
    if (event.dataTransfer) {
      const payload = encodeExtendedTaskLibraryEntryDragPayload(draggedEntry);
      event.dataTransfer.setData(EXTENDED_TASK_LIBRARY_DRAG_MIME, payload);
      event.dataTransfer.setData('text/plain', payload);
      event.dataTransfer.effectAllowed = 'copy';
    }
  }, []);

  const assignExtendedTaskLibraryEntryToEvent = useCallback(async (
    calendarEventId: string,
    entry: ExtendedTaskLibraryEntry | null,
  ) => {
    setExtendedTaskActionError('');
    const calendarEvent =
      workspaceEventsRef.current.find((candidate) => candidate.event.id === calendarEventId)?.event ?? null;
    if (!entry || !calendarEvent) {
      setExtendedTaskActionError('The task set or calendar event could not be found.');
      return;
    }

    try {
      await assignExtendedTaskSetToEvent(calendarEvent, entry);
      await loadData();
    } catch (error) {
      setExtendedTaskActionError(error instanceof Error ? error.message : 'Unable to assign the extended task set.');
    }
  }, [loadData]);

  const applyExtendedTaskLibraryEntryToOccurrence = useCallback(async (entry: ExtendedTaskLibraryEntry) => {
    if (!occurrenceExtendedTaskEvent) {
      setExtendedTaskActionError('Select or wait for a calendar occurrence before applying a task set.');
      return;
    }

    await assignExtendedTaskLibraryEntryToEvent(occurrenceExtendedTaskEvent.id, entry);
  }, [assignExtendedTaskLibraryEntryToEvent, occurrenceExtendedTaskEvent]);

  const removeOccurrenceExtendedTaskAssignment = useCallback(async (calendarEventId: string) => {
    setExtendedTaskActionError('');
    try {
      await removeExtendedTaskAssignment(calendarEventId);
      await loadData();
    } catch (error) {
      setExtendedTaskActionError(error instanceof Error ? error.message : 'Unable to remove the occurrence assignment.');
    }
  }, [loadData]);

  const completeExtendedTaskAssignmentItem = useCallback(async (assignmentId: string, itemId: string) => {
    setExtendedTaskActionError('');
    setCompletingExtendedTaskItemId(itemId);
    try {
      const response = await sendMessageAsync<{ ok: boolean; error?: string }>({
        type: 'MARK_EXTENDED_TASK_ITEM_COMPLETE',
        payload: { assignmentId, itemId },
      });
      if (!response?.ok) {
        setExtendedTaskActionError(response?.error ?? 'Unable to complete the extended task item.');
        return;
      }
      await loadData();
    } catch (error) {
      setExtendedTaskActionError(error instanceof Error ? error.message : 'Unable to complete the extended task item.');
    } finally {
      setCompletingExtendedTaskItemId(null);
    }
  }, [loadData]);

  const uncompleteExtendedTaskAssignmentItem = useCallback(async (assignmentId: string, itemId: string) => {
    setExtendedTaskActionError('');
    setCompletingExtendedTaskItemId(itemId);
    try {
      const response = await sendMessageAsync<{ ok: boolean; error?: string }>({
        type: 'MARK_EXTENDED_TASK_ITEM_UNCOMPLETE',
        payload: { assignmentId, itemId },
      });
      if (!response?.ok) {
        setExtendedTaskActionError(response?.error ?? 'Unable to update the extended task item.');
        return;
      }
      await loadData();
    } catch (error) {
      setExtendedTaskActionError(error instanceof Error ? error.message : 'Unable to update the extended task item.');
    } finally {
      setCompletingExtendedTaskItemId(null);
    }
  }, [loadData]);

  if (!settings || !calendarState || !analyticsSnapshot) {
    return (
      <div className="fg-shell min-h-screen flex items-center justify-center">
        <div className="fg-card px-4 py-4 text-sm text-[var(--fg-muted)]">Loading calendar workspace…</div>
      </div>
    );
  }

  return (
    <div className="fg-shell min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-[var(--fg-text)]">
              Window
            </h1>
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

        <div className="mb-5 inline-flex rounded-md border border-[var(--fg-border)] bg-white p-1 shadow-sm">
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
                </div>
                <span className="rounded-full border border-[var(--fg-border)] bg-white px-3 py-1 text-[11px] font-medium text-[var(--fg-muted)]">
                  {isConnected ? 'Calendar connected' : 'Calendar disconnected'}
                </span>
              </div>

              <div className="mt-4 overflow-hidden rounded-lg border border-[var(--fg-border)] bg-[var(--fg-panel-soft)]/55">
                <div className="grid gap-0 md:grid-cols-2 xl:grid-cols-3">
                  <CompactSettingRow
                    className="px-4"
                    label="Blocking"
                    meta={
                      quietHoursActive
                        ? `Daily cutoff active after ${formatBlockingPauseTimeLabel(settings.dailyBlockingPauseStartTime)}`
                        : 'Turns restriction rules on or off instantly.'
                    }
                    control={<Toggle checked={settings.enableBlocking} onChange={updateBlockingEnabled} />}
                  />

                  <CompactSettingRow
                    className="border-t border-[var(--fg-border)] px-4 md:border-l md:border-t-0"
                    label="Break duration"
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
                    className="border-t border-[var(--fg-border)] px-4 md:border-l-0 xl:border-l xl:border-t-0"
                    label="Active event"
                    value={activeEvent ? truncate(activeEvent.title, 30) : 'No focus block live'}
                    meta={activeEvent ? formatEventRange(activeEvent) : 'Browsing is unrestricted until the next matching event.'}
                  />

                  <CompactSettingRow
                    className="border-t border-[var(--fg-border)] px-4 md:border-l xl:border-l-0"
                    label="Daily cutoff"
                    meta={
                      settings.dailyBlockingPauseEnabled
                        ? `Pauses restrictions nightly after ${formatBlockingPauseTimeLabel(settings.dailyBlockingPauseStartTime)} and resumes tomorrow.`
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
                    className="border-t border-[var(--fg-border)] px-4 xl:border-l"
                    label="Next event"
                    value={nextEvent ? truncate(nextEvent.title, 30) : 'Nothing upcoming'}
                    meta={nextEvent ? formatEventRange(nextEvent) : 'Today looks clear.'}
                  />

                  <CompactSettingRow
                    className="border-t border-[var(--fg-border)] px-4 md:border-l xl:border-l"
                    label="Download fallback"
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
                meta="Automatically checks your fallback keyword rules against unmatched events."
                control={
                  <Toggle
                    checked={settings.keywordAutoMatchEnabled}
                    onChange={(checked) => updateSettings({ keywordAutoMatchEnabled: checked })}
                  />
                }
              />

              <SettingsGroup
                className="rounded-lg border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2.5"
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
                className="rounded-lg border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2.5"
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
                className="rounded-lg border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2.5"
                title="Assistant settings"
                subtitle="Configure the OpenClaw assistant and capture behaviors."
                hint="These settings control how Window interacts with the backend assistant."
                collapsible
                defaultOpen={false}
                bodyClassName="mt-3 space-y-3"
              >
                {assistantOptions ? (
                  <CompactSettingRow
                    label="Enable Assistant"
                    meta="Turns on idea capture, task handoff, OpenClaw sessions, inbox sync, and related telemetry. Off by default to keep Window simple."
                    control={
                      <Toggle
                        checked={assistantOptions.assistantFeatureEnabled}
                        onChange={(checked) => void updateAssistantOptions({ assistantFeatureEnabled: checked })}
                      />
                    }
                  />
                ) : (
                  <p className="text-xs text-[var(--fg-muted)]">Loading assistant preferences…</p>
                )}

                {assistantOptions && !assistantOptions.assistantFeatureEnabled ? (
                  <p className="text-xs leading-snug text-[var(--fg-muted)]">
                    Assistant stays off until you enable it above. OpenClaw URL, connectors, and capture options appear
                    once enabled.
                  </p>
                ) : null}

                {assistantOptions?.assistantFeatureEnabled && !accountUser ? (
                  <p className="mb-2 text-xs text-[var(--fg-muted)]">
                    Sign in to configure your self-hosted OpenClaw URL and sync assistant state.
                  </p>
                ) : null}

                {assistantOptions?.assistantFeatureEnabled && accountUser && (
                  <div className="mb-4 grid gap-2 border-b border-[var(--fg-border-soft)] pb-4">
                    <p className="text-xs leading-snug text-[var(--fg-muted)]">{openClawInstanceExplanation}</p>
                    <CompactSettingRow
                      label="OpenClaw base URL"
                      meta="Use the scheme, host, and port your Window backend can reach (often your tunnel or LAN endpoint)."
                      control={
                        <input
                          type="text"
                          value={openClawInstanceDraft.baseUrl}
                          onChange={(event) =>
                            setOpenClawInstanceDraft((prev) => ({
                              ...prev,
                              baseUrl: event.target.value,
                            }))
                          }
                          placeholder="http://127.0.0.1:18789"
                          spellCheck={false}
                          disabled={openClawInstanceBusy !== false}
                          className="fg-input max-w-[min(720px,100%)] min-w-[min(440px,calc(100vw-288px))] px-3 py-2 text-sm text-[var(--fg-text)] outline-none"
                          autoCapitalize="off"
                          autoCorrect="off"
                        />
                      }
                    />
                    <CompactSettingRow
                      label="OpenClaw API token"
                      meta={
                        openClawInstanceLoaded?.tokenConfigured
                          ? 'A token is already stored—leave blank to keep it, or overwrite here.'
                          : 'Optional Bearer token sent with `/api/window/*` requests.'
                      }
                      control={
                        <input
                          type="password"
                          value={openClawInstanceDraft.apiToken}
                          onChange={(event) =>
                            setOpenClawInstanceDraft((prev) => ({
                              ...prev,
                              apiToken: event.target.value,
                            }))
                          }
                          placeholder={
                            openClawInstanceLoaded?.tokenConfigured ? 'keep existing token' : 'paste bearer token'
                          }
                          disabled={openClawInstanceBusy !== false}
                          className="fg-input max-w-[min(520px,100%)] px-3 py-2 text-sm text-[var(--fg-text)] outline-none"
                          autoCapitalize="off"
                          autoComplete="new-password"
                        />
                      }
                    />
                    <CompactSettingRow
                      label="Forget stored token"
                      meta="Clears the saved Bearer token next time you press Save."
                      control={
                        <Toggle
                          checked={openClawInstanceDraft.clearStoredToken}
                          onChange={(checked) =>
                            setOpenClawInstanceDraft((prev) => ({
                              ...prev,
                              clearStoredToken: checked,
                            }))
                          }
                        />
                      }
                    />
                    {openClawInstanceBanner ? (
                      <p
                        className={
                          openClawInstanceBanner.kind === 'ok'
                            ? 'text-xs text-emerald-500'
                            : 'text-xs text-rose-500'
                        }
                      >
                        {openClawInstanceBanner.message}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        className="fg-button-secondary px-4 py-2 text-xs disabled:opacity-40"
                        onClick={() => void handleTestOpenClawInstance()}
                        disabled={
                          openClawInstanceBusy !== false ||
                          openClawInstanceDraft.baseUrl.trim().length === 0
                        }
                      >
                        {openClawInstanceBusy === 'test' ? 'Testing…' : 'Test OpenClaw connection'}
                      </button>
                      <button
                        type="button"
                        className="fg-button px-4 py-2 text-xs disabled:opacity-40"
                        onClick={() => void handleSaveOpenClawInstance()}
                        disabled={
                          openClawInstanceBusy !== false ||
                          openClawInstanceDraft.baseUrl.trim().length === 0
                        }
                      >
                        {openClawInstanceBusy === 'save' ? 'Saving…' : 'Save OpenClaw settings'}
                      </button>
                    </div>
                  </div>
                )}
                {assistantOptions?.assistantFeatureEnabled && assistantOptions && openClawState && (
                  <div className="grid gap-2">
                    <CompactSettingRow
                      label="Connector"
                      meta="Select the backend target for your handoff tasks."
                      control={
                        <select
                          value={assistantOptions.selectedConnectorId ?? ''}
                          onChange={(event) => updateAssistantOptions({ selectedConnectorId: event.target.value })}
                          disabled={openClawState.connectors.length === 0}
                          className="fg-select w-[188px] px-3 py-2 text-sm"
                        >
                          {openClawState.connectors.length === 0 ? (
                            <option value="">No connector</option>
                          ) : (
                            openClawState.connectors.map((connector) => (
                              <option key={connector.id} value={connector.id}>
                                {connector.label}
                              </option>
                            ))
                          )}
                        </select>
                      }
                    />
                    
                    <CompactSettingRow
                      label="Model selector"
                      meta="Display-only today, but ready for future routing."
                      control={
                        <select
                          value={MODEL_PLACEHOLDER_OPTIONS.includes(assistantOptions.preferredModel.value as any) ? assistantOptions.preferredModel.value : MODEL_PLACEHOLDER_OPTIONS[0]}
                          onChange={(event) => updateAssistantOptions({ preferredModel: { value: event.target.value, updatedAt: null } })}
                          className="fg-select w-[172px] px-3 py-2 text-sm"
                        >
                          {MODEL_PLACEHOLDER_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      }
                    />

                    <CompactSettingRow
                      label="Notification timing"
                      meta={TASK_NOTIFICATION_MODE_OPTIONS.find((option) => option.value === assistantOptions.taskNotificationMode)?.description}
                      control={
                        <select
                          value={assistantOptions.taskNotificationMode}
                          onChange={(event) => updateAssistantOptions({ taskNotificationMode: event.target.value as TaskNotificationMode })}
                          className="fg-select w-[188px] px-3 py-2 text-sm"
                        >
                          {TASK_NOTIFICATION_MODE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      }
                    />

                    <CompactSettingRow
                      label="Session behavior"
                      meta="Reuse the current thread when you want continuity, or always start fresh."
                      control={
                        <Toggle
                          checked={assistantOptions.reuseActiveSession}
                          onChange={(checked) => updateAssistantOptions({ reuseActiveSession: checked })}
                        />
                      }
                    />

                    <CompactSettingRow
                      label="New session fallback"
                      meta="Automatically create a new session when nothing reusable exists, or require manual starts."
                      control={
                        <Toggle
                          checked={assistantOptions.autoCreateSession}
                          onChange={(checked) => updateAssistantOptions({ autoCreateSession: checked })}
                        />
                      }
                    />

                    <CompactSettingRow
                      label="Break telemetry"
                      meta="Share domain-only break telemetry during active breaks."
                      control={
                        <Toggle
                          checked={settings.breakTelemetryEnabled}
                          onChange={(checked) => updateSettings({ breakTelemetryEnabled: checked })}
                        />
                      }
                    />
                  </div>
                )}
              </SettingsGroup>

              <SettingsGroup
                className="rounded-lg border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2.5"
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
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr),340px]">
              <div className="fg-card relative overflow-hidden p-4">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold tracking-[-0.02em] text-[var(--fg-text)]">
                      Calendar Workspace
                    </h2>
                    <InfoTip text="Click an event to edit its exact allowlist. Drag an extended task set onto an occurrence to bind a sequenced checklist." />
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
                      slotMinTime={calendarTimeBounds.slotMinTime}
                      slotMaxTime={calendarTimeBounds.slotMaxTime}
                      scrollTime={calendarTimeBounds.scrollTime}
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
                        const chipElement = arg.el.querySelector<HTMLElement>('.fg-event-chip');
                        const dropTargets = uniqueElements([arg.el, chipElement]);
                        const setDropTargetActive = (active: boolean) => {
                          setExtendedTaskDropTargetState(dropTargets, active);
                        };
                        const isInternalDropTransition = (nextTarget: Node | null) =>
                          nextTarget !== null && dropTargets.some((target) => target.contains(nextTarget));
                        const bindDropHandlers = (element: HTMLElement) => {
                          element.ondragenter = (event: DragEvent) => {
                            if (!draggingExtendedTaskEntryRef.current) return;
                            event.preventDefault();
                            setDropTargetActive(true);
                          };
                          element.ondragover = (event: DragEvent) => {
                            if (!draggingExtendedTaskEntryRef.current) return;
                            event.preventDefault();
                            if (event.dataTransfer) {
                              event.dataTransfer.dropEffect = 'copy';
                            }
                            setDropTargetActive(true);
                          };
                          element.ondragleave = (event: DragEvent) => {
                            const nextTarget = event.relatedTarget as Node | null;
                            if (isInternalDropTransition(nextTarget)) {
                              return;
                            }
                            setDropTargetActive(false);
                          };
                          element.ondrop = (event: DragEvent) => {
                            event.preventDefault();
                            const draggedEntry = resolveDraggedExtendedTaskLibraryEntry({
                              draggingEntry: draggingExtendedTaskEntryRef.current,
                              plainTextPayload: event.dataTransfer?.getData('text/plain') ?? null,
                              customPayload: event.dataTransfer?.getData(EXTENDED_TASK_LIBRARY_DRAG_MIME) ?? null,
                              builtInTemplates: BUILT_IN_EXTENDED_TASK_TEMPLATES,
                              taskSets: extendedTaskSetsRef.current,
                            });
                            setDropTargetActive(false);
                            setDraggingExtendedTaskEntry(null);
                            if (!draggedEntry) return;
                            void assignExtendedTaskLibraryEntryToEvent(arg.event.id, draggedEntry);
                          };
                        };
                        dropTargets.forEach(bindDropHandlers);
                        arg.el.onfocus = () => {
                          openTooltipAtRect(arg.event.id, arg.el.getBoundingClientRect());
                        };
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
                  <div className="rounded-xl border border-dashed border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-8 py-12 text-center">
                    <p className="text-lg font-medium text-[var(--fg-text)]">Connect your calendar to unlock the workspace.</p>
                    <p className="mt-2 text-sm text-[var(--fg-muted)]">
                      Once connected, you’ll get a Google-Calendar-like view where each event can own its whitelist.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="fg-card p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-[var(--fg-text)]">Current / Selected Occurrence</h2>
                    <InfoTip text="If nothing is selected, this rail falls back to the current active event. Checking an item complete advances the next link for that occurrence." />
                  </div>

                  <div className="rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2.5">
                    {occurrenceExtendedTaskEvent ? (
                      <>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--fg-muted)]">
                          {selectedResolvedEvent ? 'Selected occurrence' : 'Current active occurrence'}
                        </p>
                        <p className="mt-2 text-sm font-semibold text-[var(--fg-text)]">
                          {occurrenceExtendedTaskEvent.title}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                          {formatEventRange(occurrenceExtendedTaskEvent)}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-[var(--fg-text)]">No occurrence selected</p>
                        <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                          Click a calendar event or wait for an active occurrence with an assigned extended task set.
                        </p>
                      </>
                    )}
                  </div>

                  {extendedTaskActionError ? (
                    <p className="mt-3 text-xs text-rose-600">{extendedTaskActionError}</p>
                  ) : null}

                  {occurrenceExtendedTaskAssignment ? (
                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-[var(--fg-text)]">
                            {occurrenceExtendedTaskAssignment.setTitle}
                          </p>
                          <p className="text-xs text-[var(--fg-muted)]">
                            {occurrenceExtendedTaskAssignment.items.length} linked step{occurrenceExtendedTaskAssignment.items.length === 1 ? '' : 's'}
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            void removeOccurrenceExtendedTaskAssignment(occurrenceExtendedTaskAssignment.calendarEventId);
                          }}
                          className="fg-button-ghost px-3 py-1.5 text-[11px]"
                        >
                          Remove
                        </button>
                      </div>

                      {(() => {
                        const allItems = occurrenceExtendedTaskAssignment.items;
                        const total = allItems.length;
                        const needsCollapse = total > OCCURRENCE_CHECKLIST_PREVIEW_COUNT;
                        const previewItems = occurrenceChecklistExpanded
                          ? allItems
                          : allItems.slice(0, OCCURRENCE_CHECKLIST_PREVIEW_COUNT);
                        return (
                          <>
                            {needsCollapse ? (
                              <p className="text-xs text-[var(--fg-muted)]">
                                {occurrenceChecklistExpanded
                                  ? `Showing all ${total} steps.`
                                  : `Showing ${previewItems.length} of ${total} steps.`}
                              </p>
                            ) : null}
                            <div
                              className={
                                occurrenceChecklistExpanded && needsCollapse
                                  ? 'max-h-[min(420px,70vh)] space-y-2 overflow-y-auto pr-1'
                                  : 'space-y-2'
                              }
                            >
                              {previewItems.map((item) => {
                                const completed = item.completedAt !== null;
                                const loading = completingExtendedTaskItemId === item.id;
                                const stepIndex = allItems.indexOf(item);
                                return (
                                  <div
                                    key={item.id}
                                    className={`flex items-start gap-3 rounded-[18px] border px-3 py-3 ${
                                      completed
                                        ? 'border-emerald-200 bg-emerald-50/70'
                                        : 'border-[var(--fg-border)] bg-white'
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      disabled={loading}
                                      onClick={() => {
                                        if (completed) {
                                          void uncompleteExtendedTaskAssignmentItem(
                                            occurrenceExtendedTaskAssignment.id,
                                            item.id,
                                          );
                                        } else {
                                          void completeExtendedTaskAssignmentItem(
                                            occurrenceExtendedTaskAssignment.id,
                                            item.id,
                                          );
                                        }
                                      }}
                                      className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold ${
                                        completed
                                          ? 'border-emerald-500 bg-emerald-500 text-white'
                                          : 'border-[var(--fg-border)] text-[var(--fg-muted)]'
                                      } ${loading ? 'opacity-50' : ''}`}
                                    >
                                      {completed ? '✓' : loading ? '…' : stepIndex + 1}
                                    </button>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <p
                                            className={`text-sm font-medium ${completed ? 'text-emerald-900 line-through' : 'text-[var(--fg-text)]'}`}
                                          >
                                            {item.label}
                                          </p>
                                          <p className="mt-1 break-all text-xs leading-5 text-[var(--fg-muted)]">
                                            {item.url}
                                          </p>
                                        </div>
                                        <a
                                          href={item.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="fg-button-ghost px-3 py-1.5 text-[11px]"
                                        >
                                          Open
                                        </a>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            {needsCollapse ? (
                              <button
                                type="button"
                                onClick={() => setOccurrenceChecklistExpanded((v) => !v)}
                                className="w-full rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2 text-center text-[11px] font-semibold text-[var(--fg-text)] transition hover:border-blue-200"
                              >
                                {occurrenceChecklistExpanded ? 'Show less' : `Show all ${total} steps`}
                              </button>
                            ) : null}
                          </>
                        );
                      })()}
                    </div>
                  ) : occurrenceExtendedTaskEvent ? (
                    <div className="mt-4 rounded-md border border-dashed border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-4">
                      <p className="text-sm font-medium text-[var(--fg-text)]">No extended tasks on this occurrence yet.</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                        Drag a roadmap onto this calendar event or use Apply from the library to bind an ordered checklist.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4">
                      <EmptyCard text="No occurrence checklist to show yet." />
                    </div>
                  )}
                </div>

                <div className="fg-card p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-[var(--fg-text)]">Extended Tasks</h2>
                      <InfoTip text="Drag a roadmap card onto any calendar event to bind a sequenced checklist to that occurrence. Duplicate a default roadmap to make it editable." />
                    </div>
                    <button
                      onClick={showExtendedTaskEditor ? closeExtendedTaskEditor : resetExtendedTaskSetDraft}
                      className="fg-button-secondary px-3 py-1.5 text-[11px]"
                    >
                      {showExtendedTaskEditor ? 'Close editor' : '+ New task set'}
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--fg-muted)]">
                            Default Roadmaps
                          </p>
                          <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                            Tap a roadmap to open its subgroup blocks. Both rows scroll horizontally.
                          </p>
                        </div>
                        <span className="rounded-full border border-[var(--fg-border)] bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
                          {leetcodeSubgroupEntries.length} blocks
                        </span>
                      </div>

                      <div className="overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        <div className="flex min-w-max gap-3">
                          {leetcodeMasterEntry ? (
                            <div
                              className={`min-w-[220px] max-w-[260px] rounded-lg border px-3 py-3 transition ${
                                draggingExtendedTaskEntry?.id === leetcodeMasterEntry.id &&
                                draggingExtendedTaskEntry.source === leetcodeMasterEntry.source
                                  ? 'border-blue-300 bg-blue-50/70'
                                  : 'border-[var(--fg-border)] bg-[var(--fg-panel-soft)] hover:border-blue-200'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex min-w-0 items-start gap-2">
                                  <ExtendedTaskDragGrip
                                    onDragStart={(event) => startExtendedTaskEntryDrag(leetcodeMasterEntry, event)}
                                    onDragEnd={() => setDraggingExtendedTaskEntry(null)}
                                  />
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="truncate text-sm font-medium text-[var(--fg-text)]">
                                        {leetcodeMasterEntry.title}
                                      </p>
                                      <span className="rounded-full border border-[var(--fg-border)] bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
                                        Roadmap
                                      </span>
                                    </div>
                                    <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                                      {leetcodeMasterEntry.items.length} total links across {leetcodeSubgroupEntries.length} subgroup blocks
                                    </p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedDefaultRoadmapId((current) =>
                                      current === leetcodeMasterEntry.id ? null : leetcodeMasterEntry.id,
                                    )
                                  }
                                  className="fg-button-ghost flex-shrink-0 px-2.5 py-1.5 text-[11px]"
                                >
                                  {expandedDefaultRoadmapId === leetcodeMasterEntry.id ? 'Collapse' : 'Expand'}
                                </button>
                              </div>

                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                {occurrenceExtendedTaskEvent ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void applyExtendedTaskLibraryEntryToOccurrence(leetcodeMasterEntry);
                                    }}
                                    className="fg-button-secondary px-3 py-1.5 text-[11px]"
                                  >
                                    {occurrenceApplyButtonLabel}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => {
                                    void duplicateBuiltInExtendedTaskTemplateDefinition(leetcodeMasterEntry.id);
                                  }}
                                  className="fg-button-ghost px-3 py-1.5 text-[11px]"
                                >
                                  Duplicate
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {expandedDefaultRoadmapId === BUILT_IN_LEETCODE_MASTER_TEMPLATE_ID ? (
                        <div className="mt-3 space-y-4">
                          <div>
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--fg-muted)]">
                                Subgroups
                              </p>
                              {leetcodeMasterEntry ? (
                                <button
                                  type="button"
                                  title="Open full list of subgroup names"
                                  className="fg-button-ghost px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                                  onClick={() =>
                                    setExtendedTaskListPreview({
                                      title: `${leetcodeMasterEntry.title} — subgroup blocks`,
                                      subtitle: `${leetcodeSubgroupEntries.length} blocks`,
                                      rows: leetcodeSubgroupEntries.map((e) => ({
                                        id: e.id,
                                        label: e.title,
                                      })),
                                    })
                                  }
                                >
                                  Full list
                                </button>
                              ) : null}
                            </div>
                            <div className="overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                              <div className="flex min-w-max gap-2">
                                {leetcodeSubgroupEntries.map((entry) => (
                                  <span
                                    key={entry.id}
                                    className="flex-shrink-0 rounded-full border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--fg-muted)]"
                                  >
                                    {entry.title}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div>
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--fg-muted)]">
                                LeetCode Blocks
                              </p>
                              <p className="text-[11px] text-[var(--fg-muted)]">
                                Scroll sideways to browse subgroup cards.
                              </p>
                            </div>
                            <div className="overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                              <div className="flex min-w-max gap-3">
                              {leetcodeSubgroupEntries.map((entry) => (
                                <ExtendedTaskLibraryCard
                                  key={`${entry.source}:${entry.id}`}
                                  entry={entry}
                                  dragging={
                                    draggingExtendedTaskEntry?.id === entry.id &&
                                    draggingExtendedTaskEntry.source === entry.source
                                  }
                                  applyLabel={occurrenceApplyButtonLabel}
                                  canApply={occurrenceExtendedTaskEvent !== null}
                                  className="min-w-[272px] max-w-[272px] snap-start"
                                  onApply={() => {
                                    void applyExtendedTaskLibraryEntryToOccurrence(entry);
                                  }}
                                  onDragStart={startExtendedTaskEntryDrag}
                                  onDragEnd={() => setDraggingExtendedTaskEntry(null)}
                                  onDuplicate={() => {
                                    void duplicateBuiltInExtendedTaskTemplateDefinition(entry.id);
                                  }}
                                  onPreviewAllItems={(previewEntry) =>
                                    setExtendedTaskListPreview({
                                      title: previewEntry.title,
                                      subtitle: `${previewEntry.items.length} link${previewEntry.items.length === 1 ? '' : 's'}`,
                                      rows: previewEntry.items.map((item) => ({
                                        id: item.id,
                                        label: item.label,
                                        url: item.url,
                                      })),
                                    })
                                  }
                                />
                              ))}
                            </div>
                          </div>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--fg-muted)]">
                            Your Task Sets
                          </p>
                          <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                            Editable sets you have saved. This rail also scrolls horizontally.
                          </p>
                        </div>
                        <span className="rounded-full border border-[var(--fg-border)] bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
                          {userExtendedTaskEntries.length} saved
                        </span>
                      </div>

                      <div className="overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        <div className="flex min-w-max gap-3">
                        {userExtendedTaskEntries.length > 0 ? (
                          userExtendedTaskEntries.map((entry) => (
                            <ExtendedTaskLibraryCard
                              key={`${entry.source}:${entry.id}`}
                              entry={entry}
                              dragging={
                                draggingExtendedTaskEntry?.id === entry.id &&
                                draggingExtendedTaskEntry.source === entry.source
                              }
                              applyLabel={occurrenceApplyButtonLabel}
                              canApply={occurrenceExtendedTaskEvent !== null}
                              className="min-w-[272px] max-w-[272px] snap-start"
                              onApply={() => {
                                void applyExtendedTaskLibraryEntryToOccurrence(entry);
                              }}
                              onDragStart={startExtendedTaskEntryDrag}
                              onDragEnd={() => setDraggingExtendedTaskEntry(null)}
                              onEdit={() => {
                                const taskSet = activeExtendedTaskSets.find((candidate) => candidate.id === entry.id);
                                if (taskSet) {
                                  loadExtendedTaskSetDraft(taskSet);
                                }
                              }}
                              onDelete={() => {
                                void deleteExtendedTaskSetDefinition(entry.id);
                              }}
                              onPreviewAllItems={(previewEntry) =>
                                setExtendedTaskListPreview({
                                  title: previewEntry.title,
                                  subtitle: `${previewEntry.items.length} link${previewEntry.items.length === 1 ? '' : 's'}`,
                                  rows: previewEntry.items.map((item) => ({
                                    id: item.id,
                                    label: item.label,
                                    url: item.url,
                                  })),
                                })
                              }
                            />
                          ))
                        ) : (
                          <div className="min-w-[272px] max-w-[272px]">
                            <div className="rounded-lg border border-dashed border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-5 text-center">
                              <p className="text-sm font-medium text-[var(--fg-text)]">No saved task sets yet</p>
                              <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">Duplicate a default roadmap to customise it, or click <strong>+ New task set</strong> to build from scratch.</p>
                            </div>
                          </div>
                        )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {showExtendedTaskEditor ? (
                    <div className="mt-4 rounded-lg border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-[var(--fg-text)]">
                            {editingExtendedTaskSetId ? 'Edit task set' : 'Create task set'}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                            Add ordered links. Window opens them one-by-one for a calendar occurrence.
                          </p>
                        </div>
                        <button onClick={closeExtendedTaskEditor} className="fg-button-ghost px-3 py-1.5 text-[11px]">
                          Cancel
                        </button>
                      </div>

                      <div className="mt-3 space-y-3">
                        <input
                          type="text"
                          value={extendedTaskSetTitle}
                          onChange={(event) => {
                            setExtendedTaskSetTitle(event.target.value);
                            setExtendedTaskSetError('');
                          }}
                          placeholder="e.g. Late code sprint"
                          className="fg-input"
                        />

                        <div className="space-y-2">
                          {extendedTaskSetItems.map((item, index) => (
                            <div key={item.id} className="rounded-[18px] border border-[var(--fg-border)] bg-white px-3 py-3">
                              <div className="grid gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--fg-border)] text-[10px] font-semibold text-[var(--fg-muted)]">
                                    {index + 1}
                                  </span>
                                  <input
                                    type="text"
                                    value={item.label}
                                    onChange={(event) => {
                                      setExtendedTaskSetItems((current) =>
                                        current.map((candidate) =>
                                          candidate.id === item.id
                                            ? { ...candidate, label: event.target.value }
                                            : candidate,
                                        ),
                                      );
                                      setExtendedTaskSetError('');
                                    }}
                                    placeholder="Label (e.g. Two Sum)"
                                    className="fg-input flex-1"
                                  />
                                </div>
                                <input
                                  type="url"
                                  value={item.url}
                                  onChange={(event) => {
                                    setExtendedTaskSetItems((current) =>
                                      current.map((candidate) =>
                                        candidate.id === item.id
                                          ? { ...candidate, url: event.target.value }
                                          : candidate,
                                      ),
                                    );
                                    setExtendedTaskSetError('');
                                  }}
                                  placeholder="https://leetcode.com/problems/two-sum/"
                                  className="fg-input"
                                />
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => {
                                      setExtendedTaskSetItems((current) => moveDraftArrayItem(current, index, index - 1));
                                    }}
                                    disabled={index === 0}
                                    className="fg-button-ghost px-2.5 py-1 text-[11px] disabled:opacity-30"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    onClick={() => {
                                      setExtendedTaskSetItems((current) => moveDraftArrayItem(current, index, index + 1));
                                    }}
                                    disabled={index === extendedTaskSetItems.length - 1}
                                    className="fg-button-ghost px-2.5 py-1 text-[11px] disabled:opacity-30"
                                  >
                                    ↓
                                  </button>
                                  <button
                                    onClick={() => {
                                      setExtendedTaskSetItems((current) =>
                                        current.length > 1
                                          ? current.filter((candidate) => candidate.id !== item.id)
                                          : [createEmptyExtendedTaskSetDraftItem()],
                                      );
                                    }}
                                    className="fg-button-ghost px-2.5 py-1 text-[11px] text-rose-500"
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        <button
                          onClick={() => {
                            setExtendedTaskSetItems((current) => [...current, createEmptyExtendedTaskSetDraftItem()]);
                          }}
                          className="fg-button-secondary px-3 py-2 text-[11px]"
                        >
                          + Add link
                        </button>

                        {extendedTaskSetError ? (
                          <p className="text-xs text-rose-600">{extendedTaskSetError}</p>
                        ) : null}

                        <button
                          onClick={() => {
                            void saveExtendedTaskSetDefinition();
                          }}
                          disabled={savingExtendedTaskSet}
                          className="fg-button-primary w-full px-4 py-2.5 text-sm"
                        >
                          {savingExtendedTaskSet ? 'Saving…' : editingExtendedTaskSetId ? 'Save changes' : 'Create task set'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-md border border-dashed border-[var(--fg-border)] bg-[var(--fg-panel-soft)]/60 px-3 py-2.5">
                      <p className="text-[11px] text-[var(--fg-muted)]">
                        Drag any roadmap card onto a calendar event to attach it as a checklist, or click <strong>+ New task set</strong> to build a custom one.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="mt-5">
              <div className="fg-card p-4">
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
          <div className="space-y-4">
            <AnalyticsWorkspace
              analyticsSnapshot={analyticsSnapshot}
              taskTags={taskTags}
              onRefresh={() => sendMessageAsync({ type: 'REFRESH_ANALYTICS_STATE' }).then(loadData)}
              onSaveOverride={saveSessionOverride}
            />
            <TagManager
              taskTags={taskTags}
              activeTaskTags={activeTaskTags}
              tagReferenceKeys={tagReferenceKeys}
              onSaveTag={saveTaskTagDefinition}
              onToggleArchive={toggleTaskTagArchive}
              onDeleteTag={deleteTaskTagDefinition}
            />
          </div>
        )}
      </div>

      {selectedResolvedEvent && selectedTooltip && (
        <EventRuleTooltip
          key={selectedResolvedEvent.event.id}
          ref={tooltipRef}
          resolvedEvent={selectedResolvedEvent}
          launchTarget={selectedEventLaunchTarget}
          extendedTaskAssignment={selectedExtendedTaskAssignment}
          onRemoveExtendedTaskAssignment={removeOccurrenceExtendedTaskAssignment}
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

      <ExtendedTaskListPreviewModal preview={extendedTaskListPreview} onClose={() => setExtendedTaskListPreview(null)} />
    </div>
  );
}

const EventRuleTooltip = React.forwardRef<HTMLDivElement, {
  resolvedEvent: ResolvedWorkspaceEvent;
  launchTarget: EventLaunchTarget | null;
  extendedTaskAssignment: ExtendedTaskAssignment | null;
  onRemoveExtendedTaskAssignment: (calendarEventId: string) => Promise<void>;
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
      extendedTaskAssignment,
      onRemoveExtendedTaskAssignment,
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
    const [secondaryTagKeys, setSecondaryTagKeys] = useState<string[]>(resolvedEvent.secondaryTagKeys);
    const [difficultyRank, setDifficultyRank] = useState<string>(
      resolvedEvent.difficultyRank ? String(resolvedEvent.difficultyRank) : '',
    );
    const [editing, setEditing] = useState(startsInEditing);
    const [editingLaunchTarget, setEditingLaunchTarget] = useState(false);
    const [error, setError] = useState('');
    const [launchError, setLaunchError] = useState('');
    const [savingLaunchTarget, setSavingLaunchTarget] = useState(false);
    const [removingExtendedTask, setRemovingExtendedTask] = useState(false);
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
      setSecondaryTagKeys(resolvedEvent.secondaryTagKeys);
      setDifficultyRank(resolvedEvent.difficultyRank ? String(resolvedEvent.difficultyRank) : '');
      setEditing(startsInEditing);
      setError('');
      setLaunchError('');
      setEditingLaunchTarget(false);
      setRemovingExtendedTask(false);
    }, [currentDomainsValue, currentLaunchUrlValue, resolvedEvent.difficultyRank, resolvedEvent.event.id, resolvedEvent.secondaryTagKeys, resolvedEvent.tagKey, startsInEditing]);

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
          className={`fixed z-50 w-[min(720px,calc(100vw-24px))] rounded-xl border border-white/80 bg-[rgba(255,255,255,0.98)] p-4 shadow-2xl ring-1 ring-[rgba(148,163,184,0.12)] ${
            mode === 'modal' ? 'max-h-[min(720px,calc(100vh-40px))] overflow-auto' : 'max-h-[min(720px,calc(100vh-32px))] overflow-auto'
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

          <div className="mb-4 rounded-md border border-[rgba(148,163,184,0.18)] bg-[linear-gradient(180deg,rgba(248,250,252,0.96),rgba(241,245,249,0.9))] px-3 py-2.5.5">
            <p className="text-sm font-medium text-[var(--fg-text)]">
              {summaryTitle}
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
              {summaryBody}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start lg:gap-5">
            <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-[rgba(148,163,184,0.16)] bg-[var(--fg-panel-soft)] px-3 py-2.5">
                <p className="text-sm font-medium text-[var(--fg-text)]">Primary tag</p>
                <select
                  value={tagKey}
                  onChange={(event) => setTagKey(event.target.value)}
                  disabled={!editing}
                  className="fg-select mt-2 w-full disabled:cursor-not-allowed disabled:bg-[rgba(248,250,252,0.92)] disabled:text-[var(--fg-muted)]"
                >
                  <option value="">No explicit tag</option>
                  {getSelectableTaskTags(taskTags, [tagKey, ...secondaryTagKeys]).map((tag) => (
                    <option key={tag.key} value={tag.key}>
                      {tag.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[var(--fg-muted)]">
                  Exact rules can pin a tag instead of relying on keyword inference.
                </p>
              </div>

              <div className="rounded-md border border-[rgba(148,163,184,0.16)] bg-[var(--fg-panel-soft)] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-[var(--fg-text)]">Secondary tags</p>
                  <InfoTip text="Optional supporting tags for this exact title. Window stores them on the session, but the main charts still group by the primary tag." />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {getSelectableTaskTags(taskTags, [tagKey, ...secondaryTagKeys])
                    .filter((tag) => tag.key !== tagKey)
                    .map((tag) => {
                      const selected = secondaryTagKeys.includes(tag.key);
                      return (
                        <button
                          key={tag.key}
                          type="button"
                          disabled={!editing && !selected}
                          onClick={() =>
                            setSecondaryTagKeys((current) =>
                              selected
                                ? current.filter((key) => key !== tag.key)
                                : [...current, tag.key].slice(0, 2),
                            )
                          }
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                            selected
                              ? 'border-[var(--fg-accent)] bg-[var(--fg-accent-soft)] text-[var(--fg-accent)]'
                              : 'border-[var(--fg-border)] bg-white text-[var(--fg-muted)]'
                          } disabled:cursor-not-allowed disabled:opacity-70`}
                        >
                          {tag.label}
                        </button>
                      );
                    })}
                </div>
                <p className="mt-2 text-xs text-[var(--fg-muted)]">
                  Select up to two. Archived tags stay hidden unless already attached here.
                </p>
              </div>

              <div className="rounded-md border border-[rgba(148,163,184,0.16)] bg-[var(--fg-panel-soft)] px-3 py-2.5">
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

            <div className="rounded-lg border border-[rgba(148,163,184,0.16)] bg-white px-4 py-4 shadow-sm">
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
                  <div className="mb-3 rounded-md border border-[rgba(59,130,246,0.14)] bg-[rgba(239,246,255,0.78)] px-3.5 py-3">
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
                            secondaryTagKeys,
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
                        setSecondaryTagKeys(resolvedEvent.secondaryTagKeys);
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

            </div>

            <div className="space-y-4">
              <div className="rounded-lg border border-[rgba(148,163,184,0.16)] bg-white px-4 py-4 shadow-sm">
                <div className="mb-3">
                  <p className="text-sm font-medium text-[var(--fg-text)]">Task set</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                    Occurrence checklist from Extended Tasks (right rail). This applies only to this calendar block, not every event with the same title.
                  </p>
                </div>
                {extendedTaskAssignment ? (
                  <div className="space-y-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--fg-text)]">{extendedTaskAssignment.setTitle}</p>
                      <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
                        {extendedTaskAssignment.items.length} linked step
                        {extendedTaskAssignment.items.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="max-h-[220px] space-y-1.5 overflow-y-auto rounded-md border border-[rgba(148,163,184,0.14)] bg-[var(--fg-panel-soft)] px-2.5 py-2">
                      {extendedTaskAssignment.items.slice(0, 12).map((item, index) => (
                        <div key={item.id} className="flex items-start justify-between gap-2 text-[11px] leading-snug">
                          <span
                            className={`min-w-0 flex-1 ${
                              item.completedAt !== null ? 'text-emerald-800 line-through' : 'text-[var(--fg-text)]'
                            }`}
                          >
                            <span className="font-semibold text-[var(--fg-muted)]">{index + 1}.</span> {item.label}
                          </span>
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex-shrink-0 font-medium text-[var(--fg-accent)]"
                          >
                            Open
                          </a>
                        </div>
                      ))}
                      {extendedTaskAssignment.items.length > 12 ? (
                        <p className="text-[10px] text-[var(--fg-muted)]">
                          +{extendedTaskAssignment.items.length - 12} more steps — scroll or use the workspace rail for the full list.
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      disabled={removingExtendedTask}
                      onClick={async () => {
                        setRemovingExtendedTask(true);
                        try {
                          await onRemoveExtendedTaskAssignment(resolvedEvent.event.id);
                          await onSaved();
                        } finally {
                          setRemovingExtendedTask(false);
                        }
                      }}
                      className="w-full rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                    >
                      {removingExtendedTask ? 'Removing…' : 'Remove task set from this occurrence'}
                    </button>
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-[var(--fg-muted)]">
                    No task set linked yet. Drag a roadmap card from <strong>Extended Tasks</strong> onto this event on the calendar.
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-[rgba(148,163,184,0.16)] bg-white px-4 py-4 shadow-sm">
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
                  <div className="rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3.5 py-3">
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
        </div>
      </>
    );
  },
);

EventRuleTooltip.displayName = 'EventRuleTooltip';

function ExtendedTaskListPreviewModal({
  preview,
  onClose,
}: {
  preview: ExtendedTaskListPreview | null;
  onClose: () => void;
}): React.JSX.Element | null {
  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [preview, onClose]);

  if (!preview) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-[rgba(9,14,30,0.14)] backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="extended-task-list-preview-title"
        className="fixed left-1/2 top-1/2 z-[70] w-[min(440px,calc(100vw-28px))] max-h-[min(520px,calc(100vh-40px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-white/80 bg-[rgba(255,255,255,0.98)] shadow-2xl ring-1 ring-[rgba(148,163,184,0.12)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--fg-border)] px-4 py-3">
          <div className="min-w-0">
            <h3 id="extended-task-list-preview-title" className="text-sm font-semibold text-[var(--fg-text)]">
              {preview.title}
            </h3>
            {preview.subtitle ? (
              <p className="mt-0.5 text-xs text-[var(--fg-muted)]">{preview.subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 rounded-full border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-1.5 text-xs font-medium text-[var(--fg-muted)] transition hover:bg-white hover:text-[var(--fg-text)]"
          >
            Close
          </button>
        </div>
        <ul className="max-h-[min(420px,calc(100vh-120px))] space-y-0 overflow-y-auto px-2 py-2">
          {preview.rows.map((row, index) => (
            <li
              key={row.id}
              className="flex items-start justify-between gap-2 rounded-md px-2 py-1.5 text-xs leading-snug text-[var(--fg-text)] hover:bg-[var(--fg-panel-soft)]"
            >
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-[var(--fg-muted)]">{index + 1}.</span> {row.label}
              </span>
              {row.url ? (
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-shrink-0 font-medium text-[var(--fg-accent)]"
                  onClick={(event) => event.stopPropagation()}
                >
                  Open
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function ExtendedTaskDragGrip({
  onDragStart,
  onDragEnd,
}: {
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}): React.JSX.Element {
  const dots = [
    [3, 3],
    [11, 3],
    [3, 9],
    [11, 9],
    [3, 15],
    [11, 15],
  ] as const;
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="mt-0.5 inline-flex cursor-grab select-none items-center justify-center rounded-md p-1 text-[var(--fg-muted)] active:cursor-grabbing"
      title="Drag onto a calendar occurrence"
      aria-label="Drag onto a calendar occurrence"
    >
      <svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true">
        {dots.map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="2" fill="currentColor" />
        ))}
      </svg>
    </div>
  );
}

function ExtendedTaskLibraryCard({
  entry,
  dragging,
  canApply,
  applyLabel,
  className,
  onApply,
  onDragStart,
  onDragEnd,
  onDuplicate,
  onEdit,
  onDelete,
  onPreviewAllItems,
}: {
  entry: ExtendedTaskLibraryEntry;
  dragging: boolean;
  canApply: boolean;
  applyLabel: string;
  className?: string;
  onApply?: () => void;
  onDragStart: (entry: ExtendedTaskLibraryEntry, event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDuplicate?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPreviewAllItems?: (entry: ExtendedTaskLibraryEntry) => void;
}): React.JSX.Element {
  return (
    <div
      className={`${className ?? ''} rounded-md border px-3 py-2.5 transition ${
        dragging
          ? 'border-blue-300 bg-blue-50/70'
          : 'border-[var(--fg-border)] bg-[var(--fg-panel-soft)] hover:border-blue-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <ExtendedTaskDragGrip
            onDragStart={(event) => onDragStart(entry, event)}
            onDragEnd={onDragEnd}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium text-[var(--fg-text)]">{entry.title}</p>
              <span className="rounded-full border border-[var(--fg-border)] bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
                {entry.source === 'built-in' ? 'Default' : 'Editable'}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
              {entry.items.length} link{entry.items.length === 1 ? '' : 's'} · drag onto a calendar occurrence
            </p>
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
          {canApply && onApply ? (
            <button onClick={onApply} className="fg-button-secondary px-3 py-1.5 text-[11px]">
              {applyLabel}
            </button>
          ) : null}
          {entry.source === 'built-in' && onDuplicate ? (
            <button onClick={onDuplicate} className="fg-button-ghost px-3 py-1.5 text-[11px]">
              Duplicate
            </button>
          ) : null}
          {entry.source === 'user' && onEdit ? (
            <button onClick={onEdit} className="fg-button-ghost px-3 py-1.5 text-[11px]">
              Edit
            </button>
          ) : null}
          {entry.source === 'user' && onDelete ? (
            <button onClick={onDelete} className="fg-button-ghost px-3 py-1.5 text-[11px] text-rose-600">
              Delete
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 space-y-1">
        {entry.items.slice(0, 3).map((item, index) => (
          <p key={item.id} className="truncate text-xs text-[var(--fg-muted)]">
            {index + 1}. {item.label}
          </p>
        ))}
        {entry.items.length > 3 && onPreviewAllItems ? (
          <button
            type="button"
            title="View full link list"
            aria-label={`View all ${entry.items.length} links in this set`}
            onClick={() => onPreviewAllItems(entry)}
            className="text-left text-xs font-medium text-[var(--fg-accent)] underline decoration-[var(--fg-accent)]/40 underline-offset-2 transition hover:decoration-[var(--fg-accent)]"
          >
            +{entry.items.length - 3} more
          </button>
        ) : entry.items.length > 3 ? (
          <p className="text-xs text-[var(--fg-muted)]">+{entry.items.length - 3} more</p>
        ) : null}
      </div>
    </div>
  );
}

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
    <div className="rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2.5">
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
    <div className="rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2.5">
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
            {getSelectableTaskTags(taskTags, [rule.tagKey ?? '']).map((tag) => (
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

function TagManager({
  taskTags,
  activeTaskTags,
  tagReferenceKeys,
  onSaveTag,
  onToggleArchive,
  onDeleteTag,
}: {
  taskTags: TaskTag[];
  activeTaskTags: TaskTag[];
  tagReferenceKeys: Set<string>;
  onSaveTag: (input: {
    existingKey?: string | null;
    label: string;
    color: string;
    aliases: string[];
    baselineDifficulty: DifficultyRank;
    alignedDomains: string[];
    supportiveDomains: string[];
    archivedAt?: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
  onToggleArchive: (tagKey: string, archived: boolean) => Promise<void>;
  onDeleteTag: (tagKey: string) => Promise<{ ok: boolean; error?: string }>;
}): React.JSX.Element {
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('#2563eb');
  const [aliases, setAliases] = useState('');
  const [baselineDifficulty, setBaselineDifficulty] = useState<string>('3');
  const [alignedDomains, setAlignedDomains] = useState('');
  const [supportiveDomains, setSupportiveDomains] = useState('');
  const [error, setError] = useState('');

  const filteredTags = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...taskTags]
      .filter((tag) => (showArchived ? true : tag.archivedAt === null))
      .filter((tag) => {
        if (!normalizedQuery) return true;
        const haystack = [
          tag.label,
          tag.key,
          ...tag.aliases,
          ...tag.alignedDomains,
          ...tag.supportiveDomains,
        ].join(' ').toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .sort(
        (left, right) =>
          Number(Boolean(left.archivedAt)) - Number(Boolean(right.archivedAt)) ||
          left.label.localeCompare(right.label),
      );
  }, [query, showArchived, taskTags]);

  return (
    <section className="fg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-[var(--fg-text)]">Tag Manager</h2>
          <InfoTip text="Manage reusable task tags, their default difficulty, and the domains Window should treat as aligned or supportive." />
        </div>
        <div className="text-xs text-[var(--fg-muted)]">
          Active tags: {activeTaskTags.length} · Archived tags: {taskTags.length - activeTaskTags.length}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tags, keys, domains…"
            className="fg-input w-[min(420px,100%)]"
          />
          <button
            className={`fg-button-secondary px-3 py-2 text-sm ${showArchived ? 'opacity-100' : 'opacity-80'}`}
            onClick={() => setShowArchived((value) => !value)}
          >
            {showArchived ? 'Showing archived' : 'Hide archived'}
          </button>
        </div>
        <button
          className="fg-button-primary px-4 py-2.5 text-sm"
          onClick={() => {
            setCreateOpen((value) => !value);
            setExpandedKey(null);
          }}
        >
          {createOpen ? 'Close' : 'New tag'}
        </button>
      </div>

      {createOpen ? (
        <div className="mb-4 rounded-lg border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] p-3">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr),140px,160px]">
            <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Research ops" className="fg-input" />
            <input value={color} onChange={(event) => setColor(event.target.value)} placeholder="#2563eb" className="fg-input" />
            <select value={baselineDifficulty} onChange={(event) => setBaselineDifficulty(event.target.value)} className="fg-select">
              <option value="1">1 · Routine</option>
              <option value="2">2 · Light</option>
              <option value="3">3 · Standard</option>
              <option value="5">5 · Demanding</option>
              <option value="8">8 · Deep</option>
            </select>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <input value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="aliases: research, analyze" className="fg-input" />
            <input value={alignedDomains} onChange={(event) => setAlignedDomains(event.target.value)} placeholder="aligned: github.com, figma.com" className="fg-input" />
            <input value={supportiveDomains} onChange={(event) => setSupportiveDomains(event.target.value)} placeholder="supportive: docs.google.com" className="fg-input" />
          </div>
          {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
          <div className="mt-2 flex justify-end">
            <button
              className="fg-button-primary px-4 py-2.5 text-sm"
              onClick={async () => {
                setError('');
                const result = await onSaveTag({
                  label,
                  color,
                  aliases: splitCommaList(aliases),
                  baselineDifficulty: parseDifficultyRank(baselineDifficulty) ?? 3,
                  alignedDomains: splitDomains(alignedDomains),
                  supportiveDomains: splitDomains(supportiveDomains),
                  archivedAt: null,
                });
                if (!result.ok) {
                  setError(result.error ?? 'Unable to save tag.');
                  return;
                }
                setLabel('');
                setColor('#2563eb');
                setAliases('');
                setAlignedDomains('');
                setSupportiveDomains('');
                setBaselineDifficulty('3');
                setCreateOpen(false);
              }}
            >
              Create Tag
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {filteredTags.length === 0 ? (
          <EmptyCard text="No matching tags." />
        ) : (
          filteredTags.map((tag) => (
            <TagManagerRow
              key={tag.key}
              tag={tag}
              isReferenced={tagReferenceKeys.has(tag.key)}
              isExpanded={expandedKey === tag.key}
              onToggleExpanded={() => setExpandedKey((value) => (value === tag.key ? null : tag.key))}
              onSaveTag={onSaveTag}
              onToggleArchive={onToggleArchive}
              onDeleteTag={onDeleteTag}
            />
          ))
        )}
      </div>
    </section>
  );
}

function TagManagerRow({
  tag,
  isReferenced,
  isExpanded,
  onToggleExpanded,
  onSaveTag,
  onToggleArchive,
  onDeleteTag,
}: {
  tag: TaskTag;
  isReferenced: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onSaveTag: (input: {
    existingKey?: string | null;
    label: string;
    color: string;
    aliases: string[];
    baselineDifficulty: DifficultyRank;
    alignedDomains: string[];
    supportiveDomains: string[];
    archivedAt?: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
  onToggleArchive: (tagKey: string, archived: boolean) => Promise<void>;
  onDeleteTag: (tagKey: string) => Promise<{ ok: boolean; error?: string }>;
}): React.JSX.Element {
  const [label, setLabel] = useState(tag.label);
  const [color, setColor] = useState(tag.color);
  const [aliases, setAliases] = useState(tag.aliases.join(', '));
  const [baselineDifficulty, setBaselineDifficulty] = useState<string>(String(tag.baselineDifficulty));
  const [alignedDomains, setAlignedDomains] = useState(tag.alignedDomains.join(', '));
  const [supportiveDomains, setSupportiveDomains] = useState(tag.supportiveDomains.join(', '));
  const [error, setError] = useState('');

  useEffect(() => {
    setLabel(tag.label);
    setColor(tag.color);
    setAliases(tag.aliases.join(', '));
    setBaselineDifficulty(String(tag.baselineDifficulty));
    setAlignedDomains(tag.alignedDomains.join(', '));
    setSupportiveDomains(tag.supportiveDomains.join(', '));
    setError('');
  }, [tag]);

  return (
    <div className="rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)]">
      <div className="grid grid-cols-[minmax(0,1fr),auto] items-center gap-3 px-3 py-2.5">
        <button className="min-w-0 text-left" onClick={onToggleExpanded}>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: tag.color }} />
            <p className="truncate text-sm font-medium text-[var(--fg-text)]">{tag.label}</p>
            <span className="hidden text-xs text-[var(--fg-muted)] md:inline">
              `{tag.key}` {tag.archivedAt ? '· Archived' : ''} {isReferenced ? '· In use' : ''}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
            Difficulty {tag.baselineDifficulty} · {tag.alignedDomains.length} aligned · {tag.supportiveDomains.length} supportive · {tag.aliases.length} alias{tag.aliases.length === 1 ? '' : 'es'}
          </p>
        </button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button className="fg-button-secondary px-3 py-2 text-sm" onClick={onToggleExpanded}>
            {isExpanded ? 'Close' : 'Edit'}
          </button>
          <button
            className="fg-button-secondary px-3 py-2 text-sm"
            onClick={() => onToggleArchive(tag.key, tag.archivedAt === null)}
          >
            {tag.archivedAt ? 'Unarchive' : 'Archive'}
          </button>
          <button
            className="fg-button-ghost px-3 py-2 text-sm text-rose-600"
            onClick={async () => {
              const result = await onDeleteTag(tag.key);
              if (!result.ok) {
                setError(result.error ?? 'Unable to delete tag.');
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {isExpanded ? (
        <div className="border-t border-[var(--fg-border)] px-3 py-3">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr),140px,160px]">
            <input value={label} onChange={(event) => setLabel(event.target.value)} className="fg-input" />
            <input value={color} onChange={(event) => setColor(event.target.value)} className="fg-input" />
            <select value={baselineDifficulty} onChange={(event) => setBaselineDifficulty(event.target.value)} className="fg-select">
              <option value="1">1 · Routine</option>
              <option value="2">2 · Light</option>
              <option value="3">3 · Standard</option>
              <option value="5">5 · Demanding</option>
              <option value="8">8 · Deep</option>
            </select>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <input value={aliases} onChange={(event) => setAliases(event.target.value)} className="fg-input" />
            <input value={alignedDomains} onChange={(event) => setAlignedDomains(event.target.value)} className="fg-input" />
            <input value={supportiveDomains} onChange={(event) => setSupportiveDomains(event.target.value)} className="fg-input" />
          </div>
          {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
          <div className="mt-2 flex justify-end">
            <button
              className="fg-button-primary px-4 py-2.5 text-sm"
              onClick={async () => {
                setError('');
                const result = await onSaveTag({
                  existingKey: tag.key,
                  label,
                  color,
                  aliases: splitCommaList(aliases),
                  baselineDifficulty: parseDifficultyRank(baselineDifficulty) ?? 3,
                  alignedDomains: splitDomains(alignedDomains),
                  supportiveDomains: splitDomains(supportiveDomains),
                  archivedAt: tag.archivedAt,
                });
                if (!result.ok) {
                  setError(result.error ?? 'Unable to save tag.');
                }
              }}
            >
              Save Tag
            </button>
          </div>
        </div>
      ) : null}
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
  const [metricsRange, setMetricsRange] = useState<'7d' | '30d'>('7d');
  const [consumptionRange, setConsumptionRange] = useState<'7d' | '30d' | '90d' | '365d'>('7d');

  const summary = metricsRange === '30d' ? analyticsSnapshot.summary30d : analyticsSnapshot.summary7d;
  const recentSessions = analyticsSnapshot.recentSessions.slice(0, 12);
  const consumptionPoints = useMemo(() => {
    if (consumptionRange === '30d') return analyticsSnapshot.consumptionTimeline30d;
    if (consumptionRange === '90d') return analyticsSnapshot.consumptionTimeline90d;
    if (consumptionRange === '365d') return analyticsSnapshot.consumptionTimeline365d;
    return analyticsSnapshot.consumptionTimeline7d;
  }, [analyticsSnapshot, consumptionRange]);

  const domainBreakdown = useMemo(() => {
    if (consumptionRange === '30d') return analyticsSnapshot.domainBreakdown30d;
    if (consumptionRange === '90d') return analyticsSnapshot.domainBreakdown90d;
    if (consumptionRange === '365d') return analyticsSnapshot.domainBreakdown365d;
    return analyticsSnapshot.domainBreakdown7d;
  }, [analyticsSnapshot, consumptionRange]);

  return (
    <div className="space-y-4">
      <section className="fg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.02em] text-[var(--fg-text)]">Analytics</h2>
            <p className="mt-1 text-sm text-[var(--fg-muted)]">
              Calendar-linked focus sessions, grouped by time quality, tags, and inferred difficulty.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] p-1">
              <button
                className={`rounded-full px-3 py-1 text-xs font-medium ${metricsRange === '7d' ? 'bg-white text-[var(--fg-text)]' : 'text-[var(--fg-muted)]'}`}
                onClick={() => setMetricsRange('7d')}
              >
                7d
              </button>
              <button
                className={`rounded-full px-3 py-1 text-xs font-medium ${metricsRange === '30d' ? 'bg-white text-[var(--fg-text)]' : 'text-[var(--fg-muted)]'}`}
                onClick={() => setMetricsRange('30d')}
              >
                30d
              </button>
            </div>
            <button onClick={onRefresh} className="fg-button-secondary px-3 py-2 text-sm">
              Refresh Analytics
            </button>
          </div>
        </div>

        <div className="mb-3 grid gap-3 xl:grid-cols-[minmax(0,1.45fr),repeat(3,minmax(0,0.55fr))]">
          <div className="rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2.5">
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

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr),minmax(0,0.92fr)]">
        <div className="fg-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--fg-text)]">Consumption graph</h3>
              <InfoTip text="Daily lines built from recorded sites and pages during active focus blocks. Productive, supportive, and distracted time are shown separately." />
            </div>
            <div className="rounded-full border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] p-1">
              {(['7d', '30d', '90d', '365d'] as const).map((range) => (
                <button
                  key={range}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${consumptionRange === range ? 'bg-white text-[var(--fg-text)]' : 'text-[var(--fg-muted)]'}`}
                  onClick={() => setConsumptionRange(range)}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
          <ConsumptionTimelineChart points={consumptionPoints} />
        </div>

        <div className="fg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--fg-text)]">Consumption map</h3>
            <InfoTip text="Top domains come from local browsing telemetry during focus sessions. Domain breakdowns beyond 7 days are approximations built from compact daily rollups." />
          </div>
          <div className="space-y-3">
            <ConsumptionBreakdownList items={domainBreakdown.slice(0, 8)} />
            {consumptionRange === '7d' ? (
              <div className="border-t border-[var(--fg-border)] pt-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--fg-muted)]">
                  Domain tree
                </p>
                <div className="mt-2">
                  <ConsumptionTreeView nodes={analyticsSnapshot.consumptionTree7d.slice(0, 8)} />
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2 text-xs text-[var(--fg-muted)]">
                Domain tree is shown for 7d only (it requires full session-resolution domain history).
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.84fr),minmax(0,1.16fr)]">
        <div className="space-y-4">
          <div className="fg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--fg-text)]">Time by tag</h3>
              <InfoTip text="Grouped by the primary task tag on each focus session so users can compare what categories actually get completed." />
            </div>
            <div className="space-y-2">
              {analyticsSnapshot.tagBreakdown7d.length === 0 ? (
                <EmptyCard text="No tagged focus sessions yet." />
              ) : (
                analyticsSnapshot.tagBreakdown7d.map((item) => (
                  <div
                    key={item.tagKey}
                    className="rounded-[18px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3.5 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
                        <p className="truncate text-sm font-medium text-[var(--fg-text)]">{item.label}</p>
                      </div>
                      <p className="text-xs text-[var(--fg-muted)]">{formatMinutes(item.productiveMinutes)}</p>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${tagBreakdownWidth(item.productiveMinutes, analyticsSnapshot.tagBreakdown7d)}%`,
                          background: item.color,
                        }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-[var(--fg-muted)]">
                      {item.sessions} session{item.sessions === 1 ? '' : 's'} · {formatMinutes(item.distractedMinutes)} distracted
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="fg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--fg-text)]">Difficulty matrix</h3>
              <InfoTip text="Difficulty is a five-rank scale. Focus score compares productive minutes against distracted and away time." />
            </div>
            <div className="space-y-2">
              {analyticsSnapshot.difficultyBreakdown7d.length === 0 ? (
                <EmptyCard text="No difficulty data yet." />
              ) : (
                analyticsSnapshot.difficultyBreakdown7d.map((item) => (
                  <div
                    key={item.difficultyRank}
                    className="rounded-[18px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3.5 py-3"
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
        </div>

        <div className="fg-card p-4">
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
    <div className="rounded-[18px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3.5 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--fg-muted)]">{label}</p>
      <p className="mt-1.5 text-xl font-semibold tracking-[-0.03em] text-[var(--fg-text)]">{value}</p>
    </div>
  );
}

function ConsumptionTimelineChart({
  points,
}: {
  points: ConsumptionTimelinePoint[];
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const max = Math.max(
    0,
    ...points.map((point) =>
      Math.max(point.productiveMinutes, point.supportiveMinutes, point.distractedMinutes),
    ),
  );

  if (points.length === 0 || max <= 0) {
    return <EmptyCard text="No page-level consumption has been recorded yet." />;
  }

  const chartWidth = 560;
  const chartHeight = 180;
  const paddingX = 14;
  const paddingY = 18;
  const effectiveIndex = hoverIndex ?? selectedIndex;
  const effectivePoint = effectiveIndex == null ? null : points[effectiveIndex] ?? null;
  const tickEvery = points.length <= 14 ? 1 : points.length <= 60 ? 7 : points.length <= 120 ? 14 : 30;

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="relative rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-3"
        onMouseLeave={() => setHoverIndex(null)}
      >
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="h-[180px] w-full"
          onMouseMove={(event) => {
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return;
            const x = event.clientX - rect.left;
            const innerWidth = rect.width;
            if (innerWidth <= 0) return;
            const index = Math.round((x / innerWidth) * (points.length - 1));
            setHoverIndex(Math.max(0, Math.min(points.length - 1, index)));
          }}
          onClick={() => {
            if (hoverIndex == null) return;
            setSelectedIndex(hoverIndex);
          }}
        >
          {points.map((point, index) => {
            const x = chartX(index, points.length, chartWidth, paddingX);
            return (
              <line
                key={point.date}
                x1={x}
                x2={x}
                y1={paddingY}
                y2={chartHeight - paddingY}
                stroke={index === points.length - 1 ? 'rgba(37,99,235,0.16)' : 'rgba(148,163,184,0.18)'}
                strokeDasharray="3 6"
              />
            );
          })}
          {effectiveIndex != null ? (
            <line
              x1={chartX(effectiveIndex, points.length, chartWidth, paddingX)}
              x2={chartX(effectiveIndex, points.length, chartWidth, paddingX)}
              y1={paddingY}
              y2={chartHeight - paddingY}
              stroke="rgba(37,99,235,0.28)"
              strokeWidth="2"
            />
          ) : null}
          <path d={buildLinePath(points, (point) => point.productiveMinutes, max, chartWidth, chartHeight, paddingX, paddingY)} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <path d={buildLinePath(points, (point) => point.supportiveMinutes, max, chartWidth, chartHeight, paddingX, paddingY)} fill="none" stroke="#0f766e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d={buildLinePath(points, (point) => point.distractedMinutes, max, chartWidth, chartHeight, paddingX, paddingY)} fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((point, index) => (
            <circle
              key={`${point.date}-productive`}
              cx={chartX(index, points.length, chartWidth, paddingX)}
              cy={chartY(point.productiveMinutes, max, chartHeight, paddingY)}
              r="3.5"
              fill="#2563eb"
            />
          ))}
        </svg>

        {effectivePoint ? (
          <div className="pointer-events-none absolute right-3 top-3 w-[240px] rounded-md border border-[var(--fg-border)] bg-white px-3 py-2 text-xs text-[var(--fg-text)] shadow-sm">
            <p className="font-medium">
              {new Date(effectivePoint.date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
              <span className="font-normal text-[var(--fg-muted)]">· {formatMinutes(effectivePoint.totalMinutes)} total</span>
            </p>
            <div className="mt-1 space-y-0.5 text-[var(--fg-muted)]">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: '#2563eb' }} />Productive</span>
                <span className="font-medium text-[var(--fg-text)]">{formatMinutes(effectivePoint.productiveMinutes)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: '#0f766e' }} />Supportive</span>
                <span className="font-medium text-[var(--fg-text)]">{formatMinutes(effectivePoint.supportiveMinutes)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: '#dc2626' }} />Distracted</span>
                <span className="font-medium text-[var(--fg-text)]">{formatMinutes(effectivePoint.distractedMinutes)}</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3 text-xs text-[var(--fg-muted)]">
          <ChartLegend color="#2563eb" label="Productive" />
          <ChartLegend color="#0f766e" label="Supportive" />
          <ChartLegend color="#dc2626" label="Distracted" />
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-[var(--fg-muted)]">
          {points.map((point, index) => {
            if (index % tickEvery !== 0 && index !== points.length - 1) return null;
            return (
              <span key={point.date}>
                {point.label} {formatMinutes(point.totalMinutes)}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ConsumptionBreakdownList({
  items,
}: {
  items: AnalyticsSnapshot['domainBreakdown7d'];
}): React.JSX.Element {
  const max = Math.max(0, ...items.map((item) => item.totalMinutes));

  if (items.length === 0) {
    return <EmptyCard text="No domains have been tracked yet." />;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.domain} className="rounded-[18px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3.5 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--fg-text)]">{item.label}</p>
              <p className="mt-1 text-xs text-[var(--fg-muted)]">
                {item.visits} visit{item.visits === 1 ? '' : 's'} · {humanizeActivityClass(item.primaryActivityClass)}
              </p>
            </div>
            <span className="text-xs font-medium text-[var(--fg-muted)]">{formatMinutes(item.totalMinutes)}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
            <div
              className={`h-full rounded-full ${activityBarClass(item.primaryActivityClass)}`}
              style={{ width: `${max > 0 ? (item.totalMinutes / max) * 100 : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ConsumptionTreeView({
  nodes,
}: {
  nodes: AnalyticsSnapshot['consumptionTree7d'];
}): React.JSX.Element {
  const max = Math.max(0, ...nodes.map((node) => node.totalMinutes));

  if (nodes.length === 0) {
    return <EmptyCard text="The domain tree will appear once page telemetry accumulates." />;
  }

  return (
    <div className="space-y-1">
      {nodes.map((node) => (
        <ConsumptionTreeNodeRow key={node.id} node={node} max={max} />
      ))}
    </div>
  );
}

function ConsumptionTreeNodeRow({
  node,
  max,
}: {
  node: AnalyticsSnapshot['consumptionTree7d'][number];
  max: number;
}): React.JSX.Element {
  const activityClass = dominantTreeActivityClass(node);

  return (
    <div className="space-y-1">
      <div
        className="grid grid-cols-[minmax(0,1fr),84px] items-center gap-3 border-b border-[var(--fg-border)] py-2 last:border-b-0"
        style={{ paddingLeft: `${node.depth * 14}px` }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${activityBarClass(activityClass)}`} />
            <p className="truncate text-sm font-medium text-[var(--fg-text)]">{node.label}</p>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--fg-panel-soft)]">
            <div
              className={`h-full rounded-full ${activityBarClass(activityClass)}`}
              style={{ width: `${max > 0 ? (node.totalMinutes / max) * 100 : 0}%` }}
            />
          </div>
        </div>
        <span className="text-right text-xs text-[var(--fg-muted)]">{formatMinutes(node.totalMinutes)}</span>
      </div>
      {node.children.slice(0, 4).map((child) => (
        <ConsumptionTreeNodeRow key={child.id} node={child} max={max} />
      ))}
    </div>
  );
}

function ChartLegend({
  color,
  label,
}: {
  color: string;
  label: string;
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
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
    <div className="rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2.5">
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
          {getSelectableTaskTags(taskTags, [tagKey]).map((tag) => (
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
    <div className="rounded-md border border-dashed border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-5 text-sm text-[var(--fg-muted)]">
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

function areRectsEqual(a: DOMRect, b: DOMRect): boolean {
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

function splitDomains(value: string): string[] {
  return value
    .split(',')
    .map((domain) => domain.trim())
    .filter(Boolean);
}

function splitCommaList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function safeHostname(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function getSelectableTaskTags(taskTags: TaskTag[], selectedKeys: string[] = []): TaskTag[] {
  const selected = new Set(selectedKeys.filter(Boolean));
  return taskTags.filter((tag) => tag.archivedAt === null || selected.has(tag.key));
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
  const titleMatches = inferTaskTagKeysFromText(event.title, taskTags);
  const descriptionMatches = inferTaskTagKeysFromText(event.description ?? '', taskTags, {
    excludeKeys: titleMatches,
  });
  const attendeeMatches = inferTaskTagKeysFromText(event.attendees.join(' '), taskTags, {
    excludeKeys: [...titleMatches, ...descriptionMatches],
  });
  const inferredTagKey =
    exactRule?.tagKey ??
    keywordRule?.tagKey ??
    titleMatches[0] ??
    descriptionMatches[0] ??
    attendeeMatches[0] ??
    inferTaskTagKeyFromTitle(event.title, taskTags);
  const secondaryTagKeys = exactRule
    ? exactRule.secondaryTagKeys
    : [...new Set([...titleMatches, ...descriptionMatches, ...attendeeMatches])]
        .filter((key) => key !== inferredTagKey)
        .slice(0, 2);
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
      secondaryTagKeys,
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
      secondaryTagKeys,
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
    secondaryTagKeys,
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

function deriveTimeGridWindow(events: CalendarEvent[]): {
  slotMinTime: string;
  slotMaxTime: string;
  scrollTime: string;
} {
  const timedEvents = events.filter((event) => !event.isAllDay);

  if (timedEvents.length === 0) {
    return {
      slotMinTime: minutesToTimeString(DEFAULT_TIME_GRID_START_MINUTES),
      slotMaxTime: minutesToTimeString(DEFAULT_TIME_GRID_END_MINUTES),
      scrollTime: minutesToTimeString(DEFAULT_TIME_GRID_START_MINUTES),
    };
  }

  let earliestStart = Number.POSITIVE_INFINITY;
  let latestEnd = Number.NEGATIVE_INFINITY;

  for (const event of timedEvents) {
    const startDate = new Date(event.start);
    const endDate = new Date(event.end);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      continue;
    }

    const startMinutes = minutesIntoDay(startDate);
    const spansMultipleDays =
      startDate.getFullYear() !== endDate.getFullYear() ||
      startDate.getMonth() !== endDate.getMonth() ||
      startDate.getDate() !== endDate.getDate();
    const endMinutes = spansMultipleDays ? 24 * 60 : minutesIntoDay(endDate);
    const safeEndMinutes = Math.max(startMinutes + TIME_GRID_ROUNDING_MINUTES, endMinutes);

    earliestStart = Math.min(earliestStart, startMinutes);
    latestEnd = Math.max(latestEnd, safeEndMinutes);
  }

  if (!Number.isFinite(earliestStart) || !Number.isFinite(latestEnd)) {
    return {
      slotMinTime: minutesToTimeString(DEFAULT_TIME_GRID_START_MINUTES),
      slotMaxTime: minutesToTimeString(DEFAULT_TIME_GRID_END_MINUTES),
      scrollTime: minutesToTimeString(DEFAULT_TIME_GRID_START_MINUTES),
    };
  }

  let minMinutes = roundMinutes(
    earliestStart - TIME_GRID_TOP_PADDING_MINUTES,
    TIME_GRID_ROUNDING_MINUTES,
    'down',
  );
  let maxMinutes = roundMinutes(
    latestEnd + TIME_GRID_BOTTOM_PADDING_MINUTES,
    TIME_GRID_ROUNDING_MINUTES,
    'up',
  );

  if (maxMinutes - minMinutes < MIN_TIME_GRID_SPAN_MINUTES) {
    const deficit = MIN_TIME_GRID_SPAN_MINUTES - (maxMinutes - minMinutes);
    minMinutes -= Math.floor(deficit / 2);
    maxMinutes += Math.ceil(deficit / 2);
  }

  minMinutes = Math.max(0, minMinutes);
  maxMinutes = Math.min(24 * 60, maxMinutes);

  if (maxMinutes - minMinutes < TIME_GRID_ROUNDING_MINUTES) {
    maxMinutes = Math.min(24 * 60, minMinutes + MIN_TIME_GRID_SPAN_MINUTES);
  }

  const scrollMinutes = Math.max(
    minMinutes,
    roundMinutes(earliestStart - TIME_GRID_ROUNDING_MINUTES, TIME_GRID_ROUNDING_MINUTES, 'down'),
  );

  return {
    slotMinTime: minutesToTimeString(minMinutes),
    slotMaxTime: minutesToTimeString(maxMinutes),
    scrollTime: minutesToTimeString(scrollMinutes),
  };
}

function minutesIntoDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function roundMinutes(
  value: number,
  increment: number,
  direction: 'down' | 'up',
): number {
  if (direction === 'down') {
    return Math.floor(value / increment) * increment;
  }

  return Math.ceil(value / increment) * increment;
}

function minutesToTimeString(totalMinutes: number): string {
  const clampedMinutes = Math.max(0, Math.min(24 * 60, totalMinutes));
  const hours = Math.floor(clampedMinutes / 60);
  const minutes = clampedMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
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

function chartX(
  index: number,
  count: number,
  width: number,
  paddingX: number,
): number {
  if (count <= 1) return width / 2;
  const usableWidth = width - paddingX * 2;
  return paddingX + (usableWidth / (count - 1)) * index;
}

function chartY(
  value: number,
  max: number,
  height: number,
  paddingY: number,
): number {
  const usableHeight = height - paddingY * 2;
  if (max <= 0) return height - paddingY;
  return height - paddingY - (value / max) * usableHeight;
}

function buildLinePath<T>(
  points: T[],
  getValue: (point: T) => number,
  max: number,
  width: number,
  height: number,
  paddingX: number,
  paddingY: number,
): string {
  return points
    .map((point, index) => {
      const x = chartX(index, points.length, width, paddingX);
      const y = chartY(getValue(point), max, height, paddingY);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
}

function tagBreakdownWidth(
  productiveMinutes: number,
  items: AnalyticsSnapshot['tagBreakdown7d'],
): number {
  const max = Math.max(0, ...items.map((item) => item.productiveMinutes));
  return max > 0 ? (productiveMinutes / max) * 100 : 0;
}

function humanizeActivityClass(value: 'aligned' | 'supportive' | 'distracted' | 'away' | 'break'): string {
  if (value === 'aligned') return 'Mostly productive';
  if (value === 'supportive') return 'Mostly supportive';
  if (value === 'distracted') return 'Mostly distracted';
  if (value === 'away') return 'Mostly away';
  return 'Mostly on break';
}

function activityBarClass(value: 'aligned' | 'supportive' | 'distracted' | 'away' | 'break'): string {
  if (value === 'aligned') return 'bg-blue-600';
  if (value === 'supportive') return 'bg-emerald-600';
  if (value === 'distracted') return 'bg-rose-500';
  if (value === 'away') return 'bg-slate-400';
  return 'bg-amber-500';
}

function dominantTreeActivityClass(
  node: AnalyticsSnapshot['consumptionTree7d'][number],
): 'aligned' | 'supportive' | 'distracted' | 'away' | 'break' {
  const entries: Array<['aligned' | 'supportive' | 'distracted' | 'away' | 'break', number]> = [
    ['aligned', node.productiveMinutes],
    ['supportive', node.supportiveMinutes],
    ['distracted', node.distractedMinutes],
    ['away', node.awayMinutes],
    ['break', node.breakMinutes],
  ];
  return entries.sort((a, b) => b[1] - a[1])[0][0];
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

function safeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `extended-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createEmptyExtendedTaskSetDraftItem(): ExtendedTaskSetDraftItem {
  return {
    id: safeId(),
    label: '',
    url: '',
  };
}

function moveDraftArrayItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (toIndex < 0 || toIndex >= items.length || fromIndex === toIndex) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function uniqueElements<T extends HTMLElement>(elements: Array<T | null | undefined>): T[] {
  return [...new Set(elements.filter((element): element is T => element instanceof HTMLElement))];
}

function setExtendedTaskDropTargetState(elements: HTMLElement[], active: boolean): void {
  for (const element of elements) {
    if (active) {
      element.dataset.windowDropTarget = 'true';
      continue;
    }

    delete element.dataset.windowDropTarget;
  }
}

function clearExtendedTaskDropTargets(): void {
  document
    .querySelectorAll<HTMLElement>('[data-window-drop-target="true"]')
    .forEach((element) => delete element.dataset.windowDropTarget);
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
