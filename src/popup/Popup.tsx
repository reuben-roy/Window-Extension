import React, { useCallback, useEffect, useState } from 'react';
import type {
  AssistantOptions,
  CalendarEvent,
  IdeaRecord,
  OpenClawSessionSummary,
  StateResponse,
} from '../shared/types';
import { formatBlockingPauseTimeLabel, isDailyBlockingPauseActive } from '../shared/blockingSchedule';
import { MODEL_PLACEHOLDER_OPTIONS } from '../shared/constants';
import AccountStatusControl from '../shared/components/AccountStatusControl';
import CompactSettingRow from '../shared/components/CompactSettingRow';
import InfoTip from '../shared/components/InfoTip';
import PointsBubble from '../shared/components/PointsBubble';
import SettingsGroup from '../shared/components/SettingsGroup';
import CompletionModal from './components/CompletionModal';
import PointsDisplay from './components/PointsDisplay';
import TaskQueue from './components/TaskQueue';

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
  const [ideaInput, setIdeaInput] = useState('');
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const [completionModalOpen, setCompletionModalOpen] = useState(false);

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
    const listener = () => loadState();
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [loadState]);

  const updateAssistantOptions = useCallback((patch: Partial<AssistantOptions>) => {
    chrome.runtime.sendMessage({ type: 'UPDATE_ASSISTANT_OPTIONS', payload: patch });
  }, []);

  const updateModelSelector = useCallback((value: string) => {
    const next = {
      value: MODEL_PLACEHOLDER_OPTIONS.includes(value as (typeof MODEL_PLACEHOLDER_OPTIONS)[number])
        ? value
        : MODEL_PLACEHOLDER_OPTIONS[0],
      updatedAt: null,
    };
    updateAssistantOptions({ preferredModel: next });
  }, [updateAssistantOptions]);

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

  if (loading) {
    return (
      <div
        className={`flex items-center justify-center bg-[var(--fg-bg)] text-sm text-[var(--fg-muted)] ${
          mode === 'panel' ? 'min-h-screen w-full' : 'h-[420px] w-[460px]'
        }`}
      >
        Loading Window…
      </div>
    );
  }

  if (!state) {
    return (
      <div className={`${mode === 'panel' ? 'min-h-screen w-full' : 'w-[460px]'} bg-[var(--fg-bg)] p-5`}>
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
    assistantOptions,
    backendSession,
    backendSyncState,
    calendarState,
    ideaState,
    openClawState,
    settings,
    snoozeState,
    taskQueue,
    allTimeStats,
  } = state;
  const calendarConnected = calendarState.lastSyncedAt !== null && calendarState.authError === null;
  const quietHoursActive = isDailyBlockingPauseActive(new Date(), settings);
  const effectivelyBlocking = settings.enableBlocking && calendarState.isRestricted;
  const now = Date.now();
  const nextEvent =
    calendarState.todaysEvents
      .filter((event) => new Date(event.start).getTime() > now)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0] ?? null;
  const inboxIdeas = ideaState.items.filter((item) => !item.archived).slice(0, 3);
  const actionableTasks = taskQueue.filter((task) => task.status === 'active' || task.status === 'carryover');
  const selectedModel = MODEL_PLACEHOLDER_OPTIONS.includes(
    assistantOptions.preferredModel.value as (typeof MODEL_PLACEHOLDER_OPTIONS)[number],
  )
    ? assistantOptions.preferredModel.value
    : MODEL_PLACEHOLDER_OPTIONS[0];
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
      ? `${formatEventRange(calendarState.currentEvent)} · ${
          effectivelyBlocking
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
    <div className={`${mode === 'panel' ? 'min-h-screen w-full' : 'max-h-[760px] w-[460px]'} overflow-y-auto bg-[var(--fg-bg)] font-sans select-none`}>
      <header className="sticky top-0 z-20 border-b border-[var(--fg-border)] bg-[var(--fg-bg)]/92 px-3 py-2.5 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[15px] font-semibold tracking-[-0.03em] text-[var(--fg-text)]">
                {headerTitle}
              </h1>
              <span className="rounded-full border border-[var(--fg-border)] bg-white px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--fg-muted)]">
                {blockingBadgeLabel}
              </span>
            </div>
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
              className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
                settings.enableBlocking
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

      <div className="space-y-2 px-3 py-2.5">
        <section className={`grid gap-2 ${mode === 'panel' ? 'xl:grid-cols-[minmax(0,1.02fr),minmax(0,0.98fr)]' : 'grid-cols-1'}`}>
          <div className="space-y-2">
            <SettingsGroup
              className="fg-card p-3"
              title="Focus"
              subtitle={focusCaption}
              hint="Current focus state, next event, and task progress."
            >
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
                  <div className="rounded-[18px] border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
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
            </SettingsGroup>

            <SettingsGroup
              className="fg-card p-3"
              title="Controls"
              subtitle="Fast adjustments without leaving the current page."
              hint="Keep the day moving with break, surface, and settings controls."
            >
              <div className="space-y-1.5">
                <CompactSettingRow
                  label="Break length"
                  hint="Default duration used when starting a break from a blocked page."
                  value={`${settings.breakDurationMinutes} min`}
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
            </SettingsGroup>
          </div>

          <SettingsGroup
            className="fg-card p-3"
            title="Assistant"
            subtitle={openClawState.status.connected ? 'OpenClaw ready' : 'OpenClaw offline'}
            hint="Session controls, model selection, telemetry, and idea capture."
          >
            <AssistantPanel
              mode={mode}
              assistantOptions={assistantOptions}
              selectedModel={selectedModel}
              openClawState={openClawState}
              breakTelemetryEnabled={settings.breakTelemetryEnabled}
              accountUser={accountUser}
              backendSession={backendSession}
              backendSyncState={backendSyncState}
              ideaInput={ideaInput}
              ideaError={ideaError}
              submittingIdea={submittingIdea}
              inboxIdeas={inboxIdeas}
              onIdeaInputChange={(value) => {
                setIdeaInput(value);
                setIdeaError(null);
              }}
              onIdeaSubmit={handleIdeaSubmit}
              onModelSelect={updateModelSelector}
              onToggleReuse={(checked) => updateAssistantOptions({ reuseActiveSession: checked })}
              onToggleAutoCreate={(checked) => updateAssistantOptions({ autoCreateSession: checked })}
              onToggleTelemetry={(checked) => {
                setState((prev) =>
                  prev ? { ...prev, settings: { ...prev.settings, breakTelemetryEnabled: checked } } : prev,
                );
                updateSettings({ ...settings, breakTelemetryEnabled: checked });
              }}
              onRefresh={() => chrome.runtime.sendMessage({ type: 'REFRESH_ASSISTANT_STATE' })}
              onStartSession={() => chrome.runtime.sendMessage({ type: 'START_OPENCLAW_SESSION' })}
              onReuseSession={(sessionId) =>
                chrome.runtime.sendMessage({ type: 'REUSE_OPENCLAW_SESSION', payload: { sessionId } })
              }
              onCancelJob={(jobId) =>
                chrome.runtime.sendMessage({ type: 'CANCEL_OPENCLAW_JOB', payload: { jobId } })
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
          </SettingsGroup>
        </section>
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

function AssistantPanel({
  mode,
  assistantOptions,
  selectedModel,
  openClawState,
  breakTelemetryEnabled,
  accountUser,
  backendSession,
  backendSyncState,
  ideaInput,
  ideaError,
  submittingIdea,
  inboxIdeas,
  onIdeaInputChange,
  onIdeaSubmit,
  onModelSelect,
  onToggleReuse,
  onToggleAutoCreate,
  onToggleTelemetry,
  onRefresh,
  onStartSession,
  onReuseSession,
  onCancelJob,
  onKeep,
  onDiscard,
  onRetry,
}: {
  mode: 'popup' | 'panel';
  assistantOptions: AssistantOptions;
  selectedModel: string;
  openClawState: StateResponse['openClawState'];
  breakTelemetryEnabled: boolean;
  accountUser: StateResponse['accountUser'];
  backendSession: StateResponse['backendSession'];
  backendSyncState: StateResponse['backendSyncState'];
  ideaInput: string;
  ideaError: string | null;
  submittingIdea: boolean;
  inboxIdeas: IdeaRecord[];
  onIdeaInputChange: (value: string) => void;
  onIdeaSubmit: () => void;
  onModelSelect: (value: string) => void;
  onToggleReuse: (checked: boolean) => void;
  onToggleAutoCreate: (checked: boolean) => void;
  onToggleTelemetry: (checked: boolean) => void;
  onRefresh: () => void;
  onStartSession: () => void;
  onReuseSession: (sessionId: string) => void;
  onCancelJob: (jobId: string) => void;
  onKeep: (localId: string) => void;
  onDiscard: (localId: string) => void;
  onRetry: (localId: string) => void;
}): React.JSX.Element {
  const reusableSession = openClawState.sessions.find((session) => session.status !== 'closed');
  const currentJob = openClawState.currentJob;
  const visibleSessions = openClawState.sessions.slice(0, mode === 'panel' ? 4 : 3);
  const toolbarButtonClass = 'fg-button-ghost px-3 py-1.5 text-[11px]';

  return (
    <div className="space-y-2.5">
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

      <div className="grid gap-1.5 sm:grid-cols-2">
        <CompactSettingRow
          label="Transport"
          hint="Where assistant traffic is routed right now."
          value={openClawState.status.transport.toUpperCase()}
          meta={openClawState.status.label ?? 'Oracle-hosted OpenClaw'}
          className="px-3 py-2.5"
        />
        <CompactSettingRow
          label="Current job"
          hint="The active OpenClaw request, if one is currently running."
          value={currentJob?.status ?? 'Idle'}
          meta={currentJob?.title ?? 'No job running right now.'}
          className="px-3 py-2.5"
        />
      </div>

      <div className="space-y-1.5">
        <CompactSettingRow
          label="Model selector"
          hint="Placeholder choices for the future provider switcher."
          value={selectedModel}
          meta="Display-only today, but ready for future routing."
          control={
            <select
              value={selectedModel}
              onChange={(event) => onModelSelect(event.target.value)}
              className="fg-select w-[172px] px-3 py-2 text-sm"
            >
              {MODEL_PLACEHOLDER_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          }
          className="px-3 py-2.5"
        />

        <CompactSettingRow
          label="Session behavior"
          hint="Reuse the current thread when you want continuity, or always start fresh."
          value={assistantOptions.reuseActiveSession ? 'Reuse current' : 'Fresh thread'}
          meta="Choose whether capture actions continue the latest reusable session."
          control={
            <div className="w-[176px]">
              <BinarySelector
                leftLabel="Fresh thread"
                rightLabel="Reuse current"
                selected={assistantOptions.reuseActiveSession ? 'right' : 'left'}
                onSelect={(selection) => onToggleReuse(selection === 'right')}
              />
            </div>
          }
          className="px-3 py-2.5"
        />

        <CompactSettingRow
          label="New session fallback"
          hint="Automatically create a new session when nothing reusable exists, or require manual starts."
          value={assistantOptions.autoCreateSession ? 'Auto-create' : 'Manual'}
          meta="Useful when you want capture to keep moving without opening the assistant first."
          control={
            <div className="w-[176px]">
              <BinarySelector
                leftLabel="Manual"
                rightLabel="Auto-create"
                selected={assistantOptions.autoCreateSession ? 'right' : 'left'}
                onSelect={(selection) => onToggleAutoCreate(selection === 'right')}
              />
            </div>
          }
          className="px-3 py-2.5"
        />

        <CompactSettingRow
          label="Break telemetry"
          hint="Share domain-only break telemetry during active breaks."
          value={breakTelemetryEnabled ? 'On' : 'Off'}
          meta="Used only for break analytics and trend summaries."
          control={
            <div className="w-[176px]">
              <BinarySelector
                leftLabel="Off"
                rightLabel="On"
                selected={breakTelemetryEnabled ? 'right' : 'left'}
                onSelect={(selection) => onToggleTelemetry(selection === 'right')}
              />
            </div>
          }
          className="px-3 py-2.5"
        />
      </div>

      <div className="rounded-[22px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3.5 py-3">
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
          className="fg-input mt-2 min-h-[68px] resize-none px-3 py-2.5 text-sm"
        />
        {ideaError && <p className="mt-2 text-xs text-rose-600">{ideaError}</p>}
      </div>

      {visibleSessions.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--fg-muted)]">
                Recent sessions
              </p>
              <InfoTip text="Only shown when OpenClaw has reusable history, which keeps the panel lighter by default." />
            </div>
            <span className="text-[11px] text-[var(--fg-muted)]">{openClawState.sessions.length} saved</span>
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
        <div className="space-y-1.5">
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
        className={`flex-1 rounded-[14px] px-2.5 py-1.5 text-[11px] font-medium transition ${
          selected === 'left'
            ? 'bg-[var(--fg-panel-soft)] text-[var(--fg-text)] shadow-[0_8px_16px_rgba(15,23,42,0.08)]'
            : 'text-[var(--fg-muted)]'
        }`}
      >
        {leftLabel}
      </button>
      <button
        onClick={() => onSelect('right')}
        className={`flex-1 rounded-[14px] px-2.5 py-1.5 text-[11px] font-medium transition ${
          selected === 'right'
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
