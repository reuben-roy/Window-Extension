import React, { useCallback, useEffect, useState } from 'react';
import type {
  AssistantTaskRecord,
  CalendarEvent,
  IdeaRecord,
  OpenClawSessionSummary,
  StateResponse,
  TaskNotificationMode,
} from '../shared/types';
import { formatBlockingPauseTimeLabel, isDailyBlockingPauseActive } from '../shared/blockingSchedule';
import AccountStatusControl from '../shared/components/AccountStatusControl';
import CompactSettingRow from '../shared/components/CompactSettingRow';
import InfoTip from '../shared/components/InfoTip';
import PointsBubble from '../shared/components/PointsBubble';
import CompletionModal from './components/CompletionModal';
import PointsDisplay from './components/PointsDisplay';
import TaskQueue from './components/TaskQueue';

type PanelSectionId = 'focus' | 'analytics' | 'controls' | 'assistant';

const PANEL_LAYOUT_STORAGE_KEY = 'panelLayoutPrefs';
const DEFAULT_PANEL_ORDER: PanelSectionId[] = ['focus', 'analytics', 'controls', 'assistant'];
const DEFAULT_PANEL_COLLAPSED: Record<PanelSectionId, boolean> = {
  focus: false,
  analytics: true,
  controls: true,
  assistant: false,
};
const SECTION_TITLES: Record<PanelSectionId, string> = {
  focus: 'Focus',
  analytics: 'Analytics',
  controls: 'Controls',
  assistant: 'Assistant',
};
const SECTION_HINTS: Record<PanelSectionId, string> = {
  focus: 'Current focus state, next event, and task progress.',
  analytics: 'Compact productivity analytics. Open the full workspace for deeper breakdowns.',
  controls: 'Keep the day moving with break, surface, and settings controls.',
  assistant: 'Connector routing, async handoff, sessions, telemetry, and idea capture.',
};


const POPUP_WIDTH_PX = 460;
const POPUP_MIN_HEIGHT_PX = 420;

export default function Popup({
  mode = 'popup',
}: {
  mode?: 'popup' | 'panel';
} = {}): React.JSX.Element {
  const [state, setState] = useState<StateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [submittingIdea, setSubmittingIdea] = useState(false);
  const [submittingAssistantTask, setSubmittingAssistantTask] = useState(false);
  const [assistantTaskInput, setAssistantTaskInput] = useState('');
  const [assistantTaskError, setAssistantTaskError] = useState<string | null>(null);
  const [ideaInput, setIdeaInput] = useState('');
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const [panelOrder, setPanelOrder] = useState<PanelSectionId[]>(DEFAULT_PANEL_ORDER);
  const [panelCollapsed, setPanelCollapsed] = useState<Record<PanelSectionId, boolean>>(DEFAULT_PANEL_COLLAPSED);
  const [draggedSection, setDraggedSection] = useState<PanelSectionId | null>(null);
  const [dropTargetSection, setDropTargetSection] = useState<PanelSectionId | null>(null);

  const loadState = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response: unknown) => {
      if (chrome.runtime.lastError) {
        setState(null);
        setLoadError(chrome.runtime.lastError.message ?? 'Window could not load the latest extension state.');
        setLoading(false);
        return;
      }

      if (!isStateResponse(response)) {
        setState(null);
        setLoadError('Window could not load the latest extension state.');
        setLoading(false);
        return;
      }

      setState(response);
      setLoadError(null);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    loadState();
    chrome.runtime.sendMessage({ type: 'REFRESH_ACCOUNT_STATE' });
    chrome.runtime.sendMessage({ type: 'REFRESH_ASSISTANT_STATE' });
    chrome.runtime.sendMessage({ type: 'REFRESH_ANALYTICS_STATE' });
    const listener = () => loadState();
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [loadState]);

  useEffect(() => {
    chrome.storage.local.get(PANEL_LAYOUT_STORAGE_KEY, (result) => {
      const prefs = result[PANEL_LAYOUT_STORAGE_KEY];
      if (prefs?.order && Array.isArray(prefs.order) && prefs.order.length === DEFAULT_PANEL_ORDER.length) {
        setPanelOrder(prefs.order as PanelSectionId[]);
      }
      if (prefs?.collapsed && typeof prefs.collapsed === 'object') {
        setPanelCollapsed((prev) => ({ ...prev, ...(prefs.collapsed as Record<PanelSectionId, boolean>) }));
      }
    });
  }, []);

  const movePanelSection = useCallback((source: PanelSectionId, target: PanelSectionId) => {
    setPanelOrder((current) => {
      const next = [...current];
      const si = next.indexOf(source);
      const ti = next.indexOf(target);
      if (si === -1 || ti === -1 || si === ti) return current;
      next.splice(si, 1);
      next.splice(ti, 0, source);
      chrome.storage.local.get(PANEL_LAYOUT_STORAGE_KEY, (res) => {
        chrome.storage.local.set({ [PANEL_LAYOUT_STORAGE_KEY]: { ...(res[PANEL_LAYOUT_STORAGE_KEY] ?? {}), order: next } });
      });
      return next;
    });
    setDraggedSection(null);
    setDropTargetSection(null);
  }, []);

  const togglePanelSection = useCallback((sectionId: PanelSectionId) => {
    setPanelCollapsed((current) => {
      const next = { ...current, [sectionId]: !current[sectionId] };
      chrome.storage.local.get(PANEL_LAYOUT_STORAGE_KEY, (res) => {
        chrome.storage.local.set({ [PANEL_LAYOUT_STORAGE_KEY]: { ...(res[PANEL_LAYOUT_STORAGE_KEY] ?? {}), collapsed: next } });
      });
      return next;
    });
  }, []);

  const togglePersistentPanel = useCallback((enabled: boolean) => {
    chrome.runtime.sendMessage({ type: 'TOGGLE_PERSISTENT_PANEL', payload: { enabled } }, () => {
      loadState();
    });
  }, [loadState]);

  const updateSettings = useCallback((nextSettings: StateResponse['settings']) => {
    chrome.storage.sync.set({ settings: nextSettings });
  }, []);

  const handleToggle = () => {
    if (toggling || !state) return;
    setToggling(true);
    const nextEnabled = !state.settings.enableBlocking;
    chrome.runtime.sendMessage(
      { type: 'TOGGLE_BLOCKING', payload: { enabled: nextEnabled } },
      () => {
        setToggling(false);
        loadState();
      },
    );
  };

  const handleIdeaSubmit = () => {
    if (!state || submittingIdea) return;
    const prompt = ideaInput.trim();
    if (!prompt) {
      setIdeaError('Write a quick idea before submitting.');
      return;
    }

    setSubmittingIdea(true);
    setIdeaError(null);
    chrome.runtime.sendMessage(
      { type: 'SUBMIT_IDEA', payload: { prompt } },
      (response: { ok: boolean; error?: string }) => {
        setSubmittingIdea(false);
        if (response?.ok) {
          setIdeaInput('');
          loadState();
        } else {
          setIdeaError(response?.error ?? 'Idea capture failed.');
        }
      },
    );
  };

  const handleAssistantTaskSubmit = () => {
    if (!state || submittingAssistantTask) return;
    const prompt = assistantTaskInput.trim();
    if (!prompt) {
      setAssistantTaskError('Write the task you want OpenClaw to handle.');
      return;
    }

    setSubmittingAssistantTask(true);
    setAssistantTaskError(null);
    chrome.runtime.sendMessage(
      { type: 'SUBMIT_ASSISTANT_TASK', payload: { prompt } },
      (response: { ok: boolean; error?: string }) => {
        setSubmittingAssistantTask(false);
        if (response?.ok) {
          setAssistantTaskInput('');
          loadState();
        } else {
          setAssistantTaskError(response?.error ?? 'Task handoff failed.');
        }
      },
    );
  };

  if (loading) {
    return (
      <div
        style={mode === 'popup' ? { width: POPUP_WIDTH_PX, minWidth: POPUP_WIDTH_PX, minHeight: POPUP_MIN_HEIGHT_PX } : undefined}
        className={`flex items-center justify-center bg-[var(--fg-bg)] text-sm text-[var(--fg-muted)] ${mode === 'panel' ? 'min-h-screen w-full' : 'h-[420px] w-[460px]'
          }`}
      >
        Loading Window…
      </div>
    );
  }

  if (!state) {
    return (
      <div
        style={mode === 'popup' ? { width: POPUP_WIDTH_PX, minWidth: POPUP_WIDTH_PX, minHeight: POPUP_MIN_HEIGHT_PX } : undefined}
        className={`${mode === 'panel' ? 'min-h-screen w-full' : 'w-[460px]'} bg-[var(--fg-bg)] p-5`}
      >
        <div className="fg-card p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-rose-600">Window</p>
          <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-[var(--fg-text)]">Unable to load the dashboard</p>
          <p className="mt-2 text-sm text-[var(--fg-muted)]">
            {loadError ?? 'The extension state is temporarily unavailable.'}
          </p>
        </div>
      </div>
    );
  }

  const {
    accountConflict,
    accountSyncState,
    accountUser,
    analyticsSnapshot,
    backendSession,
    backendSyncState,
    calendarState,
    ideaState,
    openClawState,
    settings,
    snoozeState,
    taskTags,
    taskQueue,
    allTimeStats,
  } = state;
  const todaysEvents = Array.isArray(calendarState.todaysEvents) ? calendarState.todaysEvents : [];
  const ideaItems = Array.isArray(ideaState.items) ? ideaState.items : [];
  const popupTaskQueue = Array.isArray(taskQueue) ? taskQueue : [];
  const calendarConnected = calendarState.lastSyncedAt !== null && calendarState.authError === null;
  const quietHoursActive = isDailyBlockingPauseActive(new Date(), settings);
  const effectivelyBlocking = settings.enableBlocking && calendarState.isRestricted;
  const now = Date.now();
  const nextEvent =
    todaysEvents
      .filter((event) => new Date(event.start).getTime() > now)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0] ?? null;
  const inboxIdeas = ideaItems.filter((item) => !item.archived).slice(0, 3);
  const actionableTasks = popupTaskQueue.filter((task) => task.status === 'active' || task.status === 'carryover');
  const assistantSubtitle = openClawState.currentTask
    ? `${formatTaskStatusLabel(openClawState.currentTask.status)} · ${openClawState.currentTask.title}`
    : openClawState.status.connected
      ? 'OpenClaw ready'
      : 'OpenClaw offline';
  const headerTitle = calendarState.currentEvent?.title ?? 'Window';
  const blockingBadgeLabel = !settings.enableBlocking
    ? 'Blocking off'
    : quietHoursActive
      ? 'Quiet hours'
      : effectivelyBlocking
        ? 'Locked in'
        : 'Browsing open';
  const headerCaption = calendarConnected
    ? calendarState.currentEvent
      ? `${formatEventRange(calendarState.currentEvent)} · ${effectivelyBlocking
        ? 'Blocking active'
        : quietHoursActive
          ? `Quiet hours until midnight · resumes tomorrow after ${formatBlockingPauseTimeLabel(settings.dailyBlockingPauseStartTime)}`
          : 'Browsing open'
      }`
      : nextEvent
        ? `Next focus block: ${nextEvent.title} · ${formatEventRange(nextEvent)}`
        : 'Calendar connected · no focus block live.'
    : 'Connect Google Calendar to turn on focus controls.';
  const focusCaption = calendarState.currentEvent
    ? `${formatEventRange(calendarState.currentEvent)} · ${actionableTasks.length} task${actionableTasks.length === 1 ? '' : 's'} ready`
    : 'Tasks appear automatically when a mapped focus event starts.';

  return (
    <div
      style={mode === 'popup' ? { width: POPUP_WIDTH_PX, minWidth: POPUP_WIDTH_PX, maxWidth: POPUP_WIDTH_PX, minHeight: POPUP_MIN_HEIGHT_PX } : undefined}
      className={`${mode === 'panel' ? 'min-h-screen w-full' : 'max-h-[760px] w-[460px]'} overflow-x-hidden overflow-y-auto bg-[var(--fg-bg)] font-sans select-none`}
    >
      <header className="sticky top-0 z-20 border-b border-[var(--fg-border)] bg-[var(--fg-bg)]/84 px-3 py-3 backdrop-blur-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[var(--fg-accent-soft)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--fg-accent)]">
                Window
              </span>
              <span className="rounded-full border border-[var(--fg-border)] bg-white/82 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--fg-muted)]">
                {blockingBadgeLabel}
              </span>
            </div>
            <h1 className="mt-2 truncate text-[18px] font-semibold tracking-[-0.04em] text-[var(--fg-text)]">
              {headerTitle}
            </h1>
            <p className="mt-1 text-[11px] leading-4 text-[var(--fg-muted)]">{headerCaption}</p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <PointsBubble
              points={allTimeStats.totalPoints}
              level={allTimeStats.level}
              title={allTimeStats.title}
              compact
            />
            {mode === 'panel' && settings.persistentPanelEnabled && (
              <button
                onClick={() => togglePersistentPanel(false)}
                className="fg-button-ghost px-3 py-1.5 text-[11px]"
              >
                Undock
              </button>
            )}
            <button
              onClick={handleToggle}
              disabled={toggling || !calendarConnected}
              className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${settings.enableBlocking
                ? 'bg-[var(--fg-accent)] text-white shadow-[0_12px_24px_rgba(0,102,255,0.18)]'
                : 'border border-[var(--fg-border)] bg-white text-[var(--fg-muted)]'
                } ${toggling || !calendarConnected ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              {settings.enableBlocking ? 'Blocking on' : 'Blocking off'}
            </button>
            <AccountStatusControl
              accountUser={accountUser}
              accountSyncState={accountSyncState}
              accountConflict={accountConflict}
              calendarState={calendarState}
              onSignIn={() =>
                sendMessageAsync({ type: 'SIGN_IN_WITH_PROVIDER', payload: { provider: 'google' } }).then(loadState)
              }
              onRefresh={() =>
                sendMessageAsync({ type: 'REFRESH_ACCOUNT_STATE' }).then(loadState)
              }
              onSignOut={() =>
                sendMessageAsync({ type: 'SIGN_OUT_ACCOUNT' }).then(loadState)
              }
              onResolveConflict={(choice) =>
                sendMessageAsync({ type: 'RESOLVE_ACCOUNT_CONFLICT', payload: { choice } }).then(loadState)
              }
              onConnectCalendar={() =>
                sendMessageAsync({ type: 'CONNECT_CALENDAR' }).then(loadState)
              }
              onDisconnectCalendar={() =>
                sendMessageAsync({ type: 'DISCONNECT_CALENDAR' }).then(loadState)
              }
            />
          </div>
        </div>
      </header>

      <div className="space-y-2 px-3 py-3">
        {panelOrder.map((sectionId) => {
          const sectionSubtitle =
            sectionId === 'focus'
              ? focusCaption
              : sectionId === 'assistant'
                ? assistantSubtitle
                : sectionId === 'analytics'
                  ? 'Live session health and the last 7 days.'
                  : 'Fast adjustments without leaving the current page.';
          return (
            <PanelSectionCard
              key={sectionId}
              title={SECTION_TITLES[sectionId]}
              subtitle={sectionSubtitle}
              hint={SECTION_HINTS[sectionId]}
              collapsed={panelCollapsed[sectionId]}
              dragging={draggedSection === sectionId}
              isDropTarget={dropTargetSection === sectionId && draggedSection !== sectionId}
              onToggleCollapse={() => togglePanelSection(sectionId)}
              onDragStart={() => setDraggedSection(sectionId)}
              onDragOver={(event) => {
                event.preventDefault();
                if (draggedSection && draggedSection !== sectionId) setDropTargetSection(sectionId);
              }}
              onDragLeave={() => setDropTargetSection(null)}
              onDrop={() => {
                if (draggedSection && draggedSection !== sectionId) movePanelSection(draggedSection, sectionId);
              }}
              onDragEnd={() => { setDraggedSection(null); setDropTargetSection(null); }}
            >
              {sectionId === 'focus' && (
                <div className="space-y-1.5">
                  <PointsDisplay stats={allTimeStats} />

                  <CompactSettingRow
                    label="Status"
                    hint="How Window is resolving restrictions for the current block."
                    value={effectivelyBlocking ? 'Locked in' : 'Open browsing'}
                    meta={
                      calendarState.activeRuleSource === 'event' && calendarState.activeRuleName
                        ? `Event rule: ${calendarState.activeRuleName}`
                        : quietHoursActive
                          ? `Daily cutoff active after ${formatBlockingPauseTimeLabel(settings.dailyBlockingPauseStartTime)}`
                          : effectivelyBlocking
                            ? 'Focus restrictions are active for this calendar block.'
                            : 'No active restriction is limiting browsing right now.'
                    }
                    className="px-3 py-2.5"
                  />

                  <CompactSettingRow
                    label="Next up"
                    hint="The next upcoming calendar block that Window can react to."
                    value={nextEvent?.title ?? 'Nothing queued'}
                    meta={nextEvent ? formatEventRange(nextEvent) : 'You are clear after this block.'}
                    className="px-3 py-2.5"
                  />

                  {snoozeState.active && snoozeState.expiresAt ? (
                    <div className="rounded-[20px] border border-amber-200 bg-amber-50/90 px-4 py-3 text-xs text-amber-800 shadow-[0_10px_24px_rgba(217,119,6,0.08)]">
                      Break active. Blocking resumes in {formatCountdown(snoozeState.expiresAt)}.
                    </div>
                  ) : null}

                  {actionableTasks.length > 0 ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--fg-muted)]">
                            Tasks
                          </p>
                          <InfoTip text="Active and carryover tasks stay compact until you expand the queue." />
                        </div>
                        <button
                          onClick={() => setCompletionModalOpen(true)}
                          className="fg-button-primary px-3.5 py-1.5 text-[11px]"
                        >
                          Mark Task Done
                        </button>
                      </div>
                      <TaskQueue tasks={actionableTasks} />
                    </div>
                  ) : (
                    <CompactSettingRow
                      label="Tasks"
                      hint="Tasks appear automatically from active and carryover calendar blocks."
                      value="Nothing to complete"
                      meta="Active focus tasks will surface here automatically."
                      className="px-3 py-2.5"
                    />
                  )}
                </div>
              )}

              {sectionId === 'analytics' && (
                <AnalyticsSummaryCard
                  analyticsSnapshot={analyticsSnapshot}
                  taskTags={taskTags}
                />
              )}

              {sectionId === 'controls' && (
                <div className="space-y-2">
                  <CompactSettingRow
                    label="Break length"
                    hint="Default duration used when starting a break from a blocked page."
                    // value={`${settings.breakDurationMinutes} min`}
                    meta="The same duration is reused by quick break actions."
                    control={
                      <select
                        value={settings.breakDurationMinutes}
                        onChange={(event) => {
                          const next = Number(event.target.value) as 5 | 10 | 15;
                          setState((prev) =>
                            prev ? { ...prev, settings: { ...prev.settings, breakDurationMinutes: next } } : prev,
                          );
                          updateSettings({ ...settings, breakDurationMinutes: next });
                        }}
                        className="fg-select w-[112px] px-3 py-2 text-sm"
                      >
                        <option value={5}>5 min</option>
                        <option value={10}>10 min</option>
                        <option value={15}>15 min</option>
                      </select>
                    }
                    className="px-3 py-2.5"
                  />

                  <CompactSettingRow
                    label="Surface mode"
                    hint="Choose whether Window opens as a popup or a persistent right-side panel."
                    value={settings.persistentPanelEnabled ? 'Docked panel' : 'Popup'}
                    meta="Switch modes without changing the rest of the dashboard."
                    control={
                      <div className="w-[172px]">
                        <BinarySelector
                          leftLabel="Popup"
                          rightLabel="Docked"
                          selected={settings.persistentPanelEnabled ? 'right' : 'left'}
                          onSelect={(selection) => togglePersistentPanel(selection === 'right')}
                        />
                      </div>
                    }
                    className="px-3 py-2.5"
                  />

                  <CompactSettingRow
                    label="Quick actions"
                    hint="Shortcuts for the two most common actions outside task completion."
                    value="Settings and breaks"
                    meta="Open the full workspace or start a manual break."
                    footer={
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => chrome.runtime.openOptionsPage()}
                          className="fg-button-secondary px-3 py-2 text-xs"
                        >
                          Open Settings
                        </button>
                        <button
                          onClick={() => chrome.runtime.sendMessage({ type: 'SNOOZE' })}
                          className="fg-button-secondary px-3 py-2 text-xs"
                        >
                          Start Break
                        </button>
                      </div>
                    }
                    className="px-3 py-2.5"
                  />
                </div>
              )}

              {sectionId === 'assistant' && (
                <AssistantPanel
                  mode={mode}
                  openClawState={openClawState}
                  accountUser={accountUser}
                  backendSession={backendSession}
                  backendSyncState={backendSyncState}
                  assistantTaskInput={assistantTaskInput}
                  assistantTaskError={assistantTaskError}
                  submittingAssistantTask={submittingAssistantTask}
                  ideaInput={ideaInput}
                  ideaError={ideaError}
                  submittingIdea={submittingIdea}
                  inboxIdeas={inboxIdeas}
                  onAssistantTaskInputChange={(value) => {
                    setAssistantTaskInput(value);
                    setAssistantTaskError(null);
                  }}
                  onAssistantTaskSubmit={handleAssistantTaskSubmit}
                  onIdeaInputChange={(value) => {
                    setIdeaInput(value);
                    setIdeaError(null);
                  }}
                  onIdeaSubmit={handleIdeaSubmit}
                  onRefresh={() => chrome.runtime.sendMessage({ type: 'REFRESH_ASSISTANT_STATE' })}
                  onStartSession={() => chrome.runtime.sendMessage({ type: 'START_OPENCLAW_SESSION' })}
                  onReuseSession={(sessionId) =>
                    chrome.runtime.sendMessage({ type: 'REUSE_OPENCLAW_SESSION', payload: { sessionId } })
                  }
                  onCancelJob={(jobId) =>
                    chrome.runtime.sendMessage({ type: 'CANCEL_OPENCLAW_JOB', payload: { jobId } })
                  }
                  onCancelTask={(taskId) =>
                    chrome.runtime.sendMessage({ type: 'CANCEL_ASSISTANT_TASK', payload: { taskId } })
                  }
                  onKeep={(localId) =>
                    chrome.runtime.sendMessage({
                      type: 'DECIDE_IDEA',
                      payload: { localId, decision: 'keep' },
                    })
                  }
                  onDiscard={(localId) =>
                    chrome.runtime.sendMessage({
                      type: 'DECIDE_IDEA',
                      payload: { localId, decision: 'discard' },
                    })
                  }
                  onRetry={(localId) =>
                    chrome.runtime.sendMessage({
                      type: 'RETRY_IDEA',
                      payload: { localId },
                    })
                  }
                />
              )}
            </PanelSectionCard>
          );
        })}
      </div>

      {completionModalOpen && actionableTasks.length > 0 && (
        <CompletionModal
          tasks={actionableTasks}
          onClose={() => setCompletionModalOpen(false)}
          onDone={() => {
            setCompletionModalOpen(false);
            loadState();
          }}
        />
      )}
    </div>
  );
}

function PanelSectionCard({
  title,
  subtitle,
  hint,
  collapsed,
  dragging,
  isDropTarget,
  onToggleCollapse,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  children,
}: {
  title: string;
  subtitle?: string;
  hint?: string;
  collapsed: boolean;
  dragging: boolean;
  isDropTarget: boolean;
  onToggleCollapse: () => void;
  onDragStart: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`fg-card overflow-hidden transition-all duration-150 ${isDropTarget ? 'ring-2 ring-[var(--fg-accent)]/50 ring-offset-1' : ''
        } ${dragging ? 'opacity-50 scale-[0.99]' : ''}`}
    >
      <div className="flex items-center gap-2 px-4 py-2.5">
        <div
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className="cursor-grab select-none text-[var(--fg-muted)] active:cursor-grabbing"
          title="Drag to reorder"
        >
          <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor" aria-hidden="true">
            <circle cx="3" cy="2.5" r="1.2" />
            <circle cx="9" cy="2.5" r="1.2" />
            <circle cx="3" cy="7" r="1.2" />
            <circle cx="9" cy="7" r="1.2" />
            <circle cx="3" cy="11.5" r="1.2" />
            <circle cx="9" cy="11.5" r="1.2" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold tracking-[-0.02em] text-[var(--fg-text)]">{title}</h2>
            {hint ? <InfoTip text={hint} /> : null}
          </div>
          {subtitle && !collapsed ? (
            <p className="mt-0.5 truncate text-[11px] leading-4 text-[var(--fg-muted)]">{subtitle}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="shrink-0 rounded-full border border-[var(--fg-border)] bg-white/80 px-2.5 py-1 text-[11px] font-medium text-[var(--fg-muted)] transition hover:text-[var(--fg-text)]"
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>
      {!collapsed && (
        <div className="border-t border-[var(--fg-border)] px-4 pb-4 pt-3">
          {children}
        </div>
      )}
    </div>
  );
}

function AssistantPanel({
  mode,
  openClawState,
  accountUser,
  backendSession,
  backendSyncState,
  assistantTaskInput,
  assistantTaskError,
  submittingAssistantTask,
  ideaInput,
  ideaError,
  submittingIdea,
  inboxIdeas,
  onAssistantTaskInputChange,
  onAssistantTaskSubmit,
  onIdeaInputChange,
  onIdeaSubmit,
  onRefresh,
  onStartSession,
  onReuseSession,
  onCancelJob,
  onCancelTask,
  onKeep,
  onDiscard,
  onRetry,
}: {
  mode: 'popup' | 'panel';
  openClawState: StateResponse['openClawState'];
  accountUser: StateResponse['accountUser'];
  backendSession: StateResponse['backendSession'];
  backendSyncState: StateResponse['backendSyncState'];
  assistantTaskInput: string;
  assistantTaskError: string | null;
  submittingAssistantTask: boolean;
  ideaInput: string;
  ideaError: string | null;
  submittingIdea: boolean;
  inboxIdeas: IdeaRecord[];
  onAssistantTaskInputChange: (value: string) => void;
  onAssistantTaskSubmit: () => void;
  onIdeaInputChange: (value: string) => void;
  onIdeaSubmit: () => void;
  onRefresh: () => void;
  onStartSession: () => void;
  onReuseSession: (sessionId: string) => void;
  onCancelJob: (jobId: string) => void;
  onCancelTask: (taskId: string) => void;
  onKeep: (localId: string) => void;
  onDiscard: (localId: string) => void;
  onRetry: (localId: string) => void;
}): React.JSX.Element {
  const sessions = Array.isArray(openClawState.sessions) ? openClawState.sessions : [];
  const connectors = Array.isArray(openClawState.connectors) ? openClawState.connectors : [];
  const tasks = Array.isArray(openClawState.tasks) ? openClawState.tasks : [];
  const reusableSession = sessions.find((session) => session.status !== 'closed');
  const currentJob = openClawState.currentJob;
  const currentTask = openClawState.currentTask;
  const selectedConnector =
    connectors.find((connector) => connector.id === openClawState.selectedConnectorId) ??
    connectors[0] ??
    null;
  const visibleTasks = tasks.slice(0, mode === 'panel' ? 6 : 4);
  const visibleSessions = sessions.slice(0, mode === 'panel' ? 4 : 3);
  const toolbarButtonClass = 'fg-button-secondary px-3 py-1.5 text-[11px]';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <button onClick={onRefresh} className={toolbarButtonClass}>Refresh</button>
        <button onClick={onStartSession} className={toolbarButtonClass}>New Session</button>
        {reusableSession && (
          <button onClick={() => onReuseSession(reusableSession.id)} className={toolbarButtonClass}>
            Reuse Session
          </button>
        )}
        {currentJob && (
          <button onClick={() => onCancelJob(currentJob.id)} className={toolbarButtonClass}>
            Cancel Job
          </button>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <CompactSettingRow
          label="Current handoff"
          hint="The current async task running in the background, independent from idea capture."
          value={currentTask ? formatTaskStatusLabel(currentTask.status) : 'Idle'}
          meta={currentTask?.title ?? 'No background task is running right now.'}
          className="px-3 py-2.5"
        />
        <CompactSettingRow
          label="Idea job"
          hint="The active OpenClaw research request for idea capture, if one is currently running."
          value={currentJob ? formatTaskStatusLabel(currentJob.status) : 'Idle'}
          meta={currentJob?.title ?? 'No idea capture job running right now.'}
          className="px-3 py-2.5"
        />
      </div>

      <div className="rounded-[24px] border border-[var(--fg-border-strong)] bg-[linear-gradient(180deg,rgba(246,250,255,0.94),rgba(255,255,255,0.9))] px-4 py-4 shadow-[0_16px_32px_rgba(31,52,94,0.08)]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--fg-muted)]">
                Handoff task
              </p>
              <InfoTip text="Send a longer-running task to OpenClaw so it can work in parallel while you stay in the browser." />
            </div>
            <p className="mt-1 text-[11px] leading-4 text-[var(--fg-muted)]">
              {selectedConnector
                ? `${selectedConnector.label} · ${openClawState.status.connected ? 'Connected' : openClawState.status.message ?? 'Offline'}`
                : 'Select a connector to start handing off work.'}
            </p>
          </div>
          <button
            onClick={onAssistantTaskSubmit}
            disabled={submittingAssistantTask || connectors.length === 0}
            className="fg-button-primary shrink-0 px-3.5 py-2 text-xs"
          >
            {submittingAssistantTask ? 'Sending…' : 'Send Task'}
          </button>
        </div>

        <textarea
          rows={mode === 'panel' ? 4 : 3}
          value={assistantTaskInput}
          onChange={(event) => onAssistantTaskInputChange(event.target.value)}
          placeholder="Research API options for our billing sync, sketch the best approach, and return an implementation plan with risks."
          className="fg-input mt-3 min-h-[84px] resize-none px-3 py-2.5 text-sm"
        />
        {assistantTaskError && <p className="mt-2 text-xs text-rose-600">{assistantTaskError}</p>}
      </div>

      {visibleTasks.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--fg-muted)]">
                Recent handoffs
              </p>
              <InfoTip text="Completed tasks stay here so you can review results even if notifications are deferred or suppressed." />
            </div>
            <span className="text-[11px] text-[var(--fg-muted)]">{tasks.length} total</span>
          </div>
          <AssistantTaskList tasks={visibleTasks} onCancelTask={onCancelTask} />
        </div>
      ) : (
        <p className="text-[11px] leading-4 text-[var(--fg-muted)]">
          No background handoffs yet.
        </p>
      )}

      <div className="rounded-[24px] border border-[var(--fg-border-strong)] bg-[linear-gradient(180deg,rgba(246,250,255,0.94),rgba(255,255,255,0.9))] px-4 py-4 shadow-[0_16px_32px_rgba(31,52,94,0.08)]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--fg-muted)]">
                Capture idea
              </p>
              <InfoTip text="Ideas can sync live or queue locally until the backend reconnects." />
            </div>
            <p className="mt-1 text-[11px] leading-4 text-[var(--fg-muted)]">
              {backendSyncState.connected
                ? `Synced${accountUser?.email ? ` as ${accountUser.email}` : backendSession ? ` as ${backendSession.userId}` : ''}.`
                : backendSyncState.lastError ?? 'Queued locally until you sign in.'}
            </p>
          </div>
          <button
            onClick={onIdeaSubmit}
            disabled={submittingIdea}
            className="fg-button-primary shrink-0 px-3.5 py-2 text-xs"
          >
            {submittingIdea ? 'Submitting…' : 'Capture'}
          </button>
        </div>

        <textarea
          rows={mode === 'panel' ? 3 : 2}
          value={ideaInput}
          onChange={(event) => onIdeaInputChange(event.target.value)}
          placeholder="I want to build a marketplace for horse breeders. Is this viable?"
          className="fg-input mt-3 min-h-[68px] resize-none px-3 py-2.5 text-sm"
        />
        {ideaError && <p className="mt-2 text-xs text-rose-600">{ideaError}</p>}
      </div>

      {visibleSessions.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--fg-muted)]">
                Recent sessions
              </p>
              <InfoTip text="Only shown when OpenClaw has reusable history, which keeps the panel lighter by default." />
            </div>
            <span className="text-[11px] text-[var(--fg-muted)]">{sessions.length} saved</span>
          </div>
          <div className="space-y-1.5">
            {visibleSessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                active={session.id === openClawState.activeSessionId}
                onReuse={() => onReuseSession(session.id)}
              />
            ))}
          </div>
        </div>
      )}

      {inboxIdeas.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--fg-muted)]">
              Idea inbox
            </p>
            <InfoTip text="Queued idea reports only expand when something needs your review." />
          </div>
          <IdeaInbox
            ideas={inboxIdeas}
            onKeep={onKeep}
            onDiscard={onDiscard}
            onRetry={onRetry}
          />
        </div>
      ) : (
        <p className="text-[11px] leading-4 text-[var(--fg-muted)]">
          No queued idea reports right now.
        </p>
      )}
    </div>
  );
}

function AssistantTaskList({
  tasks,
  onCancelTask,
}: {
  tasks: AssistantTaskRecord[];
  onCancelTask: (taskId: string) => void;
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <AssistantTaskRow key={task.id} task={task} onCancel={() => onCancelTask(task.id)} />
      ))}
    </div>
  );
}

function AssistantTaskRow({
  task,
  onCancel,
}: {
  task: AssistantTaskRecord;
  onCancel: () => void;
}): React.JSX.Element {
  const canCancel = task.status === 'queued' || task.status === 'running';
  const detailPreview = task.result?.output?.trim() ?? '';

  return (
    <div className="rounded-[20px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-[13px] font-medium leading-5 text-[var(--fg-text)]">{task.title}</p>
            <TaskStatusBadge status={task.status} />
            {task.unread && (
              <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-700">
                New
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-4 text-[var(--fg-muted)]">
            {formatRelativeTime(task.updatedAt)} · {formatNotificationModeLabel(task.notificationMode)}
          </p>
        </div>
        {canCancel ? (
          <button onClick={onCancel} className="fg-button-secondary shrink-0 px-3 py-1.5 text-xs">
            Cancel
          </button>
        ) : null}
      </div>

      <p className="mt-2 text-xs leading-4 text-[var(--fg-muted)]">{truncateText(task.prompt, 180)}</p>

      {task.result ? (
        <div className="mt-2.5 space-y-2">
          <p className="text-xs leading-4 text-[var(--fg-muted)]">{task.result.summary}</p>
          {detailPreview ? (
            <details className="rounded-[16px] border border-[var(--fg-border)] bg-white px-3 py-2">
              <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--fg-muted)]">
                Review output
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[var(--fg-text)]">
                {truncateText(detailPreview, 900)}
              </p>
            </details>
          ) : null}
        </div>
      ) : task.error ? (
        <p className="mt-2.5 text-xs leading-4 text-rose-600">{task.error}</p>
      ) : canCancel ? (
        <p className="mt-2.5 text-xs leading-4 text-[var(--fg-muted)]">
          OpenClaw is still working on this handoff.
        </p>
      ) : null}
    </div>
  );
}

function TaskStatusBadge({
  status,
}: {
  status: AssistantTaskRecord['status'];
}): React.JSX.Element {
  const className =
    status === 'completed'
      ? 'bg-emerald-100 text-emerald-700'
      : status === 'running'
        ? 'bg-blue-100 text-blue-700'
        : status === 'queued'
          ? 'bg-slate-100 text-slate-700'
          : status === 'cancelled'
            ? 'bg-amber-100 text-amber-700'
            : 'bg-rose-100 text-rose-700';

  return (
    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${className}`}>
      {formatTaskStatusLabel(status)}
    </span>
  );
}

function BinarySelector({
  leftLabel,
  rightLabel,
  selected,
  onSelect,
}: {
  leftLabel: string;
  rightLabel: string;
  selected: 'left' | 'right';
  onSelect: (selection: 'left' | 'right') => void;
}): React.JSX.Element {
  return (
    <div className="inline-flex w-full rounded-[18px] border border-[var(--fg-border)] bg-white p-0.5">
      <button
        onClick={() => onSelect('left')}
        className={`flex-1 rounded-[14px] px-2.5 py-1.5 text-[11px] font-medium transition ${selected === 'left'
          ? 'bg-[var(--fg-panel-soft)] text-[var(--fg-text)] shadow-[0_8px_16px_rgba(15,23,42,0.08)]'
          : 'text-[var(--fg-muted)]'
          }`}
      >
        {leftLabel}
      </button>
      <button
        onClick={() => onSelect('right')}
        className={`flex-1 rounded-[14px] px-2.5 py-1.5 text-[11px] font-medium transition ${selected === 'right'
          ? 'bg-[var(--fg-panel-soft)] text-[var(--fg-text)] shadow-[0_8px_16px_rgba(15,23,42,0.08)]'
          : 'text-[var(--fg-muted)]'
          }`}
      >
        {rightLabel}
      </button>
    </div>
  );
}

function IdeaInbox({
  ideas,
  onKeep,
  onDiscard,
  onRetry,
}: {
  ideas: IdeaRecord[];
  onKeep: (localId: string) => void;
  onDiscard: (localId: string) => void;
  onRetry: (localId: string) => void;
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      {ideas.map((idea) => (
        <div
          key={idea.localId}
          className="rounded-[20px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2.5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-[13px] font-medium leading-5 text-[var(--fg-text)]">{idea.prompt}</p>
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--fg-muted)]">{idea.status}</p>
            </div>
            {idea.unread && (
              <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-700">
                New
              </span>
            )}
          </div>

          {idea.report ? (
            <div className="mt-2.5 space-y-1.5">
              <p className="text-xs leading-4 text-[var(--fg-muted)]">{idea.report.summary}</p>
              <div className="grid grid-cols-3 gap-2 text-xs text-[var(--fg-muted)]">
                <span>Viability: {idea.report.viability}</span>
                <span>Build: {idea.report.buildEffort}</span>
                <span>Revenue: {idea.report.revenuePotential}</span>
              </div>
              {!idea.saved && !idea.archived && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button onClick={() => onKeep(idea.localId)} className="fg-button-primary px-3 py-2 text-xs">
                    Keep
                  </button>
                  <button onClick={() => onDiscard(idea.localId)} className="fg-button-secondary px-3 py-2 text-xs">
                    Discard
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <p className="text-xs leading-4 text-[var(--fg-muted)]">
                {idea.error
                  ? `Last error: ${idea.error}`
                  : idea.status === 'queued' || idea.status === 'syncing'
                    ? 'Waiting for backend sync.'
                    : 'OpenClaw is still working on this one.'}
              </p>
              {(idea.status === 'failed' || idea.error) && (
                <button onClick={() => onRetry(idea.localId)} className="fg-button-secondary px-3 py-2 text-xs">
                  Retry
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SessionRow({
  session,
  active,
  onReuse,
}: {
  session: OpenClawSessionSummary;
  active: boolean;
  onReuse: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[20px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2">
      <div>
        <p className="text-[13px] font-medium leading-5 text-[var(--fg-text)]">{session.title}</p>
        <p className="text-[11px] leading-4 text-[var(--fg-muted)]">
          {session.status} · {session.modelLabel ?? 'OpenClaw default'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {active && (
          <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
            Active
          </span>
        )}
        <button onClick={onReuse} className="fg-button-ghost px-2.5 py-1.5 text-xs">
          Use
        </button>
      </div>
    </div>
  );
}

function formatCountdown(expiresAt: string): string {
  const totalSeconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function AnalyticsSummaryCard({
  analyticsSnapshot,
  taskTags,
}: {
  analyticsSnapshot: StateResponse['analyticsSnapshot'];
  taskTags: StateResponse['taskTags'];
}): React.JSX.Element {
  const current = analyticsSnapshot.currentSession;
  const summary = analyticsSnapshot.summary7d;
  const safeTaskTags = Array.isArray(taskTags) ? taskTags : [];
  const currentTag = current?.tagKey
    ? safeTaskTags.find((tag) => tag.key === current.tagKey) ?? null
    : null;
  const segments = [
    { label: 'Productive', value: current?.productiveMinutes ?? summary.productiveMinutes, color: '#2563eb' },
    { label: 'Supportive', value: current?.supportiveMinutes ?? summary.supportiveMinutes, color: '#0f766e' },
    { label: 'Distracted', value: current?.distractedMinutes ?? summary.distractedMinutes, color: '#dc2626' },
    { label: 'Away', value: current?.awayMinutes ?? summary.awayMinutes, color: '#64748b' },
  ].filter((segment) => segment.value > 0);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <div className="space-y-2">
      <div className="grid gap-1.5 sm:grid-cols-2">
        <CompactSettingRow
          label="Status"
          hint="What Window thinks is happening right now."
          value={
            current?.currentActivityClass
              ? current.currentActivityClass.charAt(0).toUpperCase() + current.currentActivityClass.slice(1)
              : 'Idle'
          }
          meta={
            current
              ? `${current.eventTitle}${current.difficultyRank ? ` · Difficulty ${current.difficultyRank}` : ''}`
              : 'No active focus session right now.'
          }
          className="px-3 py-2.5"
        />
        <CompactSettingRow
          label="Primary tag"
          hint="The task tag currently linked to the active session."
          value={currentTag?.label ?? 'None'}
          meta={currentTag ? `Baseline difficulty ${currentTag.baselineDifficulty}` : 'Waiting for a resolved task tag.'}
          className="px-3 py-2.5"
        />
      </div>

      <div className="rounded-[20px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--fg-muted)]">
              {current ? 'Current session' : 'Last 7 days'}
            </p>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              {current
                ? `${formatMinutes(current.productiveMinutes)} productive · ${formatMinutes(current.distractedMinutes)} distracted`
                : `${formatMinutes(summary.productiveMinutes)} productive across ${summary.totalFocusSessions} session${summary.totalFocusSessions === 1 ? '' : 's'}`}
            </p>
          </div>
          {current?.difficultyRank ? (
            <span
              title="Difficulty score"
              className="rounded-full border border-[var(--fg-border)] bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]"
            >
              D{current.difficultyRank}
            </span>
          ) : null}
        </div>

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
          {total > 0 ? (
            <div className="flex h-full w-full">
              {segments.map((segment) => (
                <div
                  key={segment.label}
                  title={`${segment.label}: ${formatMinutes(segment.value)}`}
                  style={{
                    width: `${(segment.value / total) * 100}%`,
                    background: segment.color,
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="h-full w-full bg-slate-200" />
          )}
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2 text-[11px] text-[var(--fg-muted)]">
          <MetricChip label="Prod" value={formatMinutes(current?.productiveMinutes ?? summary.productiveMinutes)} />
          <MetricChip label="Help" value={formatMinutes(current?.supportiveMinutes ?? summary.supportiveMinutes)} />
          <MetricChip label="Distract" value={formatMinutes(current?.distractedMinutes ?? summary.distractedMinutes)} />
          <MetricChip label="Away" value={formatMinutes(current?.awayMinutes ?? summary.awayMinutes)} />
        </div>
      </div>
    </div>
  );
}

function MetricChip({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="rounded-[16px] border border-[var(--fg-border)] bg-white px-2.5 py-2 text-center">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--fg-muted)]">{label}</p>
      <p className="mt-1 text-xs font-medium text-[var(--fg-text)]">{value}</p>
    </div>
  );
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

function formatTaskStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatNotificationModeLabel(value: TaskNotificationMode): string {
  if (value === 'after_focus') return 'After focus';
  if (value === 'inbox_only') return 'Inbox only';
  return 'Immediate';
}

function formatRelativeTime(value: string): string {
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(delta / 60_000));
  if (minutes < 1) return 'Updated just now';
  if (minutes === 1) return 'Updated 1 min ago';
  if (minutes < 60) return `Updated ${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours === 1) return 'Updated 1 hour ago';
  if (hours < 24) return `Updated ${hours} hours ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? 'Updated 1 day ago' : `Updated ${days} days ago`;
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
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

function isStateResponse(value: unknown): value is StateResponse {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<StateResponse>;
  return Boolean(
    candidate.settings &&
    candidate.calendarState &&
    candidate.allTimeStats &&
    candidate.assistantOptions &&
    candidate.ideaState &&
    candidate.openClawState,
  );
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
