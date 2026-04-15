import {
  areAccountSnapshotsEqual,
  accountSnapshotHasUserData,
  applyAccountSnapshotToStorage,
  buildAccountSnapshotFromStorage,
  createDefaultAccountSyncState,
  isAccountSyncedStorageKey,
  normalizeAccountSnapshot,
} from '../shared/account';
import { DEFAULT_OPENCLAW_STATE, DEFAULT_WINDOW_BACKEND_URL } from '../shared/constants';
import {
  applyIdeaDecision,
  createIdeaRecord,
  deriveIdeaState,
  finalizeBreakVisits,
  mergeIdeaRecord,
} from '../shared/assistant';
import {
  getAccountConflict,
  getAccountSyncState,
  getAccountUser,
  getActiveBreakVisits,
  getAssistantOptions,
  getBackendSession,
  getBackendSyncState,
  getBreakVisitQueue,
  getCalendarState,
  getIdeaRecords,
  getOpenClawState,
  setAccountConflict,
  setAccountSyncState,
  setAccountUser,
  setActiveBreakVisits,
  setAssistantOptions,
  setBackendSession,
  setBackendSyncState,
  setBreakVisitQueue,
  setIdeaRecords,
  setOpenClawState,
} from '../shared/storage';
import type {
  AccountConflict,
  AccountSession,
  AccountSnapshot,
  AccountSyncState,
  AccountUser,
  AssistantOptions,
  AuthProvider,
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
const ACCOUNT_SYNC_DEBOUNCE_MS = 300;

interface AuthSessionResponse {
  sessionToken: string;
  userId: string;
  expiresAt: string;
  user: AccountUser;
}

interface AccountSnapshotResponse {
  revision: number;
  updatedAt: string | null;
  data: AccountSnapshot;
}

interface BackendErrorPayload {
  error?: string;
  snapshot?: AccountSnapshotResponse;
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

let accountSyncTimer: ReturnType<typeof setTimeout> | null = null;
let applyingRemoteSnapshot = false;

export async function restoreAccountSession(): Promise<void> {
  if (!isBackendConfigured()) {
    await setAccountSyncState({
      ...createDefaultAccountSyncState(),
      configured: false,
      lastError: 'Backend URL is not configured.',
    });
    return;
  }

  const [backendSession, accountUser] = await Promise.all([
    getBackendSession(),
    getAccountUser(),
  ]);

  if (!backendSession) {
    await setAccountSyncState({
      ...createDefaultAccountSyncState(),
      configured: true,
    });
    return;
  }

  try {
    if (new Date(backendSession.expiresAt).getTime() - Date.now() <= 60_000) {
      throw new Error('Your account session expired. Please sign in again.');
    }

    const response = await backendRequest<{ user: AccountUser }>('/v1/auth/me');
    await Promise.all([
      setAccountUser(response.user),
      setAccountSyncState({
        ...(await getAccountSyncState()),
        configured: true,
        connected: Boolean(accountUser ?? response.user),
        lastError: null,
      }),
    ]);
  } catch (error) {
    await invalidateAccountSession(error instanceof Error ? error.message : String(error));
  }
}

export async function refreshAccountState(): Promise<{
  user: AccountUser | null;
  session: AccountSession | null;
  syncState: AccountSyncState;
  conflict: AccountConflict | null;
}> {
  const session = await getBackendSession();
  if (!session) {
    const [user, syncState, conflict] = await Promise.all([
      getAccountUser(),
      getAccountSyncState(),
      getAccountConflict(),
    ]);
    return { user, session: null, syncState, conflict };
  }

  await restoreAccountSession();
  return {
    user: await getAccountUser(),
    session: await getBackendSession(),
    syncState: await getAccountSyncState(),
    conflict: await getAccountConflict(),
  };
}

export async function signInWithProvider(
  provider: Exclude<AuthProvider, 'password'>,
): Promise<AccountUser> {
  ensureBackendConfigured();
  if (provider !== 'google') {
    throw new Error('Only Google sign-in is enabled right now.');
  }

  const response = await exchangeGoogleTokenForBackend(true);
  await finalizeSignedInSession(response);
  return response.user;
}

export async function registerAccount(
  _email: string,
  _password: string,
): Promise<AccountUser> {
  throw new Error('Only Google sign-in is enabled right now.');
}

export async function loginAccount(
  _email: string,
  _password: string,
): Promise<AccountUser> {
  throw new Error('Only Google sign-in is enabled right now.');
}

export async function signOutAccount(): Promise<void> {
  const session = await getBackendSession();
  if (session) {
    try {
      await backendRequest('/v1/auth/logout', {
        method: 'POST',
      });
    } catch {
      // Best-effort sign-out; local cleanup still proceeds.
    }
  }

  await Promise.all([
    clearAssistantState(),
    setAccountUser(null),
    setAccountConflict(null),
    setAccountSyncState({
      ...createDefaultAccountSyncState(),
      configured: isBackendConfigured(),
    }),
  ]);
}

export async function resolveAccountConflict(
  choice: 'local' | 'remote',
): Promise<void> {
  const conflict = await getAccountConflict();
  if (!conflict) {
    return;
  }

  if (choice === 'remote') {
    await applyRemoteSnapshot(conflict.remote);
    await setAccountConflict(null);
    await setAccountSyncState({
      ...(await getAccountSyncState()),
      configured: isBackendConfigured(),
      connected: true,
      syncing: false,
      initialized: true,
      revision: conflict.remoteRevision,
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
    });
    return;
  }

  try {
    const response = await putAccountSnapshot(conflict.local, conflict.remoteRevision);
    await Promise.all([
      setAccountConflict(null),
      setAccountSyncState({
        ...(await getAccountSyncState()),
        configured: isBackendConfigured(),
        connected: true,
        syncing: false,
        initialized: true,
        revision: response.revision,
        lastSyncedAt: response.updatedAt ?? new Date().toISOString(),
        lastError: null,
      }),
    ]);
  } catch (error) {
    if (error instanceof AccountConflictError) {
      await setAccountConflict({
        local: conflict.local,
        remote: error.snapshot.data,
        remoteRevision: error.snapshot.revision,
        detectedAt: new Date().toISOString(),
      });
      return;
    }

    throw error;
  }
}

export function scheduleAccountSnapshotSync(): void {
  if (applyingRemoteSnapshot) return;

  if (accountSyncTimer) {
    clearTimeout(accountSyncTimer);
  }

  accountSyncTimer = setTimeout(() => {
    accountSyncTimer = null;
    void syncAccountSnapshot();
  }, ACCOUNT_SYNC_DEBOUNCE_MS);
}

export async function syncAccountSnapshot(): Promise<void> {
  if (!isBackendConfigured()) return;

  const session = await ensureBackendSession();
  if (!session) {
    await setAccountSyncState({
      ...(await getAccountSyncState()),
      configured: true,
      connected: false,
      syncing: false,
      lastError: 'Sign in to sync your account data.',
    });
    return;
  }

  const existingConflict = await getAccountConflict();
  if (existingConflict) return;

  const syncState = await getAccountSyncState();
  await setAccountSyncState({
    ...syncState,
    configured: true,
    connected: true,
    syncing: true,
    lastError: null,
  });

  try {
    const snapshot = await buildAccountSnapshotFromStorage();
    const response = await putAccountSnapshot(snapshot, syncState.revision);
    await setAccountSyncState({
      ...(await getAccountSyncState()),
      configured: true,
      connected: true,
      syncing: false,
      initialized: true,
      revision: response.revision,
      lastSyncedAt: response.updatedAt ?? new Date().toISOString(),
      lastError: null,
    });
  } catch (error) {
    if (error instanceof AccountConflictError) {
      const local = await buildAccountSnapshotFromStorage();
      await Promise.all([
        setAccountConflict({
          local,
          remote: error.snapshot.data,
          remoteRevision: error.snapshot.revision,
          detectedAt: new Date().toISOString(),
        }),
        setAccountSyncState({
          ...(await getAccountSyncState()),
          configured: true,
          connected: true,
          syncing: false,
          initialized: true,
          revision: error.snapshot.revision,
          lastError: 'Your local data and account data both changed. Choose which version to keep.',
        }),
      ]);
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await setAccountSyncState({
      ...(await getAccountSyncState()),
      configured: true,
      connected: true,
      syncing: false,
      lastError: message,
    });
  }
}

export async function handleSyncedStorageChanges(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
): Promise<void> {
  if (areaName !== 'sync' || applyingRemoteSnapshot) return;

  const changedSyncedKey = Object.keys(changes).some((key) => isAccountSyncedStorageKey(key));
  if (!changedSyncedKey) return;

  scheduleAccountSnapshotSync();
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
      await setBackendSyncState({
        ...initialSyncState,
        configured: isBackendConfigured(),
        connected: false,
        syncing: false,
        lastError: 'Sign in to sync assistant state.',
      });
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

async function exchangeGoogleTokenForBackend(
  interactive: boolean,
): Promise<AuthSessionResponse> {
  const googleAccessToken = await getAuthToken(interactive);
  return backendRequest<AuthSessionResponse>('/v1/auth/google/exchange', {
    method: 'POST',
    auth: 'none',
    body: {
      googleAccessToken,
    },
  });
}

async function finalizeSignedInSession(
  response: AuthSessionResponse,
): Promise<void> {
  const session: BackendSession = {
    sessionToken: response.sessionToken,
    userId: response.userId,
    expiresAt: response.expiresAt,
    connectedAt: new Date().toISOString(),
  };

  await Promise.all([
    setBackendSession(session),
    setAccountUser(response.user),
    setAccountConflict(null),
    setAccountSyncState({
      ...createDefaultAccountSyncState(),
      configured: true,
      connected: true,
    }),
    setBackendSyncState({
      configured: true,
      connected: true,
      syncing: false,
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
    }),
  ]);

  await initializeAccountSnapshotSync();
}

async function initializeAccountSnapshotSync(): Promise<void> {
  const [localSnapshot, remoteSnapshot] = await Promise.all([
    buildAccountSnapshotFromStorage(),
    getRemoteAccountSnapshot(),
  ]);
  const normalizedRemote = normalizeAccountSnapshot(remoteSnapshot.data);

  if (areAccountSnapshotsEqual(localSnapshot, normalizedRemote)) {
    await setAccountSyncState({
      ...(await getAccountSyncState()),
      configured: true,
      connected: true,
      syncing: false,
      initialized: true,
      revision: remoteSnapshot.revision,
      lastSyncedAt: remoteSnapshot.updatedAt ?? new Date().toISOString(),
      lastError: null,
    });
    return;
  }

  const localHasData = accountSnapshotHasUserData(localSnapshot);
  const remoteHasData = accountSnapshotHasUserData(normalizedRemote);

  if (!localHasData && remoteHasData) {
    await applyRemoteSnapshot(normalizedRemote);
    await setAccountSyncState({
      ...(await getAccountSyncState()),
      configured: true,
      connected: true,
      syncing: false,
      initialized: true,
      revision: remoteSnapshot.revision,
      lastSyncedAt: remoteSnapshot.updatedAt ?? new Date().toISOString(),
      lastError: null,
    });
    return;
  }

  if (localHasData && !remoteHasData) {
    const response = await putAccountSnapshot(localSnapshot, remoteSnapshot.revision);
    await setAccountSyncState({
      ...(await getAccountSyncState()),
      configured: true,
      connected: true,
      syncing: false,
      initialized: true,
      revision: response.revision,
      lastSyncedAt: response.updatedAt ?? new Date().toISOString(),
      lastError: null,
    });
    return;
  }

  await Promise.all([
    setAccountConflict({
      local: localSnapshot,
      remote: normalizedRemote,
      remoteRevision: remoteSnapshot.revision,
      detectedAt: new Date().toISOString(),
    }),
    setAccountSyncState({
      ...(await getAccountSyncState()),
      configured: true,
      connected: true,
      syncing: false,
      initialized: true,
      revision: remoteSnapshot.revision,
      lastError: 'Your local data and account data both exist. Choose which version to keep.',
    }),
  ]);
}

async function applyRemoteSnapshot(snapshot: AccountSnapshot): Promise<void> {
  applyingRemoteSnapshot = true;
  try {
    await applyAccountSnapshotToStorage(snapshot);
  } finally {
    applyingRemoteSnapshot = false;
  }
}

async function getRemoteAccountSnapshot(): Promise<AccountSnapshotResponse> {
  const response = await backendRequest<AccountSnapshotResponse>('/v1/account/snapshot');
  return {
    revision: response.revision,
    updatedAt: response.updatedAt,
    data: normalizeAccountSnapshot(response.data),
  };
}

async function putAccountSnapshot(
  snapshot: AccountSnapshot,
  revision: number,
): Promise<AccountSnapshotResponse> {
  const response = await backendRequestDetailed<AccountSnapshotResponse>('/v1/account/snapshot', {
    method: 'PUT',
    body: {
      revision,
      data: snapshot,
    },
  });

  if (!response.ok) {
    if (response.status === 409 && response.data?.snapshot) {
      throw new AccountConflictError(response.data.snapshot);
    }

    throw new Error(response.data?.error ?? `Backend request failed with ${response.status}`);
  }

  const payload = response.data as AccountSnapshotResponse;
  return {
    revision: payload.revision,
    updatedAt: payload.updatedAt,
    data: normalizeAccountSnapshot(payload.data),
  };
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

  if (!session) {
    return null;
  }

  try {
    const response = await exchangeGoogleTokenForBackend(false);
    await Promise.all([
      setBackendSession({
        sessionToken: response.sessionToken,
        userId: response.userId,
        expiresAt: response.expiresAt,
        connectedAt: new Date().toISOString(),
      }),
      setAccountUser(response.user),
    ]);
    return getBackendSession();
  } catch (error) {
    await invalidateAccountSession(
      error instanceof Error ? error.message : 'Please sign in again.',
    );
    return null;
  }
}

async function invalidateAccountSession(reason: string): Promise<void> {
  await Promise.all([
    setBackendSession(null),
    setAccountUser(null),
    setAccountConflict(null),
    setAccountSyncState({
      ...createDefaultAccountSyncState(),
      configured: isBackendConfigured(),
      lastError: reason,
    }),
    setBackendSyncState({
      configured: isBackendConfigured(),
      connected: false,
      syncing: false,
      lastSyncedAt: null,
      lastError: reason,
    }),
  ]);
}

async function backendRequest<T>(
  path: string,
  init: {
    method?: 'GET' | 'POST' | 'PUT';
    body?: unknown;
    auth?: 'required' | 'none';
  } = {},
): Promise<T> {
  const response = await backendRequestDetailed<T>(path, init);
  if (!response.ok) {
    throw new Error(response.data?.error ?? `Backend request failed with ${response.status}`);
  }

  return response.data as T;
}

async function backendRequestDetailed<T>(
  path: string,
  init: {
    method?: 'GET' | 'POST' | 'PUT';
    body?: unknown;
    auth?: 'required' | 'none';
  } = {},
): Promise<{
  ok: boolean;
  status: number;
  data: (T & BackendErrorPayload) | BackendErrorPayload | undefined;
}> {
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

    let data: (T & BackendErrorPayload) | BackendErrorPayload | undefined;
    if (response.status !== 204) {
      const text = await response.text();
      data = text ? (JSON.parse(text) as (T & BackendErrorPayload)) : undefined;
    }

    if (response.status === 401 && (init.auth ?? 'required') === 'required') {
      await invalidateAccountSession(
        (data as BackendErrorPayload | undefined)?.error ?? 'Your account session expired.',
      );
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
    };
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

function ensureBackendConfigured(): void {
  if (!isBackendConfigured()) {
    throw new Error('Backend URL is not configured.');
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

class AccountConflictError extends Error {
  constructor(readonly snapshot: AccountSnapshotResponse) {
    super('Account snapshot conflict.');
  }
}
