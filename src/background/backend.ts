import { DEFAULT_OPENCLAW_STATE, DEFAULT_WINDOW_BACKEND_URL } from '../shared/constants';
import {
  applyIdeaDecision,
  createIdeaRecord,
  deriveIdeaState,
  finalizeBreakVisits,
  mergeIdeaRecord,
} from '../shared/assistant';
import {
  getActiveBreakVisits,
  getAssistantOptions,
  getBackendSession,
  getBackendSyncState,
  getBreakVisitQueue,
  getCalendarState,
  getIdeaRecords,
  getOpenClawState,
  setActiveBreakVisits,
  setAssistantOptions,
  setBackendSession,
  setBackendSyncState,
  setBreakVisitQueue,
  setIdeaRecords,
  setOpenClawState,
} from '../shared/storage';
import type {
  AssistantOptions,
  BackendSession,
  IdeaDecision,
  IdeaRecord,
  IdeaReport,
  IdeaState,
  OpenClawConnectionStatus,
  OpenClawJobSummary,
  OpenClawSessionSummary,
  OpenClawState,
} from '../shared/types';
import { getAuthToken } from './calendar';

const BACKEND_REQUEST_TIMEOUT_MS = 15_000;
const BACKEND_BASE_URL =
  (import.meta.env.VITE_WINDOW_BACKEND_URL as string | undefined)?.trim() ||
  DEFAULT_WINDOW_BACKEND_URL;
const NOTIFICATION_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WHa3WgAAAAASUVORK5CYII=';

interface AuthExchangeResponse {
  sessionToken: string;
  userId: string;
  expiresAt: string;
}

interface RemoteIdeaRecord {
  id: string;
  clientLocalId: string;
  prompt: string;
  status: IdeaRecord['status'];
  createdAt: string;
  updatedAt: string;
  saved: boolean;
  archived: boolean;
  error: string | null;
  sessionId: string | null;
  jobId: string | null;
  report: IdeaReport | null;
}

interface OpenClawStatusResponse {
  status: OpenClawConnectionStatus;
  currentJob: OpenClawJobSummary | null;
}

interface OpenClawSessionsResponse {
  sessions: OpenClawSessionSummary[];
  activeSessionId: string | null;
}

interface RemoteStateSnapshot {
  items: IdeaRecord[];
  ideaState: IdeaState;
  openClawState: OpenClawState;
}

export async function syncBackendAuthWithGoogleToken(): Promise<BackendSession | null> {
  if (!isBackendConfigured()) {
    await setBackendSyncState({
      configured: false,
      connected: false,
      syncing: false,
      lastSyncedAt: null,
      lastError: 'Backend URL is not configured.',
    });
    return null;
  }

  try {
    const googleAccessToken = await getAuthToken(false);
    const response = await backendRequest<AuthExchangeResponse>('/v1/auth/google/exchange', {
      method: 'POST',
      auth: 'none',
      body: {
        googleAccessToken,
        extensionVersion: chrome.runtime.getManifest().version,
      },
    });

    const session: BackendSession = {
      sessionToken: response.sessionToken,
      userId: response.userId,
      expiresAt: response.expiresAt,
      connectedAt: new Date().toISOString(),
    };

    await setBackendSession(session);
    await setBackendSyncState({
      configured: true,
      connected: true,
      syncing: false,
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
    });

    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setBackendSession(null);
    await setBackendSyncState({
      configured: true,
      connected: false,
      syncing: false,
      lastSyncedAt: null,
      lastError: message,
    });
    return null;
  }
}

export async function clearAssistantState(): Promise<void> {
  await Promise.all([
    setBackendSession(null),
    setOpenClawState(DEFAULT_OPENCLAW_STATE),
    setBackendSyncState({
      configured: isBackendConfigured(),
      connected: false,
      syncing: false,
      lastSyncedAt: null,
      lastError: null,
    }),
    setActiveBreakVisits({}),
  ]);
}

export async function refreshAssistantState(): Promise<RemoteStateSnapshot> {
  await syncIdeaOutbox();
  return buildAssistantSnapshot();
}

export async function submitIdea(prompt: string): Promise<RemoteStateSnapshot> {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    throw new Error('Idea capture cannot be empty.');
  }

  const items = await getIdeaRecords();
  const record = createIdeaRecord(normalizedPrompt);
  await setIdeaRecords([record, ...items]);
  return syncIdeaOutbox();
}

export async function decideIdea(
  localId: string,
  decision: IdeaDecision,
): Promise<RemoteStateSnapshot> {
  const items = await getIdeaRecords();
  const current = items.find((item) => item.localId === localId);
  if (!current) {
    throw new Error('Idea was not found.');
  }

  const optimistic = applyIdeaDecision(current, decision);
  await setIdeaRecords(items.map((item) => (item.localId === localId ? optimistic : item)));

  if (current.remoteId) {
    await backendRequest(`/v1/ideas/${current.remoteId}/decision`, {
      method: 'POST',
      body: { decision },
    });
  }

  return refreshAssistantState();
}

export async function retryIdea(localId: string): Promise<RemoteStateSnapshot> {
  const items = await getIdeaRecords();
  const current = items.find((item) => item.localId === localId);
  if (!current) {
    throw new Error('Idea was not found.');
  }

  const retried = mergeIdeaRecord(current, {
    localId: current.localId,
    prompt: current.prompt,
    status: 'queued',
    error: null,
    unread: false,
    archived: false,
    saved: false,
    report: null,
  });
  await setIdeaRecords(items.map((item) => (item.localId === localId ? retried : item)));

  if (current.remoteId) {
    await backendRequest(`/v1/ideas/${current.remoteId}/retry`, {
      method: 'POST',
    });
  }

  return syncIdeaOutbox();
}

export async function startOpenClawSession(title?: string): Promise<RemoteStateSnapshot> {
  await backendRequest('/v1/openclaw/sessions', {
    method: 'POST',
    body: {
      title: title?.trim() || 'Window assistant session',
    },
  });

  return refreshAssistantState();
}

export async function reuseOpenClawSession(sessionId: string): Promise<RemoteStateSnapshot> {
  await backendRequest('/v1/openclaw/sessions', {
    method: 'POST',
    body: { reuseSessionId: sessionId },
  });

  return refreshAssistantState();
}

export async function cancelOpenClawJob(jobId: string): Promise<RemoteStateSnapshot> {
  await backendRequest(`/v1/openclaw/jobs/${jobId}/cancel`, {
    method: 'POST',
  });

  return refreshAssistantState();
}

export async function updateAssistantPreference(
  patch: Partial<AssistantOptions>,
): Promise<AssistantOptions> {
  const current = await getAssistantOptions();
  const next: AssistantOptions = {
    ...current,
    ...patch,
    preferredModel: patch.preferredModel
      ? {
          ...patch.preferredModel,
          updatedAt: new Date().toISOString(),
        }
      : current.preferredModel,
  };

  await setAssistantOptions(next);
  return next;
}

export async function syncIdeaOutbox(): Promise<RemoteStateSnapshot> {
  const initialSyncState = await getBackendSyncState();
  await setBackendSyncState({
    ...initialSyncState,
    configured: isBackendConfigured(),
    syncing: true,
    lastError: null,
  });

  try {
    const session = await ensureBackendSession();
    if (!session) {
      return buildAssistantSnapshot();
    }

    const assistantOptions = await getAssistantOptions();
    let items = await getIdeaRecords();

    for (const item of items) {
      if (item.remoteId !== null) continue;

      const created = await backendRequest<RemoteIdeaRecord>('/v1/ideas', {
        method: 'POST',
        body: {
          clientLocalId: item.localId,
          prompt: item.prompt,
          preferredModel: assistantOptions.preferredModel.value,
          autoCreateSession: assistantOptions.autoCreateSession,
          reuseActiveSession: assistantOptions.reuseActiveSession,
          notes: assistantOptions.notes,
        },
      });

      items = items.map((candidate) =>
        candidate.localId === item.localId
          ? fromRemoteIdea(created, candidate)
          : candidate,
      );
      await setIdeaRecords(items);
    }

    const [remoteIdeas, statusResponse, sessionsResponse] = await Promise.all([
      backendRequest<RemoteIdeaRecord[]>('/v1/ideas'),
      backendRequest<OpenClawStatusResponse>('/v1/openclaw/status'),
      backendRequest<OpenClawSessionsResponse>('/v1/openclaw/sessions'),
    ]);

    const previousItems = items;
    items = reconcileIdeaRecords(items, remoteIdeas);
    const nextOpenClawState: OpenClawState = {
      status: statusResponse.status,
      sessions: sessionsResponse.sessions,
      activeSessionId: sessionsResponse.activeSessionId,
      currentJob: statusResponse.currentJob,
      lastError: null,
    };

    await Promise.all([
      setIdeaRecords(items),
      setOpenClawState(nextOpenClawState),
      setBackendSyncState({
        configured: true,
        connected: true,
        syncing: false,
        lastSyncedAt: new Date().toISOString(),
        lastError: null,
      }),
    ]);

    await maybeNotifyAboutCompletedIdeas(previousItems, items);

    return {
      items,
      ideaState: deriveIdeaState(items, nextOpenClawState),
      openClawState: nextOpenClawState,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const currentSyncState = await getBackendSyncState();
    const currentOpenClawState = await getOpenClawState();
    await Promise.all([
      setBackendSyncState({
        ...currentSyncState,
        configured: isBackendConfigured(),
        connected: false,
        syncing: false,
        lastError: message,
      }),
      setOpenClawState({
        ...currentOpenClawState,
        lastError: message,
        status: {
          ...currentOpenClawState.status,
          connected: false,
          healthy: false,
          message,
          lastCheckedAt: new Date().toISOString(),
        },
      }),
    ]);

    return buildAssistantSnapshot();
  }
}

export async function syncBreakTelemetryQueue(): Promise<void> {
  const queue = await getBreakVisitQueue();
  if (queue.length === 0) return;

  const session = await ensureBackendSession();
  if (!session) return;

  try {
    await backendRequest('/v1/break-visits/batch', {
      method: 'POST',
      body: { events: queue },
    });
    await setBreakVisitQueue([]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const currentSyncState = await getBackendSyncState();
    await setBackendSyncState({
      ...currentSyncState,
      lastError: message,
    });
  }
}

export async function finalizeBreakTelemetry(): Promise<void> {
  const [activeBreakVisits, queue] = await Promise.all([
    getActiveBreakVisits(),
    getBreakVisitQueue(),
  ]);
  const now = new Date().toISOString();
  const finalized = finalizeBreakVisits(activeBreakVisits, now);
  if (finalized.length === 0) return;

  await Promise.all([
    setActiveBreakVisits({}),
    setBreakVisitQueue([...queue, ...finalized]),
  ]);
}

async function buildAssistantSnapshot(): Promise<RemoteStateSnapshot> {
  const [items, openClawState] = await Promise.all([
    getIdeaRecords(),
    getOpenClawState(),
  ]);

  return {
    items,
    ideaState: deriveIdeaState(items, openClawState),
    openClawState,
  };
}

async function ensureBackendSession(): Promise<BackendSession | null> {
  const session = await getBackendSession();
  if (session && new Date(session.expiresAt).getTime() - Date.now() > 60_000) {
    return session;
  }

  return syncBackendAuthWithGoogleToken();
}

async function backendRequest<T>(
  path: string,
  init: {
    method?: 'GET' | 'POST';
    body?: unknown;
    auth?: 'required' | 'none';
  } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BACKEND_REQUEST_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if ((init.auth ?? 'required') === 'required') {
      const session = await getBackendSession();
      if (!session) {
        throw new Error('No backend session available.');
      }
      headers.Authorization = `Bearer ${session.sessionToken}`;
    }

    const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Backend request failed with ${response.status}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function reconcileIdeaRecords(
  localItems: IdeaRecord[],
  remoteIdeas: RemoteIdeaRecord[],
): IdeaRecord[] {
  const merged = [...localItems];

  for (const remote of remoteIdeas) {
    const existingIndex = merged.findIndex(
      (item) => item.remoteId === remote.id || item.localId === remote.clientLocalId,
    );

    const existing = existingIndex >= 0 ? merged[existingIndex] : undefined;
    const next = fromRemoteIdea(remote, existing);

    if (existingIndex >= 0) {
      merged[existingIndex] = next;
    } else {
      merged.push(next);
    }
  }

  return merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function fromRemoteIdea(remote: RemoteIdeaRecord, existing?: IdeaRecord): IdeaRecord {
  const completedNow = remote.status === 'completed' && remote.report !== null;
  return {
    localId: remote.clientLocalId || existing?.localId || createIdeaRecord(remote.prompt).localId,
    remoteId: remote.id,
    prompt: remote.prompt,
    status: remote.status,
    createdAt: remote.createdAt,
    updatedAt: remote.updatedAt,
    unread: completedNow ? existing?.unread ?? true : false,
    saved: remote.saved,
    archived: remote.archived,
    error: remote.error,
    sessionId: remote.sessionId,
    jobId: remote.jobId,
    report: remote.report,
  };
}

async function maybeNotifyAboutCompletedIdeas(
  previousItems: IdeaRecord[],
  nextItems: IdeaRecord[],
): Promise<void> {
  const calendarState = await getCalendarState();
  if (calendarState.isRestricted) return;

  const previousByLocalId = new Map(previousItems.map((item) => [item.localId, item]));
  const newUnread = nextItems.filter((item) => {
    if (!item.unread || item.report === null) return false;
    const previous = previousByLocalId.get(item.localId);
    return previous?.report === null || previous === undefined;
  });

  for (const item of newUnread) {
    chrome.notifications.create(item.localId, {
      type: 'basic',
      iconUrl: NOTIFICATION_ICON_DATA_URL,
      title: 'Window idea report ready',
      message: truncate(item.report?.summary ?? item.prompt, 140),
    });
  }
}

function isBackendConfigured(): boolean {
  return BACKEND_BASE_URL.length > 0;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}
