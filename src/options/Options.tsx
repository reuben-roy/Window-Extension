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
import { removeEventRule, removeKeywordRule, upsertKeywordRule } from '../shared/eventRules';
import { addToGlobalAllowlist, removeFromGlobalAllowlist } from '../shared/profiles';
import {
  formatBlockingPauseTimeLabel,
  isDailyBlockingPauseActive,
} from '../shared/blockingSchedule';
import {
  DEFAULT_LEARNING_TAXONOMY,
  isBlockingFeatureEnabled,
} from '../shared/learning';
import AccountStatusControl from '../shared/components/AccountStatusControl';
import CompactSettingRow from '../shared/components/CompactSettingRow';
import InfoTip from '../shared/components/InfoTip';
import Toggle from '../shared/components/Toggle';
import SettingsGroup from '../shared/components/SettingsGroup';
import { EventRuleTooltip } from './components/EventRuleTooltip';
import {
  ExtendedTaskDragGrip,
  ExtendedTaskLibraryCard,
  ExtendedTaskListPreviewModal,
} from './components/ExtendedTaskLibrary';
import { CalendarEventChip } from './components/CalendarEventChip';
import { KeywordRuleListItem, RuleListItem } from './components/RuleListItems';
import { TagManager } from './components/TagManager';
import { AnalyticsWorkspace } from './components/AnalyticsWorkspace';
import { EmptyCard } from './components/EmptyCard';
import { LearningWorkspace } from './components/LearningWorkspace';
import {
  areRectsEqual,
  calendarEventAppearance,
  chooseTooltipPosition,
  clearExtendedTaskDropTargets,
  createEmptyExtendedTaskSetDraftItem,
  deriveTimeGridWindow,
  formatEventRange,
  moveDraftArrayItem,
  resolveWorkspaceEvent,
  safeId,
  sendMessageAsync,
  setExtendedTaskDropTargetState,
  splitDomains,
  uniqueElements,
} from './lib';
import type {
  ExtendedTaskListPreview,
  ExtendedTaskSetDraftItem,
  ResolvedWorkspaceEvent,
  TooltipMode,
  TooltipPlacement,
} from './lib';
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
  getLearningState,
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
import { findEventLaunchTarget } from '../shared/launchTargets';
import {
  ensureDefaultTaskTags,
  findTaskTag,
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
  DifficultyRank,
  DownloadRedirectFallbackSeconds,
  ExtendedTaskAssignment,
  ExtendedTaskLibraryEntry,
  ExtendedTaskSet,
  EventLaunchTarget,
  EventRule,
  KeywordRule,
  LearningState,
  OpenClawInstanceConnectionTest,
  OpenClawInstanceSettings,
  OpenClawState,
  Settings,
  TaskNotificationMode,
  TaskTag,
  UserLearningTopic,
} from '../shared/types';

type CalendarView = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay';

interface SelectedTooltipState {
  eventId: string;
  anchorRect: DOMRect;
}

const OCCURRENCE_CHECKLIST_PREVIEW_COUNT = 5;

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

type SurfaceTab = 'learning' | 'calendar' | 'analytics' | 'settings';

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
  const [surfaceTab, setSurfaceTab] = useState<SurfaceTab>(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash === 'calendar' || hash === 'workspace') return 'calendar';
    if (hash === 'analytics') return 'analytics';
    if (hash === 'settings') return 'settings';
    return 'learning';
  });
  const [selectedTooltip, setSelectedTooltip] = useState<SelectedTooltipState | null>(null);
  const [tooltipMode, setTooltipMode] = useState<TooltipMode>('anchored');
  const [tooltipPlacement, setTooltipPlacement] = useState<TooltipPlacement>('bottom');
  const [expandedDefaultRoadmapId, setExpandedDefaultRoadmapId] = useState<string | null>(
    BUILT_IN_LEETCODE_MASTER_TEMPLATE_ID,
  );
  const [accountUser, setAccountUserState] = useState<AccountUser | null>(null);
  const [accountSyncState, setAccountSyncStateState] = useState<AccountSyncState | null>(null);
  const [accountConflict, setAccountConflictState] = useState<AccountConflict | null>(null);
  const [learningState, setLearningStateState] = useState<LearningState | null>(null);
  const [learningSearch, setLearningSearch] = useState('');
  const [customLearningTopic, setCustomLearningTopic] = useState('');
  const [learningActionBusy, setLearningActionBusy] = useState<false | 'save' | 'custom' | string>(false);
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
      nextLearningState,
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
      getLearningState(),
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
    setLearningStateState(nextLearningState);
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
    void sendMessageAsync({ type: 'REFRESH_LEARNING_STATE' }).catch(() => undefined);
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
        'openClawState' in changes ||
        'learningState' in changes
      ) {
        loadData();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    const nextHash = surfaceTab === 'learning' ? '' : `#${surfaceTab}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', `${window.location.pathname}${nextHash}`);
    }
  }, [surfaceTab]);

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
  const occurrenceApplyButtonLabel = selectedResolvedEvent ? 'Apply to selected block' : 'Apply to current block';

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

  const updateFeatureFlag = async (
    key: keyof Settings['featureFlags'],
    enabled: boolean,
  ) => {
    if (!settings) return;
    const next: Settings = {
      ...settings,
      enableBlocking:
        key === 'blocking' && !enabled
          ? false
          : settings.enableBlocking,
      featureFlags: {
        ...settings.featureFlags,
        [key]: enabled,
      },
    };
    setLocalSettings(next);
    await setSettings(next);
    await loadData();
  };

  const updateLearningSettings = async (patch: Partial<Settings['learningSettings']>) => {
    if (!settings) return;
    const next: Settings = {
      ...settings,
      learningSettings: {
        ...settings.learningSettings,
        ...patch,
      },
    };
    setLocalSettings(next);
    await setSettings(next);
    await loadData();
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
    if (!isBlockingFeatureEnabled(settings) && enabled) return;
    setLocalSettings({ ...settings, enableBlocking: enabled });
    chrome.runtime.sendMessage(
      { type: 'TOGGLE_BLOCKING', payload: { enabled } },
      () => {
        loadData();
      },
    );
  };

  const calendarApi = () => calendarRef.current?.getApi();

  const handleSaveLearningTopics = useCallback(
    async (topics: UserLearningTopic[]) => {
      setLearningActionBusy('save');
      try {
        await sendMessageAsync({
          type: 'SAVE_USER_LEARNING_TOPICS',
          payload: {
            topics: topics.map((topic) => ({
              topicKey: topic.topicKey,
              label: topic.label,
              subjectKey: topic.subjectKey,
              source: topic.source,
            })),
          },
        });
        await loadData();
      } finally {
        setLearningActionBusy(false);
      }
    },
    [],
  );

  const handleCreateCustomLearningTopic = useCallback(async () => {
    if (!customLearningTopic.trim()) return;
    setLearningActionBusy('custom');
    try {
      await sendMessageAsync({
        type: 'CREATE_CUSTOM_LEARNING_TOPIC',
        payload: {
          label: customLearningTopic.trim(),
        },
      });
      setCustomLearningTopic('');
      await loadData();
    } finally {
      setLearningActionBusy(false);
    }
  }, [customLearningTopic]);

  const handleRegenerateLearningPack = useCallback(async (packId: string) => {
    setLearningActionBusy(packId);
    try {
      await sendMessageAsync({
        type: 'REGENERATE_LEARNING_PACK',
        payload: { packId },
      });
      await loadData();
    } finally {
      setLearningActionBusy(false);
    }
  }, []);

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

  const selectedLearningTopicKeys = new Set(
    (learningState?.userTopics ?? []).map((topic) => topic.topicKey),
  );
  const selectedLearningTopics = learningState?.userTopics ?? [];
  const learningTaxonomy = learningState?.taxonomy?.length ? learningState.taxonomy : DEFAULT_LEARNING_TAXONOMY;
  const learningPacks = learningState?.packs ?? [];
  const learningReviewQueue = learningState?.reviewQueue ?? [];
  const filteredLearningTaxonomy = learningSearch.trim()
    ? learningTaxonomy
        .map((subject) => ({
          ...subject,
          topics: subject.topics.filter((topic) =>
            `${subject.label} ${topic.label} ${topic.description}`.toLowerCase().includes(learningSearch.trim().toLowerCase()),
          ),
        }))
        .filter((subject) => subject.topics.length > 0)
    : learningTaxonomy;

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
            onClick={() => setSurfaceTab('learning')}
            className={surfaceTab === 'learning' ? 'fg-segment-active' : 'fg-segment'}
          >
            Learn
          </button>
          <button
            onClick={() => setSurfaceTab('calendar')}
            className={surfaceTab === 'calendar' ? 'fg-segment-active' : 'fg-segment'}
          >
            Calendar
          </button>
          <button
            onClick={() => setSurfaceTab('analytics')}
            className={surfaceTab === 'analytics' ? 'fg-segment-active' : 'fg-segment'}
          >
            Analytics
          </button>
          <button
            onClick={() => setSurfaceTab('settings')}
            className={surfaceTab === 'settings' ? 'fg-segment-active' : 'fg-segment'}
          >
            Settings
          </button>
        </div>

        {surfaceTab === 'settings' ? (
          <section className="mx-auto mb-5 w-full max-w-3xl space-y-4">
            <div className="fg-card p-4">
              <h2 className="text-sm font-semibold text-[var(--fg-text)]">Features</h2>
              <p className="mt-1 text-xs text-[var(--fg-muted)]">
                Turn Window's building blocks on or off. Saved rules and history stay intact while a feature is off.
              </p>
              <div className="mt-3 overflow-hidden rounded-lg border border-[var(--fg-border)] bg-[var(--fg-panel-soft)]/55">
                <CompactSettingRow
                  className="px-4"
                  label="Blocking"
                  meta="Restrict browsing around the current calendar block with allowlists, overrides, and quiet hours."
                  control={
                    <Toggle
                      checked={settings.featureFlags.blocking}
                      onChange={(checked) => void updateFeatureFlag('blocking', checked)}
                    />
                  }
                />
                <CompactSettingRow
                  className="border-t border-[var(--fg-border)] px-4"
                  label="Routines"
                  meta="Auto-surface the right tabs, checklists, and long-range workflows when a calendar block starts."
                  control={
                    <Toggle
                      checked={settings.featureFlags.routines}
                      onChange={(checked) => void updateFeatureFlag('routines', checked)}
                    />
                  }
                />
                <CompactSettingRow
                  className="border-t border-[var(--fg-border)] px-4"
                  label="Learning"
                  meta="Pick study topics, generate shared quiz packs, and run spaced review inside Window."
                  control={
                    <Toggle
                      checked={settings.featureFlags.learning}
                      onChange={(checked) => void updateFeatureFlag('learning', checked)}
                    />
                  }
                />
              </div>
            </div>

            <div className="fg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="text-sm font-semibold text-[var(--fg-text)]">Focus & blocking</h2>
                <span className="rounded-full border border-[var(--fg-border)] bg-white px-3 py-1 text-[11px] font-medium text-[var(--fg-muted)]">
                  {isConnected ? 'Calendar connected' : 'Calendar disconnected'}
                </span>
              </div>

              <div className="mt-4 overflow-hidden rounded-lg border border-[var(--fg-border)] bg-[var(--fg-panel-soft)]/55">
                  <CompactSettingRow
                    className="px-4"
                    label="Blocking"
                    meta={
                      !isBlockingFeatureEnabled(settings)
                        ? 'Turn the Blocking feature on under Features above to enforce restrictions.'
                        : quietHoursActive
                        ? `Daily cutoff active after ${formatBlockingPauseTimeLabel(settings.dailyBlockingPauseStartTime)}`
                        : 'Turns restriction rules on or off instantly.'
                    }
                    control={
                      <Toggle
                        checked={isBlockingFeatureEnabled(settings) && settings.enableBlocking}
                        disabled={!isBlockingFeatureEnabled(settings)}
                        onChange={updateBlockingEnabled}
                      />
                    }
                  />

                  <CompactSettingRow
                    className="border-t border-[var(--fg-border)] px-4"
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
                    className="border-t border-[var(--fg-border)] px-4"
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
                    className="border-t border-[var(--fg-border)] px-4"
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

              <SettingsGroup
                className="fg-card p-4"
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
                className="fg-card p-4"
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
                className="fg-card p-4"
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
                className="fg-card p-4"
                title="Keyword rules"
                subtitle={`${keywordRules.length} saved fallback rule${keywordRules.length === 1 ? '' : 's'}`}
                hint="Longest keyword match wins. Exact Event Rules always override these fallbacks."
                collapsible
                defaultOpen={false}
                bodyClassName="mt-3 space-y-3"
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
          </section>
        ) : null}

        {surfaceTab === 'calendar' ? (
          <>
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr),340px]">
              <div className="fg-card relative overflow-hidden p-4">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold tracking-[-0.02em] text-[var(--fg-text)]">
                      Calendar Workspace
                    </h2>
                    <InfoTip text="Click an event to edit its exact allowlist. Drag a routine card onto an occurrence to bind a sequenced checklist." />
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
                          Click a calendar event or wait for an active occurrence with an assigned routine.
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
                                      className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold ${
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
                      <p className="text-sm font-medium text-[var(--fg-text)]">No routine on this occurrence yet.</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                        Drag a routine card onto this calendar event or use Apply from the library to bind an ordered checklist.
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
                      <h2 className="text-sm font-semibold text-[var(--fg-text)]">Routines</h2>
                      <InfoTip text="Drag a routine card onto any calendar event to bind a sequenced checklist to that occurrence. Duplicate a default template to make it editable." />
                    </div>
                    <button
                      onClick={showExtendedTaskEditor ? closeExtendedTaskEditor : resetExtendedTaskSetDraft}
                      className="fg-button-secondary px-3 py-1.5 text-[11px]"
                    >
                      {showExtendedTaskEditor ? 'Close editor' : '+ New routine'}
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
                        <span className="rounded-full border border-[var(--fg-border)] bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
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
                                      <span className="rounded-full border border-[var(--fg-border)] bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
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
                                  className="fg-button-ghost px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]"
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
                            Your Routines
                          </p>
                          <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                            Editable routines you have saved. This rail also scrolls horizontally.
                          </p>
                        </div>
                        <span className="rounded-full border border-[var(--fg-border)] bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
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
                              <p className="text-sm font-medium text-[var(--fg-text)]">No saved routines yet</p>
                              <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">Duplicate a default roadmap to customise it, or click <strong>+ New routine</strong> to build from scratch.</p>
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
                            {editingExtendedTaskSetId ? 'Edit routine' : 'Create routine'}
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
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--fg-border)] text-[11px] font-semibold text-[var(--fg-muted)]">
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
                          {savingExtendedTaskSet ? 'Saving…' : editingExtendedTaskSetId ? 'Save routine' : 'Create routine'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-md border border-dashed border-[var(--fg-border)] bg-[var(--fg-panel-soft)]/60 px-3 py-2.5">
                      <p className="text-[11px] text-[var(--fg-muted)]">
                        Drag any routine card onto a calendar event to attach it as a checklist, or click <strong>+ New routine</strong> to build a custom one.
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
        ) : surfaceTab === 'learning' ? (
          <LearningWorkspace
            settings={settings}
            learningState={learningState}
            allTaxonomy={learningTaxonomy}
            taxonomy={filteredLearningTaxonomy}
            selectedTopics={selectedLearningTopics}
            selectedTopicKeys={selectedLearningTopicKeys}
            packs={learningPacks}
            reviewQueue={learningReviewQueue}
            search={learningSearch}
            customTopic={customLearningTopic}
            learningActionBusy={learningActionBusy}
            onSearchChange={setLearningSearch}
            onCustomTopicChange={setCustomLearningTopic}
            onSaveTopics={handleSaveLearningTopics}
            onCreateCustomTopic={handleCreateCustomLearningTopic}
            onRegeneratePack={handleRegenerateLearningPack}
            onUpdateLearningSettings={updateLearningSettings}
            onRefresh={() => sendMessageAsync({ type: 'REFRESH_LEARNING_STATE' }).then(loadData)}
          />
        ) : surfaceTab === 'analytics' ? (
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
        ) : null}
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

