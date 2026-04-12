import type {
  BreakVisitEvent,
  IdeaDecision,
  IdeaRecord,
  IdeaState,
  OpenClawState,
} from './types';

export function createIdeaRecord(prompt: string): IdeaRecord {
  const now = new Date().toISOString();
  return {
    localId: safeId(),
    remoteId: null,
    prompt: prompt.trim(),
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    unread: false,
    saved: false,
    archived: false,
    error: null,
    sessionId: null,
    jobId: null,
    report: null,
  };
}

export function deriveIdeaState(
  items: IdeaRecord[],
  openClawState: OpenClawState,
): IdeaState {
  const outboxDepth = items.filter((item) => item.remoteId === null || item.status === 'queued' || item.status === 'syncing').length;
  const unreadCount = items.filter((item) => item.unread).length;
  const lastError =
    items.find((item) => item.error)?.error ??
    openClawState.lastError ??
    openClawState.status.message ??
    null;

  return {
    items: [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    outboxDepth,
    unreadCount,
    lastError,
    lastSyncedAt: openClawState.status.lastCheckedAt,
  };
}

export function mergeIdeaRecord(
  existing: IdeaRecord | undefined,
  incoming: Partial<IdeaRecord> & Pick<IdeaRecord, 'localId' | 'prompt'>,
): IdeaRecord {
  const base = existing ?? createIdeaRecord(incoming.prompt);
  return {
    ...base,
    ...incoming,
    updatedAt: incoming.updatedAt ?? new Date().toISOString(),
  };
}

export function applyIdeaDecision(record: IdeaRecord, decision: IdeaDecision): IdeaRecord {
  const now = new Date().toISOString();
  return {
    ...record,
    unread: false,
    updatedAt: now,
    status: decision === 'keep' ? 'kept' : 'discarded',
    saved: decision === 'keep',
    archived: decision === 'discard',
  };
}

export function parseDomainFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return parsed.hostname || null;
  } catch {
    return null;
  }
}

export function upsertBreakVisit(
  visits: Record<string, BreakVisitEvent>,
  tabId: number,
  domain: string,
  activeEventTitle: string | null,
  at: string,
): { nextVisits: Record<string, BreakVisitEvent>; finalizedVisit: BreakVisitEvent | null } {
  const key = String(tabId);
  const current = visits[key];

  if (current && current.domain === domain) {
    return {
      nextVisits: {
        ...visits,
        [key]: {
          ...current,
          endedAt: at,
        },
      },
      finalizedVisit: null,
    };
  }

  const nextVisit: BreakVisitEvent = {
    id: safeId(),
    tabId,
    domain,
    startedAt: at,
    endedAt: at,
    activeEventTitle,
  };

  const nextVisits = {
    ...visits,
    [key]: nextVisit,
  };

  return {
    nextVisits,
    finalizedVisit: current ?? null,
  };
}

export function finalizeBreakVisits(
  visits: Record<string, BreakVisitEvent>,
  at: string,
): BreakVisitEvent[] {
  return Object.values(visits).map((visit) => ({
    ...visit,
    endedAt: at,
  }));
}

function safeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
