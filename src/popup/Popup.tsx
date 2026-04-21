import React, { useCallback, useEffect, useState } from 'react';
import type {
  AssistantOptions,
  CalendarEvent,
  IdeaRecord,
  StateResponse,
} from '../shared/types';
import { formatBlockingPauseTimeLabel, isDailyBlockingPauseActive } from '../shared/blockingSchedule';
import { MODEL_PLACEHOLDER_OPTIONS } from '../shared/constants';
import AccountStatusControl from '../shared/components/AccountStatusControl';
import CompactSettingRow from '../shared/components/CompactSettingRow';
import PointsBubble from '../shared/components/PointsBubble';
import CompletionModal from './components/CompletionModal';
import TaskQueue from './components/TaskQueue';

type PanelSectionId = 'assistant' | 'focus' | 'controls' | 'analytics';

interface PanelLayoutPrefs {
  order: PanelSectionId[];
  collapsed: Record<PanelSectionId, boolean>;
}

const PANEL_LAYOUT_STORAGE_KEY = 'panelLayoutPrefs';
const DEFAULT_PANEL_ORDER: PanelSectionId[] = ['assistant', 'focus', 'controls', 'analytics'];
const DEFAULT_PANEL_COLLAPSED: Record<PanelSectionId, boolean> = {
  assistant: false,
  focus: false,
  controls: true,
  analytics: true,
};
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
  const [popupAssistantSettingsOpen, setPopupAssistantSettingsOpen] = useState(false);
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
    if (mode !== 'panel') return;

    chrome.storage.local.get(PANEL_LAYOUT_STORAGE_KEY, (result) => {
      const raw = result[PANEL_LAYOUT_STORAGE_KEY] as Partial<PanelLayoutPrefs> | undefined;
      const order = sanitizePanelOrder(raw?.order);
      const collapsed = {
        ...DEFAULT_PANEL_COLLAPSED,
        ...(raw?.collapsed ?? {}),
      };
      setPanelOrder(order);
      setPanelCollapsed(collapsed);
    });
  }, [mode]);

  useEffect(() => {
    if (mode !== 'panel') return;

    chrome.storage.local.set({
      [PANEL_LAYOUT_STORAGE_KEY]: {
        order: panelOrder,
        collapsed: panelCollapsed,
      } satisfies PanelLayoutPrefs,
    });
  }, [mode, panelCollapsed, panelOrder]);

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

  const togglePanelSection = useCallback((sectionId: PanelSectionId) => {
    setPanelCollapsed((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  }, []);

  const movePanelSection = useCallback((source: PanelSectionId, target: PanelSectionId) => {
    if (source === target) return;
    setPanelOrder((current) => {
      const next = [...current];
      const sourceIndex = next.indexOf(source);
      const targetIndex = next.indexOf(target);
      if (sourceIndex === -1 || targetIndex === -1) return current;
      next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, source);
      return next;
    });
  }, []);

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
    analyticsSnapshot,
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
  const activeLaunchTarget = calendarState.activeLaunchTarget ?? null;
  const activeLaunchTargetHost = activeLaunchTarget
    ? safeHostname(activeLaunchTarget.launchUrl)
    : null;
  const inboxIdeas = ideaState.items.filter((item) => !item.archived).slice(0, 3);
  const actionableTasks = taskQueue.filter((task) => task.status === 'active' || task.status === 'carryover');
  const selectedModel = MODEL_PLACEHOLDER_OPTIONS.includes(
    assistantOptions.preferredModel.value as (typeof MODEL_PLACEHOLDER_OPTIONS)[number],
  )
    ? assistantOptions.preferredModel.value
    : MODEL_PLACEHOLDER_OPTIONS[0];
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
  if (mode === 'panel') {
    return (
      <>
        <PanelDashboard
          accountConflict={accountConflict}
          accountSyncState={accountSyncState}
          accountUser={accountUser}
          actionableTasks={actionableTasks}
          activeLaunchTarget={activeLaunchTarget}
          activeLaunchTargetHost={activeLaunchTargetHost}
          allTimeStats={allTimeStats}
          analyticsSnapshot={analyticsSnapshot}
          assistantOptions={assistantOptions}
          backendSession={backendSession}
          backendSyncState={backendSyncState}
          calendarState={calendarState}
          dropTargetSection={dropTargetSection}
          draggedSection={draggedSection}
          headerCaption={headerCaption}
          ideaError={ideaError}
          ideaInput={ideaInput}
          inboxIdeas={inboxIdeas}
          nextEvent={nextEvent}
          onAccountConnectCalendar={() =>
            sendMessageAsync({ type: 'CONNECT_CALENDAR' }).then(loadState)
          }
          onAccountDisconnectCalendar={() =>
            sendMessageAsync({ type: 'DISCONNECT_CALENDAR' }).then(loadState)
          }
          onAccountRefresh={() =>
            sendMessageAsync({ type: 'REFRESH_ACCOUNT_STATE' }).then(loadState)
          }
          onAccountResolveConflict={(choice) =>
            sendMessageAsync({ type: 'RESOLVE_ACCOUNT_CONFLICT', payload: { choice } }).then(loadState)
          }
          onAccountSignIn={() =>
            sendMessageAsync({ type: 'SIGN_IN_WITH_PROVIDER', payload: { provider: 'google' } }).then(loadState)
          }
          onAccountSignOut={() =>
            sendMessageAsync({ type: 'SIGN_OUT_ACCOUNT' }).then(loadState)
          }
          onCancelJob={(jobId) =>
            chrome.runtime.sendMessage({ type: 'CANCEL_OPENCLAW_JOB', payload: { jobId } })
          }
          onDiscardIdea={(localId) =>
            chrome.runtime.sendMessage({
              type: 'DECIDE_IDEA',
              payload: { localId, decision: 'discard' },
            })
          }
          onDragEnd={() => {
            setDraggedSection(null);
            setDropTargetSection(null);
          }}
          onDragOverSection={(sectionId) => setDropTargetSection(sectionId)}
          onDropSection={(sectionId) => {
            if (draggedSection) {
              movePanelSection(draggedSection, sectionId);
            }
            setDraggedSection(null);
            setDropTargetSection(null);
          }}
          onIdeaInputChange={(value) => {
            setIdeaInput(value);
            setIdeaError(null);
          }}
          onIdeaSubmit={handleIdeaSubmit}
          onKeepIdea={(localId) =>
            chrome.runtime.sendMessage({
              type: 'DECIDE_IDEA',
              payload: { localId, decision: 'keep' },
            })
          }
          onMarkTaskDone={() => setCompletionModalOpen(true)}
          onModelSelect={updateModelSelector}
          onOpenActiveLaunchTarget={() => {
            void sendMessageAsync({ type: 'OPEN_ACTIVE_LAUNCH_TARGET' });
          }}
          onOpenSettings={() => chrome.runtime.openOptionsPage()}
          onRefreshAssistant={() => chrome.runtime.sendMessage({ type: 'REFRESH_ASSISTANT_STATE' })}
          onRefreshAnalytics={() => chrome.runtime.sendMessage({ type: 'REFRESH_ANALYTICS_STATE' })}
          onReuseSession={(sessionId) =>
            chrome.runtime.sendMessage({ type: 'REUSE_OPENCLAW_SESSION', payload: { sessionId } })
          }
          onRetryIdea={(localId) =>
            chrome.runtime.sendMessage({
              type: 'RETRY_IDEA',
              payload: { localId },
            })
          }
          onSectionDragStart={(sectionId) => setDraggedSection(sectionId)}
          onStartBreak={() => chrome.runtime.sendMessage({ type: 'SNOOZE' })}
          onStartSession={() => chrome.runtime.sendMessage({ type: 'START_OPENCLAW_SESSION' })}
          onToggleAutoCreate={(checked) => updateAssistantOptions({ autoCreateSession: checked })}
          onToggleBlocking={handleToggle}
          onTogglePersistentPanel={togglePersistentPanel}
          onToggleReuse={(checked) => updateAssistantOptions({ reuseActiveSession: checked })}
          onToggleSection={togglePanelSection}
          onToggleTelemetry={(checked) => {
            setState((prev) =>
              prev ? { ...prev, settings: { ...prev.settings, breakTelemetryEnabled: checked } } : prev,
            );
            updateSettings({ ...settings, breakTelemetryEnabled: checked });
          }}
          onUpdateBreakDuration={(next) => {
            setState((prev) =>
              prev ? { ...prev, settings: { ...prev.settings, breakDurationMinutes: next } } : prev,
            );
            updateSettings({ ...settings, breakDurationMinutes: next });
          }}
          openClawState={openClawState}
          panelCollapsed={panelCollapsed}
          panelOrder={panelOrder}
          selectedModel={selectedModel}
          settings={settings}
          snoozeState={snoozeState}
          submittingIdea={submittingIdea}
        />

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
      </>
    );
  }

  return (
    <div className="max-h-[760px] w-[460px] overflow-y-auto bg-[var(--fg-bg)] font-sans select-none">
      <header className="sticky top-0 z-20 border-b border-[var(--fg-border)] bg-[var(--fg-bg)]/92 px-2.5 py-2 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold tracking-[-0.03em] text-[var(--fg-text)]">Window</h1>
            <p className="mt-1 text-[11px] leading-4 text-[var(--fg-muted)]">{headerCaption}</p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <PointsBubble
              points={allTimeStats.totalPoints}
              level={allTimeStats.level}
              title={allTimeStats.title}
              compact
            />
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

        <div className="mt-2 grid gap-2">
          <div className="rounded-[16px] border border-[var(--fg-border)] bg-white px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--fg-muted)]">Focus</p>
            <p className="mt-1 truncate text-sm font-semibold text-[var(--fg-text)]">
              {calendarState.currentEvent
                ? `${calendarState.currentEvent.title} · ${formatEventRange(calendarState.currentEvent)}`
                : nextEvent
                  ? `Next: ${nextEvent.title} · ${formatEventRange(nextEvent)}`
                  : 'No live focus block'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-[16px] border border-[var(--fg-border)] bg-white px-2 py-2">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--fg-muted)]">Surface</p>
              <BinarySelector
                leftLabel="Popup"
                rightLabel="Docked"
                selected={settings.persistentPanelEnabled ? 'right' : 'left'}
                onSelect={(selection) => togglePersistentPanel(selection === 'right')}
              />
            </div>

            <div className="rounded-[16px] border border-[var(--fg-border)] bg-white px-2 py-2">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--fg-muted)]">Blocking</p>
              <BinarySelector
                leftLabel="Off"
                rightLabel="On"
                selected={settings.enableBlocking ? 'right' : 'left'}
                onSelect={(selection) => {
                  const shouldEnable = selection === 'right';
                  if (shouldEnable !== settings.enableBlocking) {
                    handleToggle();
                  }
                }}
              />
            </div>
          </div>
        </div>
      </header>

      <div className="space-y-1.5 px-2.5 py-2">
        <PopupSectionCard title="Assistant" badge={openClawState.status.connected ? 'Live' : 'Offline'}>
          <PanelAssistantSection
            assistantOptions={assistantOptions}
            backendSession={backendSession}
            backendSyncState={backendSyncState}
            currentJob={openClawState.currentJob}
            ideaError={ideaError}
            ideaInput={ideaInput}
            inboxIdeas={inboxIdeas}
            onCancelJob={(jobId) =>
              chrome.runtime.sendMessage({ type: 'CANCEL_OPENCLAW_JOB', payload: { jobId } })
            }
            onDiscardIdea={(localId) =>
              chrome.runtime.sendMessage({
                type: 'DECIDE_IDEA',
                payload: { localId, decision: 'discard' },
              })
            }
            onIdeaInputChange={(value) => {
              setIdeaInput(value);
              setIdeaError(null);
            }}
            onIdeaSubmit={handleIdeaSubmit}
            onKeepIdea={(localId) =>
              chrome.runtime.sendMessage({
                type: 'DECIDE_IDEA',
                payload: { localId, decision: 'keep' },
              })
            }
            onModelSelect={updateModelSelector}
            onRefreshAssistant={() => chrome.runtime.sendMessage({ type: 'REFRESH_ASSISTANT_STATE' })}
            onReuseSession={(sessionId) =>
              chrome.runtime.sendMessage({ type: 'REUSE_OPENCLAW_SESSION', payload: { sessionId } })
            }
            onRetryIdea={(localId) =>
              chrome.runtime.sendMessage({
                type: 'RETRY_IDEA',
                payload: { localId },
              })
            }
            onStartSession={() => chrome.runtime.sendMessage({ type: 'START_OPENCLAW_SESSION' })}
            onToggleAutoCreate={(checked) => updateAssistantOptions({ autoCreateSession: checked })}
            onToggleReuse={(checked) => updateAssistantOptions({ reuseActiveSession: checked })}
            onToggleTelemetry={(checked) => {
              setState((prev) =>
                prev ? { ...prev, settings: { ...prev.settings, breakTelemetryEnabled: checked } } : prev,
              );
              updateSettings({ ...settings, breakTelemetryEnabled: checked });
            }}
            openClawState={openClawState}
            selectedModel={selectedModel}
            settingsOpen={popupAssistantSettingsOpen}
            submittingIdea={submittingIdea}
            telemetryEnabled={settings.breakTelemetryEnabled}
            toggleSettingsOpen={() => setPopupAssistantSettingsOpen((current) => !current)}
          />
        </PopupSectionCard>

        <PopupSectionCard title="Focus" badge={actionableTasks.length > 0 ? `${actionableTasks.length}` : null}>
          <PanelFocusSection
            actionableTasks={actionableTasks}
            activeLaunchTarget={activeLaunchTarget}
            activeLaunchTargetHost={activeLaunchTargetHost}
            liveFocusLabel={
              calendarState.currentEvent
                ? `${calendarState.currentEvent.title} · ${formatEventRange(calendarState.currentEvent)}`
                : nextEvent
                  ? `Next: ${nextEvent.title} · ${formatEventRange(nextEvent)}`
                  : 'No live focus block'
            }
            onMarkTaskDone={() => setCompletionModalOpen(true)}
            onOpenActiveLaunchTarget={() => {
              void sendMessageAsync({ type: 'OPEN_ACTIVE_LAUNCH_TARGET' });
            }}
            snoozeState={snoozeState}
          />
        </PopupSectionCard>

        <PopupSectionCard title="Controls">
          <PanelControlsSection
            breakDurationMinutes={settings.breakDurationMinutes}
            onOpenSettings={() => chrome.runtime.openOptionsPage()}
            onStartBreak={() => chrome.runtime.sendMessage({ type: 'SNOOZE' })}
            onUpdateBreakDuration={(next) => {
              setState((prev) =>
                prev ? { ...prev, settings: { ...prev.settings, breakDurationMinutes: next } } : prev,
              );
              updateSettings({ ...settings, breakDurationMinutes: next });
            }}
          />
        </PopupSectionCard>

        <PopupSectionCard title="Analytics" badge={`${analyticsSnapshot.summary7d.totalFocusSessions}`}>
          <PanelAnalyticsSection
            analyticsSnapshot={analyticsSnapshot}
            onRefreshAnalytics={() => chrome.runtime.sendMessage({ type: 'REFRESH_ANALYTICS_STATE' })}
          />
        </PopupSectionCard>
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

function PanelDashboard({
  accountConflict,
  accountSyncState,
  accountUser,
  actionableTasks,
  activeLaunchTarget,
  activeLaunchTargetHost,
  allTimeStats,
  analyticsSnapshot,
  assistantOptions,
  backendSession,
  backendSyncState,
  calendarState,
  dropTargetSection,
  draggedSection,
  headerCaption,
  ideaError,
  ideaInput,
  inboxIdeas,
  nextEvent,
  onAccountConnectCalendar,
  onAccountDisconnectCalendar,
  onAccountRefresh,
  onAccountResolveConflict,
  onAccountSignIn,
  onAccountSignOut,
  onCancelJob,
  onDiscardIdea,
  onDragEnd,
  onDragOverSection,
  onDropSection,
  onIdeaInputChange,
  onIdeaSubmit,
  onKeepIdea,
  onMarkTaskDone,
  onModelSelect,
  onOpenActiveLaunchTarget,
  onOpenSettings,
  onRefreshAssistant,
  onRefreshAnalytics,
  onReuseSession,
  onRetryIdea,
  onSectionDragStart,
  onStartBreak,
  onStartSession,
  onToggleAutoCreate,
  onToggleBlocking,
  onTogglePersistentPanel,
  onToggleReuse,
  onToggleSection,
  onToggleTelemetry,
  onUpdateBreakDuration,
  openClawState,
  panelCollapsed,
  panelOrder,
  selectedModel,
  settings,
  snoozeState,
  submittingIdea,
}: {
  accountConflict: StateResponse['accountConflict'];
  accountSyncState: StateResponse['accountSyncState'];
  accountUser: StateResponse['accountUser'];
  actionableTasks: StateResponse['taskQueue'];
  activeLaunchTarget: StateResponse['calendarState']['activeLaunchTarget'];
  activeLaunchTargetHost: string | null;
  allTimeStats: StateResponse['allTimeStats'];
  analyticsSnapshot: StateResponse['analyticsSnapshot'];
  assistantOptions: StateResponse['assistantOptions'];
  backendSession: StateResponse['backendSession'];
  backendSyncState: StateResponse['backendSyncState'];
  calendarState: StateResponse['calendarState'];
  dropTargetSection: PanelSectionId | null;
  draggedSection: PanelSectionId | null;
  headerCaption: string;
  ideaError: string | null;
  ideaInput: string;
  inboxIdeas: IdeaRecord[];
  nextEvent: CalendarEvent | null;
  onAccountConnectCalendar: () => Promise<unknown>;
  onAccountDisconnectCalendar: () => Promise<unknown>;
  onAccountRefresh: () => Promise<unknown>;
  onAccountResolveConflict: (choice: 'local' | 'remote') => Promise<unknown>;
  onAccountSignIn: () => Promise<unknown>;
  onAccountSignOut: () => Promise<unknown>;
  onCancelJob: (jobId: string) => void;
  onDiscardIdea: (localId: string) => void;
  onDragEnd: () => void;
  onDragOverSection: (sectionId: PanelSectionId) => void;
  onDropSection: (sectionId: PanelSectionId) => void;
  onIdeaInputChange: (value: string) => void;
  onIdeaSubmit: () => void;
  onKeepIdea: (localId: string) => void;
  onMarkTaskDone: () => void;
  onModelSelect: (value: string) => void;
  onOpenActiveLaunchTarget: () => void;
  onOpenSettings: () => void;
  onRefreshAssistant: () => void;
  onRefreshAnalytics: () => void;
  onReuseSession: (sessionId: string) => void;
  onRetryIdea: (localId: string) => void;
  onSectionDragStart: (sectionId: PanelSectionId) => void;
  onStartBreak: () => void;
  onStartSession: () => void;
  onToggleAutoCreate: (checked: boolean) => void;
  onToggleBlocking: () => void;
  onTogglePersistentPanel: (enabled: boolean) => void;
  onToggleReuse: (checked: boolean) => void;
  onToggleSection: (sectionId: PanelSectionId) => void;
  onToggleTelemetry: (checked: boolean) => void;
  onUpdateBreakDuration: (next: 5 | 10 | 15) => void;
  openClawState: StateResponse['openClawState'];
  panelCollapsed: Record<PanelSectionId, boolean>;
  panelOrder: PanelSectionId[];
  selectedModel: string;
  settings: StateResponse['settings'];
  snoozeState: StateResponse['snoozeState'];
  submittingIdea: boolean;
}): React.JSX.Element {
  const [assistantSettingsOpen, setAssistantSettingsOpen] = useState(false);
  const currentJob = openClawState.currentJob;
  const liveFocusLabel = calendarState.currentEvent
    ? `${calendarState.currentEvent.title} · ${formatEventRange(calendarState.currentEvent)}`
    : nextEvent
      ? `Next: ${nextEvent.title} · ${formatEventRange(nextEvent)}`
      : 'No live focus block';

  const sections: Record<PanelSectionId, { title: string; content: React.ReactNode; badge?: string | null }> = {
    assistant: {
      title: 'Assistant',
      badge: openClawState.status.connected ? 'Live' : 'Offline',
      content: (
        <PanelAssistantSection
          assistantOptions={assistantOptions}
          backendSession={backendSession}
          backendSyncState={backendSyncState}
          currentJob={currentJob}
          ideaError={ideaError}
          ideaInput={ideaInput}
          inboxIdeas={inboxIdeas}
          onCancelJob={onCancelJob}
          onDiscardIdea={onDiscardIdea}
          onIdeaInputChange={onIdeaInputChange}
          onIdeaSubmit={onIdeaSubmit}
          onKeepIdea={onKeepIdea}
          onModelSelect={onModelSelect}
          onRefreshAssistant={onRefreshAssistant}
          onReuseSession={onReuseSession}
          onRetryIdea={onRetryIdea}
          onStartSession={onStartSession}
          onToggleAutoCreate={onToggleAutoCreate}
          onToggleReuse={onToggleReuse}
          onToggleTelemetry={onToggleTelemetry}
          openClawState={openClawState}
          selectedModel={selectedModel}
          settingsOpen={assistantSettingsOpen}
          submittingIdea={submittingIdea}
          telemetryEnabled={settings.breakTelemetryEnabled}
          toggleSettingsOpen={() => setAssistantSettingsOpen((current) => !current)}
        />
      ),
    },
    focus: {
      title: 'Focus',
      badge: actionableTasks.length > 0 ? `${actionableTasks.length}` : null,
      content: (
        <PanelFocusSection
          actionableTasks={actionableTasks}
          activeLaunchTarget={activeLaunchTarget}
          activeLaunchTargetHost={activeLaunchTargetHost}
          liveFocusLabel={liveFocusLabel}
          onMarkTaskDone={onMarkTaskDone}
          onOpenActiveLaunchTarget={onOpenActiveLaunchTarget}
          snoozeState={snoozeState}
        />
      ),
    },
    controls: {
      title: 'Controls',
      content: (
        <PanelControlsSection
          breakDurationMinutes={settings.breakDurationMinutes}
          onOpenSettings={onOpenSettings}
          onStartBreak={onStartBreak}
          onUpdateBreakDuration={onUpdateBreakDuration}
        />
      ),
    },
    analytics: {
      title: 'Analytics',
      badge: `${analyticsSnapshot.summary7d.totalFocusSessions}`,
      content: (
        <PanelAnalyticsSection
          analyticsSnapshot={analyticsSnapshot}
          onRefreshAnalytics={onRefreshAnalytics}
        />
      ),
    },
  };

  return (
    <div className="min-h-screen bg-[var(--fg-bg)] font-sans">
      <header className="sticky top-0 z-20 border-b border-[var(--fg-border)] bg-[var(--fg-bg)]/94 px-3 py-2 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold tracking-[-0.03em] text-[var(--fg-text)]">Window</h1>
            <p className="mt-1 text-[11px] leading-4 text-[var(--fg-muted)]">{headerCaption}</p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <PointsBubble
              points={allTimeStats.totalPoints}
              level={allTimeStats.level}
              title={allTimeStats.title}
              compact
            />
            <AccountStatusControl
              accountUser={accountUser}
              accountSyncState={accountSyncState}
              accountConflict={accountConflict}
              calendarState={calendarState}
              onSignIn={onAccountSignIn}
              onRefresh={onAccountRefresh}
              onSignOut={onAccountSignOut}
              onResolveConflict={onAccountResolveConflict}
              onConnectCalendar={onAccountConnectCalendar}
              onDisconnectCalendar={onAccountDisconnectCalendar}
            />
          </div>
        </div>

        <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr),minmax(0,1fr)]">
          <div className="rounded-[16px] border border-[var(--fg-border)] bg-white px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--fg-muted)]">Focus</p>
            <p className="mt-1 truncate text-sm font-semibold text-[var(--fg-text)]">{liveFocusLabel}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-[16px] border border-[var(--fg-border)] bg-white px-2 py-2">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--fg-muted)]">Surface</p>
              <BinarySelector
                leftLabel="Popup"
                rightLabel="Docked"
                selected={settings.persistentPanelEnabled ? 'right' : 'left'}
                onSelect={(selection) => onTogglePersistentPanel(selection === 'right')}
              />
            </div>
            <div className="rounded-[16px] border border-[var(--fg-border)] bg-white px-2 py-2">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--fg-muted)]">Blocking</p>
              <BinarySelector
                leftLabel="Off"
                rightLabel="On"
                selected={settings.enableBlocking ? 'right' : 'left'}
                onSelect={(selection) => {
                  const shouldEnable = selection === 'right';
                  if (shouldEnable !== settings.enableBlocking) {
                    onToggleBlocking();
                  }
                }}
              />
            </div>
          </div>
        </div>
      </header>

      <div className="space-y-2 px-3 py-3">
        {panelOrder.map((sectionId) => {
          const section = sections[sectionId];
          return (
            <PanelSectionCard
              key={sectionId}
              badge={section.badge}
              collapsed={panelCollapsed[sectionId]}
              dragActive={draggedSection === sectionId}
              dropTarget={dropTargetSection === sectionId}
              onDragEnd={onDragEnd}
              onDragOver={() => onDragOverSection(sectionId)}
              onDragStart={() => onSectionDragStart(sectionId)}
              onDrop={() => onDropSection(sectionId)}
              onToggle={() => onToggleSection(sectionId)}
              title={section.title}
            >
              {section.content}
            </PanelSectionCard>
          );
        })}

      </div>
    </div>
  );
}

function PopupSectionCard({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="fg-card px-3 py-3">
      <div className="flex items-center gap-2">
        <h2 className="truncate text-[15px] font-semibold text-[var(--fg-text)]">{title}</h2>
        {badge ? (
          <span className="rounded-full border border-[var(--fg-border)] bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--fg-muted)]">
            {badge}
          </span>
        ) : null}
      </div>

      <div className="mt-3">{children}</div>
    </section>
  );
}

function PanelSectionCard({
  title,
  badge,
  collapsed,
  dragActive,
  dropTarget,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onToggle,
  children,
}: {
  title: string;
  badge?: string | null;
  collapsed: boolean;
  dragActive: boolean;
  dropTarget: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onToggle: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      className={`fg-card px-3 py-2.5 transition ${
        dragActive ? 'opacity-70' : ''
      } ${dropTarget ? 'ring-2 ring-[rgba(37,99,235,0.22)]' : ''}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-label={`Reorder ${title}`}
            className="flex h-7 w-7 cursor-grab items-center justify-center rounded-full border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--fg-muted)]"
          >
            ::
          </button>
          <h2 className="truncate text-[15px] font-semibold text-[var(--fg-text)]">{title}</h2>
          {badge ? (
            <span className="rounded-full border border-[var(--fg-border)] bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--fg-muted)]">
              {badge}
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onToggle}
          className="rounded-full border border-[var(--fg-border)] bg-white px-2.5 py-1 text-[11px] font-medium text-[var(--fg-muted)]"
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>

      {!collapsed ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

function PanelFocusSection({
  actionableTasks,
  activeLaunchTarget,
  activeLaunchTargetHost,
  liveFocusLabel,
  onMarkTaskDone,
  onOpenActiveLaunchTarget,
  snoozeState,
}: {
  actionableTasks: StateResponse['taskQueue'];
  activeLaunchTarget: StateResponse['calendarState']['activeLaunchTarget'];
  activeLaunchTargetHost: string | null;
  liveFocusLabel: string;
  onMarkTaskDone: () => void;
  onOpenActiveLaunchTarget: () => void;
  snoozeState: StateResponse['snoozeState'];
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <CompactSettingRow
        label="Current block"
        value={liveFocusLabel}
        className="px-0"
      />

      {activeLaunchTarget ? (
        <CompactSettingRow
          label="Task page"
          value={activeLaunchTargetHost ?? activeLaunchTarget.launchUrl}
          control={
            <button onClick={onOpenActiveLaunchTarget} className="fg-button-secondary px-3 py-2 text-xs">
              Open
            </button>
          }
          className="px-0"
        />
      ) : null}

      {snoozeState.active && snoozeState.expiresAt ? (
        <div className="rounded-[16px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Break active until {formatCountdown(snoozeState.expiresAt)}.
        </div>
      ) : null}

      <div className="border-t border-[var(--fg-border)] pt-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--fg-muted)]">Tasks</p>
            <p className="mt-1 text-sm font-semibold text-[var(--fg-text)]">
              {actionableTasks.length > 0 ? `${actionableTasks.length} ready` : 'No active tasks'}
            </p>
          </div>
          {actionableTasks.length > 0 ? (
            <button onClick={onMarkTaskDone} className="fg-button-primary px-3 py-2 text-xs">
              Mark Done
            </button>
          ) : null}
        </div>
        {actionableTasks.length > 0 ? (
          <TaskQueue tasks={actionableTasks} />
        ) : (
          <p className="text-[11px] leading-4 text-[var(--fg-muted)]">
            Tasks will appear here when a mapped block is active or carried over.
          </p>
        )}
      </div>
    </div>
  );
}

function PanelAssistantSection({
  assistantOptions,
  backendSession,
  backendSyncState,
  currentJob,
  ideaError,
  ideaInput,
  inboxIdeas,
  onCancelJob,
  onDiscardIdea,
  onIdeaInputChange,
  onIdeaSubmit,
  onKeepIdea,
  onModelSelect,
  onRefreshAssistant,
  onReuseSession,
  onRetryIdea,
  onStartSession,
  onToggleAutoCreate,
  onToggleReuse,
  onToggleTelemetry,
  openClawState,
  selectedModel,
  settingsOpen,
  submittingIdea,
  telemetryEnabled,
  toggleSettingsOpen,
}: {
  assistantOptions: StateResponse['assistantOptions'];
  backendSession: StateResponse['backendSession'];
  backendSyncState: StateResponse['backendSyncState'];
  currentJob: StateResponse['openClawState']['currentJob'];
  ideaError: string | null;
  ideaInput: string;
  inboxIdeas: IdeaRecord[];
  onCancelJob: (jobId: string) => void;
  onDiscardIdea: (localId: string) => void;
  onIdeaInputChange: (value: string) => void;
  onIdeaSubmit: () => void;
  onKeepIdea: (localId: string) => void;
  onModelSelect: (value: string) => void;
  onRefreshAssistant: () => void;
  onReuseSession: (sessionId: string) => void;
  onRetryIdea: (localId: string) => void;
  onStartSession: () => void;
  onToggleAutoCreate: (checked: boolean) => void;
  onToggleReuse: (checked: boolean) => void;
  onToggleTelemetry: (checked: boolean) => void;
  openClawState: StateResponse['openClawState'];
  selectedModel: string;
  settingsOpen: boolean;
  submittingIdea: boolean;
  telemetryEnabled: boolean;
  toggleSettingsOpen: () => void;
}): React.JSX.Element {
  const [ideaInboxOpen, setIdeaInboxOpen] = useState(false);
  const reusableSession = openClawState.sessions.find((session) => session.status !== 'closed');
  const statusLine = openClawState.status.connected
    ? backendSession
      ? `Connected as ${backendSession.userId}`
      : 'Connected'
    : formatAssistantStatusMessage(backendSyncState.lastError ?? openClawState.status.message);
  const hasMigrationIssue = backendSyncState.lastError?.toLowerCase()?.includes('migration') ?? false;
  const hasQueuedIdeas = inboxIdeas.length > 0;
  const currentJobLabel = currentJob ? `${currentJob.status} job` : null;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-[var(--fg-border)] bg-white px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--fg-muted)]">
            {openClawState.status.connected ? 'Live' : 'Offline'}
          </span>
          {hasMigrationIssue ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-amber-800">
              Needs migration
            </span>
          ) : null}
          {currentJobLabel ? (
            <span className="rounded-full border border-[rgba(37,99,235,0.12)] bg-[rgba(37,99,235,0.08)] px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--fg-accent)]">
              {currentJobLabel}
            </span>
          ) : null}
          <p className="truncate text-[12px] text-[var(--fg-muted)]">{statusLine}</p>
        </div>

        <div className="flex flex-wrap gap-1">
          <button onClick={onRefreshAssistant} className="fg-button-ghost px-2.5 py-1.5 text-[11px]">Refresh</button>
          <button onClick={onStartSession} className="fg-button-ghost px-2.5 py-1.5 text-[11px]">New</button>
          {reusableSession ? (
            <button onClick={() => onReuseSession(reusableSession.id)} className="fg-button-ghost px-2.5 py-1.5 text-[11px]">
              Reuse
            </button>
          ) : null}
          {currentJob ? (
            <button onClick={() => onCancelJob(currentJob.id)} className="fg-button-ghost px-2.5 py-1.5 text-[11px]">
              Cancel
            </button>
          ) : null}
        </div>
      </div>

      <div className="rounded-[18px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--fg-muted)]">Capture idea</p>
            {currentJob ? (
              <p className="mt-1 truncate text-[11px] text-[var(--fg-muted)]">
                {currentJob.status} · {currentJob.title}
              </p>
            ) : null}
          </div>
          <button
            onClick={onIdeaSubmit}
            disabled={submittingIdea}
            className="fg-button-primary shrink-0 px-3.5 py-2 text-xs"
          >
            {submittingIdea ? 'Sending…' : 'Capture'}
          </button>
        </div>

        <textarea
          rows={3}
          value={ideaInput}
          onChange={(event) => onIdeaInputChange(event.target.value)}
          placeholder="Capture the idea or question you want the assistant to work on."
          className="fg-input mt-2 min-h-[84px] resize-none px-3 py-2.5 text-sm"
        />
        {ideaError ? <p className="mt-2 text-xs text-rose-600">{ideaError}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-1 border-t border-[var(--fg-border)] pt-2">
        <button onClick={toggleSettingsOpen} className="fg-button-ghost px-2.5 py-1.5 text-[11px]">
          {settingsOpen ? 'Hide settings' : 'Show settings'}
        </button>
        {hasQueuedIdeas ? (
          <button onClick={() => setIdeaInboxOpen((current) => !current)} className="fg-button-ghost px-2.5 py-1.5 text-[11px]">
            {ideaInboxOpen ? 'Hide inbox' : `Inbox (${inboxIdeas.length})`}
          </button>
        ) : null}
        {currentJob ? (
          <span className="text-[11px] text-[var(--fg-muted)]">
            Active job: <span className="font-medium text-[var(--fg-text)]">{currentJob.status}</span>
          </span>
        ) : null}
      </div>

      {settingsOpen ? (
        <div className="rounded-[16px] border border-[var(--fg-border)] bg-white/80 px-3 py-1.5">
          <CompactSettingRow
            label="Model"
            control={
              <select
                value={selectedModel}
                onChange={(event) => onModelSelect(event.target.value)}
                className="fg-select w-[168px] px-3 py-2 text-sm"
              >
                {MODEL_PLACEHOLDER_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            }
            className="px-0"
          />
          <CompactSettingRow
            label="Reuse session"
            control={
              <div className="w-[154px]">
                <BinarySelector
                  leftLabel="No"
                  rightLabel="Yes"
                  selected={assistantOptions.reuseActiveSession ? 'right' : 'left'}
                  onSelect={(selection) => onToggleReuse(selection === 'right')}
                />
              </div>
            }
            className="px-0"
          />
          <CompactSettingRow
            label="Auto-create"
            control={
              <div className="w-[154px]">
                <BinarySelector
                  leftLabel="No"
                  rightLabel="Yes"
                  selected={assistantOptions.autoCreateSession ? 'right' : 'left'}
                  onSelect={(selection) => onToggleAutoCreate(selection === 'right')}
                />
              </div>
            }
            className="px-0"
          />
          <CompactSettingRow
            label="Break telemetry"
            control={
              <div className="w-[154px]">
                <BinarySelector
                  leftLabel="Off"
                  rightLabel="On"
                  selected={telemetryEnabled ? 'right' : 'left'}
                  onSelect={(selection) => onToggleTelemetry(selection === 'right')}
                />
              </div>
            }
            className="px-0"
          />
        </div>
      ) : null}

      {hasQueuedIdeas && ideaInboxOpen ? (
        <div className="rounded-[16px] border border-[var(--fg-border)] bg-white/80 px-3 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--fg-muted)]">
              Idea inbox
            </p>
            <span className="text-[11px] text-[var(--fg-muted)]">{inboxIdeas.length} queued</span>
          </div>
          <IdeaInbox
            ideas={inboxIdeas}
            onKeep={onKeepIdea}
            onDiscard={onDiscardIdea}
            onRetry={onRetryIdea}
          />
        </div>
      ) : null}
    </div>
  );
}

function PanelControlsSection({
  breakDurationMinutes,
  onOpenSettings,
  onStartBreak,
  onUpdateBreakDuration,
}: {
  breakDurationMinutes: number;
  onOpenSettings: () => void;
  onStartBreak: () => void;
  onUpdateBreakDuration: (next: 5 | 10 | 15) => void;
}): React.JSX.Element {
  return (
    <div className="space-y-0">
      <CompactSettingRow
        label="Break length"
        control={
          <select
            value={breakDurationMinutes}
            onChange={(event) => onUpdateBreakDuration(Number(event.target.value) as 5 | 10 | 15)}
            className="fg-select w-[112px] px-3 py-2 text-sm"
          >
            <option value={5}>5 min</option>
            <option value={10}>10 min</option>
            <option value={15}>15 min</option>
          </select>
        }
        className="px-0"
      />
      <CompactSettingRow
        label="Actions"
        footer={
          <div className="flex flex-wrap gap-2">
            <button onClick={onOpenSettings} className="fg-button-secondary px-3 py-2 text-xs">
              Settings
            </button>
            <button onClick={onStartBreak} className="fg-button-secondary px-3 py-2 text-xs">
              Start break
            </button>
          </div>
        }
        className="px-0"
      />
    </div>
  );
}

function PanelAnalyticsSection({
  analyticsSnapshot,
  onRefreshAnalytics,
}: {
  analyticsSnapshot: StateResponse['analyticsSnapshot'];
  onRefreshAnalytics: () => void;
}): React.JSX.Element {
  const summary = analyticsSnapshot.summary7d;
  const segments = [
    { label: 'Prod', value: summary.productiveMinutes, color: '#2563eb' },
    { label: 'Help', value: summary.supportiveMinutes, color: '#0f766e' },
    { label: 'Distract', value: summary.distractedMinutes, color: '#dc2626' },
    { label: 'Away', value: summary.awayMinutes, color: '#64748b' },
  ].filter((segment) => segment.value > 0);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--fg-text)]">Last 7 days</p>
        <button onClick={onRefreshAnalytics} className="fg-button-ghost px-3 py-1.5 text-[11px]">
          Refresh
        </button>
      </div>

      <div className="rounded-[18px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-3">
        <p className="text-[11px] leading-4 text-[var(--fg-muted)]">
          {formatMinutes(summary.productiveMinutes)} productive across {summary.totalFocusSessions} sessions
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
          {total > 0 ? (
            <div className="flex h-full w-full">
              {segments.map((segment) => (
                <div
                  key={segment.label}
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

        <div className="mt-3 grid grid-cols-4 gap-2">
          {segments.map((segment) => (
            <MetricChip key={segment.label} label={segment.label} value={formatMinutes(segment.value)} />
          ))}
        </div>
      </div>
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

function formatCountdown(expiresAt: string): string {
  const totalSeconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
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

function sanitizePanelOrder(input: PanelSectionId[] | undefined): PanelSectionId[] {
  const seen = new Set<PanelSectionId>();
  const ordered = (input ?? []).filter((sectionId): sectionId is PanelSectionId => {
    if (!DEFAULT_PANEL_ORDER.includes(sectionId)) return false;
    if (seen.has(sectionId)) return false;
    seen.add(sectionId);
    return true;
  });

  for (const sectionId of DEFAULT_PANEL_ORDER) {
    if (!seen.has(sectionId)) {
      ordered.push(sectionId);
    }
  }

  return ordered;
}

function formatAssistantStatusMessage(message: string | null | undefined): string {
  if (!message) return 'Assistant unavailable right now.';
  const lower = message.toLowerCase();
  if (lower.includes('signal is aborted') || lower.includes('aborted')) {
    return 'Connection unavailable right now.';
  }
  if (lower.includes('migration')) {
    return 'Backend schema needs the latest migration.';
  }
  if (
    lower.includes('invalid datetime') ||
    lower.includes('invalid_string') ||
    lower.includes('focussessions') ||
    lower.includes('"path"')
  ) {
    return 'Backend returned invalid session data.';
  }
  if (lower.includes('offline')) {
    return 'OpenClaw offline.';
  }
  if ((message.startsWith('[') || message.startsWith('{')) && message.length > 120) {
    return 'Backend returned an unexpected validation error.';
  }
  return message;
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

function safeHostname(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}
