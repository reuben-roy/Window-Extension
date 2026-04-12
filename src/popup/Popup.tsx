import React, { useCallback, useEffect, useState } from 'react';
import type {
  AssistantOptions,
  CalendarEvent,
  IdeaRecord,
  ModelSelectorState,
  OpenClawSessionSummary,
  StateResponse,
} from '../shared/types';
import CalendarConnect from './components/CalendarConnect';

export default function Popup(): React.JSX.Element {
  const [state, setState] = useState<StateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [submittingIdea, setSubmittingIdea] = useState(false);
  const [ideaInput, setIdeaInput] = useState('');
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState('OpenClaw default model');

  const loadState = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response: StateResponse) => {
      if (chrome.runtime.lastError) {
        setLoading(false);
        return;
      }
      setState(response);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    loadState();
    chrome.runtime.sendMessage({ type: 'REFRESH_ASSISTANT_STATE' });
    const listener = () => loadState();
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [loadState]);

  useEffect(() => {
    if (state?.assistantOptions.preferredModel.value) {
      setModelDraft(state.assistantOptions.preferredModel.value);
    }
  }, [state?.assistantOptions.preferredModel.value]);

  const updateAssistantOptions = useCallback((patch: Partial<AssistantOptions>) => {
    chrome.runtime.sendMessage({ type: 'UPDATE_ASSISTANT_OPTIONS', payload: patch });
  }, []);

  const updateModelSelector = useCallback((value: string) => {
    const next: ModelSelectorState = {
      value: value.trim() || 'OpenClaw default model',
      updatedAt: null,
    };
    updateAssistantOptions({ preferredModel: next });
  }, [updateAssistantOptions]);

  const updateSettings = useCallback((nextSettings: StateResponse['settings']) => {
    chrome.storage.sync.set({ settings: nextSettings });
  }, []);

  const handleToggle = () => {
    if (toggling || !state) return;
    setToggling(true);
    chrome.runtime.sendMessage(
      { type: 'TOGGLE_BLOCKING' },
      (response: { enableBlocking: boolean }) => {
        setState((prev) =>
          prev
            ? { ...prev, settings: { ...prev.settings, enableBlocking: response.enableBlocking } }
            : prev,
        );
        setToggling(false);
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
      <div className="flex h-[420px] w-[460px] items-center justify-center bg-[var(--fg-bg)] text-sm text-[var(--fg-muted)]">
        Loading Window…
      </div>
    );
  }

  if (!state) {
    return (
      <div className="w-[460px] p-5 bg-[var(--fg-bg)] text-sm text-rose-600">
        Failed to load the extension state.
      </div>
    );
  }

  const {
    assistantOptions,
    backendSession,
    backendSyncState,
    calendarState,
    ideaState,
    openClawState,
    settings,
    snoozeState,
  } = state;
  const calendarConnected = calendarState.lastSyncedAt !== null && calendarState.authError === null;
  const effectivelyBlocking = settings.enableBlocking && calendarState.isRestricted;
  const activeAccent =
    calendarState.authError !== null || calendarState.lastSyncedAt === null
      ? 'rose'
      : snoozeState.active
        ? 'amber'
        : effectivelyBlocking
          ? 'emerald'
          : 'slate';
  const now = Date.now();
  const nextEvent =
    calendarState.todaysEvents
      .filter((event) => new Date(event.start).getTime() > now)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0] ?? null;
  const inboxIdeas = ideaState.items.filter((item) => !item.archived).slice(0, 4);

  return (
    <div className="max-h-[760px] w-[460px] overflow-y-auto bg-[var(--fg-bg)] font-sans select-none">
      <header className="border-b border-[var(--fg-border)] px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--fg-border)] bg-white/80 px-3 py-1 text-[11px] font-medium text-[var(--fg-muted)] shadow-sm">
              <span className={`h-2 w-2 rounded-full ${accentDot(activeAccent)}`} />
              Window dashboard
            </div>
            <h1 className="text-xl font-semibold tracking-[-0.03em] text-[var(--fg-text)]">Window</h1>
            <p className="text-sm leading-5 text-[var(--fg-muted)]">
              Focus controls, OpenClaw access, and idea capture without context switching.
            </p>
          </div>

          <button
            onClick={handleToggle}
            disabled={toggling || !calendarConnected}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              settings.enableBlocking
                ? 'bg-[var(--fg-accent)] text-white shadow-[0_12px_30px_rgba(0,102,255,0.22)]'
                : 'border border-[var(--fg-border)] bg-white text-[var(--fg-muted)]'
            } ${toggling || !calendarConnected ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            {settings.enableBlocking ? 'Blocking ON' : 'Blocking OFF'}
          </button>
        </div>
      </header>

      <div className="space-y-4 px-5 py-4">
        <CalendarConnect calendarState={calendarState} onStateChange={loadState} />

        {calendarConnected && (
          <>
            <section className="grid gap-3">
              <DashboardCard
                eyebrow="Active event"
                title={calendarState.currentEvent?.title ?? 'No focus block live'}
                caption={
                  calendarState.currentEvent
                    ? formatEventRange(calendarState.currentEvent)
                    : 'Browsing is open until a configured event starts.'
                }
              >
                <p className="text-sm text-[var(--fg-muted)]">
                  {describeRuleSource(calendarState.activeRuleSource, calendarState.activeRuleName)}
                </p>
                {snoozeState.active && snoozeState.expiresAt && (
                  <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Break active. Blocking resumes in {formatCountdown(snoozeState.expiresAt)}.
                  </div>
                )}
              </DashboardCard>

              <DashboardCard
                eyebrow="Capture idea"
                title="Send it to OpenClaw"
                caption="Capture now, research later, stay on task."
              >
                <div className="space-y-3">
                  <textarea
                    rows={3}
                    value={ideaInput}
                    onChange={(event) => {
                      setIdeaInput(event.target.value);
                      setIdeaError(null);
                    }}
                    placeholder="I want to build a marketplace for horse breeders. Is this viable?"
                    className="fg-input min-h-[96px] resize-none"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-[var(--fg-muted)]">
                      {backendSyncState.connected
                        ? `Synced to backend${backendSession ? ` as ${backendSession.userId}` : ''}.`
                        : backendSyncState.lastError ?? 'Queued locally until the backend reconnects.'}
                    </div>
                    <button
                      onClick={handleIdeaSubmit}
                      disabled={submittingIdea}
                      className="fg-button-primary"
                    >
                      {submittingIdea ? 'Submitting…' : 'Capture Idea'}
                    </button>
                  </div>
                  {ideaError && <p className="text-xs text-rose-600">{ideaError}</p>}
                </div>
              </DashboardCard>

              <div className="grid grid-cols-2 gap-3">
                <DashboardCard
                  eyebrow="Break duration"
                  title={`${settings.breakDurationMinutes} min`}
                  caption="Default from blocked page"
                >
                  <select
                    value={settings.breakDurationMinutes}
                    onChange={(event) => {
                      const next = Number(event.target.value) as 5 | 10 | 15;
                      setState((prev) =>
                        prev ? { ...prev, settings: { ...prev.settings, breakDurationMinutes: next } } : prev,
                      );
                      updateSettings({ ...settings, breakDurationMinutes: next });
                    }}
                    className="fg-select w-full"
                  >
                    <option value={5}>5 min</option>
                    <option value={10}>10 min</option>
                    <option value={15}>15 min</option>
                  </select>
                </DashboardCard>

                <DashboardCard
                  eyebrow="Keyword fallback"
                  title={settings.keywordAutoMatchEnabled ? 'Enabled' : 'Disabled'}
                  caption="Advanced rule helper"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-[var(--fg-muted)]">Only applies without an exact Event Rule.</p>
                    <Toggle
                      checked={settings.keywordAutoMatchEnabled}
                      onChange={(checked) => {
                        setState((prev) =>
                          prev
                            ? { ...prev, settings: { ...prev.settings, keywordAutoMatchEnabled: checked } }
                            : prev,
                        );
                        updateSettings({ ...settings, keywordAutoMatchEnabled: checked });
                      }}
                    />
                  </div>
                </DashboardCard>
              </div>

              <DashboardCard
                eyebrow="OpenClaw assistant"
                title={openClawState.status.connected ? 'Connected' : 'Offline'}
                caption={openClawState.status.message ?? 'Session controls for async assistant work.'}
              >
                <AssistantPanel
                  assistantOptions={assistantOptions}
                  modelDraft={modelDraft}
                  openClawState={openClawState}
                  breakTelemetryEnabled={settings.breakTelemetryEnabled}
                  onModelDraftChange={setModelDraft}
                  onModelCommit={updateModelSelector}
                  onToggleReuse={(checked) => updateAssistantOptions({ reuseActiveSession: checked })}
                  onToggleAutoCreate={(checked) => updateAssistantOptions({ autoCreateSession: checked })}
                  onNotesChange={(value) => updateAssistantOptions({ notes: value })}
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
                />
              </DashboardCard>

              <DashboardCard
                eyebrow="Idea inbox"
                title={`${ideaState.unreadCount} unread · ${ideaState.outboxDepth} queued`}
                caption={
                  ideaState.items.length > 0
                    ? 'Recent results from your OpenClaw-assisted idea queue.'
                    : 'Captured ideas and reports will show up here.'
                }
              >
                <IdeaInbox
                  ideas={inboxIdeas}
                  nextEvent={nextEvent}
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
              </DashboardCard>

              <DashboardCard
                eyebrow="Next relevant event"
                title={nextEvent?.title ?? 'No more events today'}
                caption={
                  nextEvent
                    ? formatEventRange(nextEvent)
                    : 'You’re clear after the current block.'
                }
              >
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => chrome.runtime.openOptionsPage()}
                    className="fg-button-primary"
                  >
                    Open Calendar Workspace
                  </button>
                  <button
                    onClick={() => chrome.runtime.sendMessage({ type: 'SNOOZE' })}
                    className="fg-button-secondary"
                  >
                    Start Break
                  </button>
                </div>
              </DashboardCard>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function DashboardCard({
  eyebrow,
  title,
  caption,
  children,
}: {
  eyebrow: string;
  title: string;
  caption: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="fg-card p-4">
      <div className="mb-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">{eyebrow}</p>
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-[var(--fg-text)]">{title}</h2>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">{caption}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function AssistantPanel({
  assistantOptions,
  modelDraft,
  openClawState,
  breakTelemetryEnabled,
  onModelDraftChange,
  onModelCommit,
  onToggleReuse,
  onToggleAutoCreate,
  onNotesChange,
  onToggleTelemetry,
  onRefresh,
  onStartSession,
  onReuseSession,
  onCancelJob,
}: {
  assistantOptions: AssistantOptions;
  modelDraft: string;
  openClawState: StateResponse['openClawState'];
  breakTelemetryEnabled: boolean;
  onModelDraftChange: (value: string) => void;
  onModelCommit: (value: string) => void;
  onToggleReuse: (checked: boolean) => void;
  onToggleAutoCreate: (checked: boolean) => void;
  onNotesChange: (value: string) => void;
  onToggleTelemetry: (checked: boolean) => void;
  onRefresh: () => void;
  onStartSession: () => void;
  onReuseSession: (sessionId: string) => void;
  onCancelJob: (jobId: string) => void;
}): React.JSX.Element {
  const reusableSession = openClawState.sessions.find((session) => session.status !== 'closed');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-3">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--fg-muted)]">Transport</p>
          <p className="mt-1 text-sm font-medium text-[var(--fg-text)]">{openClawState.status.transport.toUpperCase()}</p>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">{openClawState.status.label ?? 'Oracle-hosted OpenClaw'}</p>
        </div>
        <div className="rounded-2xl border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-3">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--fg-muted)]">Current job</p>
          <p className="mt-1 text-sm font-medium text-[var(--fg-text)]">{openClawState.currentJob?.status ?? 'idle'}</p>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">{openClawState.currentJob?.title ?? 'No job running right now.'}</p>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs uppercase tracking-[0.16em] text-[var(--fg-muted)]">Model selector</label>
        <input
          type="text"
          value={modelDraft}
          onChange={(event) => onModelDraftChange(event.target.value)}
          onBlur={() => onModelCommit(modelDraft)}
          placeholder="OpenClaw default model"
          className="fg-input"
        />
        <p className="text-xs text-[var(--fg-muted)]">
          Placeholder only for now. You can swap this for the real selector later.
        </p>
      </div>

      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-3">
          <div>
            <p className="text-sm font-medium text-[var(--fg-text)]">Reuse active session</p>
            <p className="text-xs text-[var(--fg-muted)]">Send new ideas into the current OpenClaw thread when possible.</p>
          </div>
          <Toggle checked={assistantOptions.reuseActiveSession} onChange={onToggleReuse} />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-3">
          <div>
            <p className="text-sm font-medium text-[var(--fg-text)]">Auto-create session</p>
            <p className="text-xs text-[var(--fg-muted)]">Open a fresh OpenClaw session if no reusable one exists.</p>
          </div>
          <Toggle checked={assistantOptions.autoCreateSession} onChange={onToggleAutoCreate} />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-3">
          <div>
            <p className="text-sm font-medium text-[var(--fg-text)]">Break telemetry</p>
            <p className="text-xs text-[var(--fg-muted)]">Opt in to domain-only logging during active breaks.</p>
          </div>
          <Toggle checked={breakTelemetryEnabled} onChange={onToggleTelemetry} />
        </div>
      </div>

      <textarea
        rows={2}
        value={assistantOptions.notes}
        onChange={(event) => onNotesChange(event.target.value)}
        placeholder="Optional assistant notes or session hints"
        className="fg-input min-h-[82px] resize-none"
      />

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.16em] text-[var(--fg-muted)]">Recent sessions</p>
        {openClawState.sessions.length === 0 ? (
          <p className="text-sm text-[var(--fg-muted)]">No sessions cached yet.</p>
        ) : (
          <div className="space-y-2">
            {openClawState.sessions.slice(0, 3).map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                active={session.id === openClawState.activeSessionId}
                onReuse={() => onReuseSession(session.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={onRefresh} className="fg-button-secondary">Refresh</button>
        <button onClick={onStartSession} className="fg-button-secondary">New Session</button>
        {reusableSession && (
          <button onClick={() => onReuseSession(reusableSession.id)} className="fg-button-secondary">
            Reuse Session
          </button>
        )}
        {openClawState.currentJob && (
          <button onClick={() => onCancelJob(openClawState.currentJob!.id)} className="fg-button-secondary">
            Cancel Job
          </button>
        )}
      </div>
    </div>
  );
}

function IdeaInbox({
  ideas,
  nextEvent,
  onKeep,
  onDiscard,
  onRetry,
}: {
  ideas: IdeaRecord[];
  nextEvent: CalendarEvent | null;
  onKeep: (localId: string) => void;
  onDiscard: (localId: string) => void;
  onRetry: (localId: string) => void;
}): React.JSX.Element {
  if (ideas.length === 0) {
    return (
      <p className="text-sm text-[var(--fg-muted)]">
        Nothing queued yet. Your next idea will appear here and come back with a report later.
        {nextEvent ? ` Next event: ${nextEvent.title}.` : ''}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {ideas.map((idea) => (
        <div
          key={idea.localId}
          className="rounded-2xl border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-[var(--fg-text)]">{idea.prompt}</p>
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--fg-muted)]">{idea.status}</p>
            </div>
            {idea.unread && (
              <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-700">
                New
              </span>
            )}
          </div>

          {idea.report ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-[var(--fg-muted)]">{idea.report.summary}</p>
              <div className="grid grid-cols-3 gap-2 text-xs text-[var(--fg-muted)]">
                <span>Viability: {idea.report.viability}</span>
                <span>Build: {idea.report.buildEffort}</span>
                <span>Revenue: {idea.report.revenuePotential}</span>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {!idea.saved && !idea.archived && (
                  <>
                    <button onClick={() => onKeep(idea.localId)} className="fg-button-primary">
                      Keep
                    </button>
                    <button onClick={() => onDiscard(idea.localId)} className="fg-button-secondary">
                      Discard
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-sm text-[var(--fg-muted)]">
                {idea.error
                  ? `Last error: ${idea.error}`
                  : idea.status === 'queued' || idea.status === 'syncing'
                    ? 'Waiting for backend sync.'
                    : 'OpenClaw is still working on this one.'}
              </p>
              {(idea.status === 'failed' || idea.error) && (
                <button onClick={() => onRetry(idea.localId)} className="fg-button-secondary">
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
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2">
      <div>
        <p className="text-sm font-medium text-[var(--fg-text)]">{session.title}</p>
        <p className="text-xs text-[var(--fg-muted)]">
          {session.status} · {session.modelLabel ?? 'OpenClaw default'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {active && (
          <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
            Active
          </span>
        )}
        <button onClick={onReuse} className="fg-button-ghost">
          Use
        </button>
      </div>
    </div>
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

function describeRuleSource(
  source: 'event' | 'keyword' | 'none',
  name: string | null,
): string {
  if (source === 'event' && name) return `Exact Event Rule active for “${name}”.`;
  if (source === 'keyword' && name) return `Keyword fallback “${name}” is currently controlling this event.`;
  return 'No Event Rule matched, so this event remains unrestricted.';
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

function accentDot(accent: 'emerald' | 'blue' | 'amber' | 'violet' | 'slate' | 'rose'): string {
  switch (accent) {
    case 'emerald':
      return 'bg-emerald-500';
    case 'blue':
      return 'bg-blue-500';
    case 'amber':
      return 'bg-amber-500';
    case 'violet':
      return 'bg-violet-500';
    case 'rose':
      return 'bg-rose-500';
    default:
      return 'bg-slate-400';
  }
}
