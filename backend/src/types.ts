export type IdeaStatus =
  | 'queued'
  | 'syncing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'kept'
  | 'discarded';

export type OpenClawSessionStatus = 'active' | 'idle' | 'closed';
export type OpenClawJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface IdeaReportPayload {
  summary: string;
  viability: 'low' | 'moderate' | 'high' | 'unknown';
  competitionSnapshot: string;
  buildEffort: string;
  revenuePotential: string;
  risks: string[];
  nextSteps: string[];
  sourceLinks: string[];
  completedAt: string;
}

export interface RemoteIdeaRecordPayload {
  id: string;
  clientLocalId: string;
  prompt: string;
  status: IdeaStatus;
  createdAt: string;
  updatedAt: string;
  saved: boolean;
  archived: boolean;
  error: string | null;
  sessionId: string | null;
  jobId: string | null;
  report: IdeaReportPayload | null;
}

export interface OpenClawSessionPayload {
  id: string;
  title: string;
  status: OpenClawSessionStatus;
  modelLabel: string | null;
  startedAt: string;
  lastActivityAt: string;
}

export interface OpenClawJobPayload {
  id: string;
  ideaId: string | null;
  title: string;
  status: OpenClawJobStatus;
  startedAt: string | null;
  updatedAt: string;
}

export interface OpenClawStatusPayload {
  status: {
    connected: boolean;
    healthy: boolean;
    transport: 'ssh' | 'http' | 'unknown';
    label: string | null;
    message: string | null;
    lastCheckedAt: string | null;
  };
  currentJob: OpenClawJobPayload | null;
}

export interface OpenClawCreateSessionInput {
  title: string;
  preferredModel?: string;
}

export interface OpenClawIdeaJobInput {
  prompt: string;
  preferredModel?: string;
  notes?: string;
  sessionId?: string | null;
}

export interface OpenClawJobResult {
  status: OpenClawJobStatus;
  report: IdeaReportPayload | null;
  error: string | null;
}
