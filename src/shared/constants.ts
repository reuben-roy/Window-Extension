import type {
  AllTimeStats,
  AssistantOptions,
  BackendSyncState,
  OpenClawState,
  Settings,
  SnoozeState,
} from './types';

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: Settings = {
  enableBlocking: true,
  blockPage: 'custom',
  carryoverMode: 'union',
  taskTTLDays: 7,
  monthlyResetEnabled: true,
  lastMonthlyReset: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
  minBlockDurationMinutes: 15,
  breakDurationMinutes: 5,
  keywordAutoMatchEnabled: false,
  breakTelemetryEnabled: false,
  persistentPanelEnabled: false,
  dailyBlockingPauseEnabled: false,
  dailyBlockingPauseStartTime: '22:00',
};

export const DEFAULT_GLOBAL_ALLOWLIST: string[] = ['accounts.google.com'];

export const DEFAULT_SNOOZE_STATE: SnoozeState = {
  active: false,
  expiresAt: null,
  taskId: null,
  snoozesUsed: 0,
  maxSnoozes: 2,
  cooldownSeconds: 0,
  durationMinutes: 5,
};

export const DEFAULT_ALL_TIME_STATS: AllTimeStats = {
  totalPoints: 0,
  level: 1,
  title: 'Novice',
  prestigeCount: 0,
  tasksCompleted: 0,
  bestWeek: 0,
  currentWeekStreak: 0,
};

export const DEFAULT_ASSISTANT_OPTIONS: AssistantOptions = {
  preferredModel: {
    value: 'Minimax-2.7',
    updatedAt: null,
  },
  autoCreateSession: true,
  reuseActiveSession: true,
  notes: '',
};

export const DEFAULT_BACKEND_SYNC_STATE: BackendSyncState = {
  configured: false,
  connected: false,
  syncing: false,
  lastSyncedAt: null,
  lastError: null,
};

export const DEFAULT_OPENCLAW_STATE: OpenClawState = {
  status: {
    connected: false,
    healthy: false,
    transport: 'unknown',
    label: null,
    message: 'OpenClaw is not connected yet.',
    lastCheckedAt: null,
  },
  sessions: [],
  activeSessionId: null,
  currentJob: null,
  lastError: null,
};

// ─── Points ───────────────────────────────────────────────────────────────────

export const BASE_POINTS_PER_30_MIN = 10;

// Duration multipliers: [minimum minutes, multiplier]. Evaluated in order (first match wins).
export const DURATION_MULTIPLIERS: ReadonlyArray<readonly [number, number]> = [
  [180, 2.5],
  [120, 2.0],
  [60,  1.5],
  [0,   1.0],
] as const;

// carryoverBonus = basePoints × (1 + daysInCarryover × CARRYOVER_BONUS_PER_DAY)
export const CARRYOVER_BONUS_PER_DAY = 0.25;

// regularityMultiplier = max(FLOOR, 1.0 - consecutiveCompletions × DECAY)
export const REGULARITY_DECAY_PER_STREAK = 0.1;
export const REGULARITY_DECAY_FLOOR = 0.5;

// Bonus modifiers (additive to multiplier)
export const NO_SNOOZE_BONUS = 0.2;       // +20% — completed without any snooze
export const EARLY_COMPLETION_BONUS = 0.1; // +10% — marked done before scheduled end
export const PERFECT_DAY_BONUS = 0.25;    // +25% — on last task of a perfect day
export const MONDAY_BONUS = 0.15;          // +15% — completed carryover task on Monday

// ─── Anti-gaming ─────────────────────────────────────────────────────────────

export const MIN_BLOCK_DURATION_MINUTES = 15;
export const MAX_BLOCK_DURATION_MINUTES = 30; // upper bound for the setting
export const TASK_COMPLETION_MIN_ELAPSED_FRACTION = 0.5; // 50% of block must have elapsed
export const MAX_DISMISSALS_PER_DAY = 2;

// ─── Snooze ───────────────────────────────────────────────────────────────────

export const SNOOZE_DURATION_MINUTES = 5;
export const DEFAULT_MAX_SNOOZES_PER_TASK = 2;
export const LEVEL_5_MAX_SNOOZES_PER_TASK = 3;
export const BREAK_DURATION_OPTIONS = [5, 10, 15] as const;

// Cooldown before snooze activates, indexed by snooze number (0-based)
export const SNOOZE_COOLDOWNS_SECONDS: ReadonlyArray<number> = [0, 30, 60] as const;

// ─── Carryover ────────────────────────────────────────────────────────────────

export const MIN_TASK_TTL_DAYS = 1;
export const MAX_TASK_TTL_DAYS = 14;
export const DEFAULT_TASK_TTL_DAYS = 7;

// ─── Leveling ─────────────────────────────────────────────────────────────────

// xpRequired = floor(100 × level^1.8)
export function xpRequiredForLevel(level: number): number {
  return Math.floor(100 * Math.pow(level, 1.8));
}

// Title unlocked at or above each key level
const LEVEL_TITLE_THRESHOLDS: ReadonlyArray<readonly [number, string]> = [
  [25, 'Ascendant'],
  [20, 'Grandmaster'],
  [15, 'Warden'],
  [10, 'Sentinel'],
  [5,  'Disciplined'],
  [3,  'Focused'],
  [2,  'Apprentice'],
  [1,  'Novice'],
] as const;

export function getLevelTitle(level: number): string {
  for (const [threshold, title] of LEVEL_TITLE_THRESHOLDS) {
    if (level >= threshold) return title;
  }
  return 'Novice';
}

// Features unlocked at specific levels
export const LEVEL_PERKS: ReadonlyArray<readonly [number, string]> = [
  [3,  'Custom blocked page themes'],
  [5,  'Extra snooze per task (3 total)'],
  [8,  'Detailed analytics dashboard'],
  [10, 'Challenge blocks (no snoozes, 3× points)'],
  [15, 'Leaderboard participation'],
  [20, 'Custom point rules and multipliers'],
] as const;

// ─── Alarms ───────────────────────────────────────────────────────────────────

export const ALARM_TICK = 'tick';
export const ALARM_SNOOZE_END = 'snooze-end';
export const ALARM_TICK_PERIOD_MINUTES = 1;
export const DEFAULT_WINDOW_BACKEND_URL = 'http://localhost:8787';

// ─── Blocking rules ───────────────────────────────────────────────────────────

// Rule IDs: 1 = block-all, 2+ = per-domain allow rules
export const BLOCK_ALL_RULE_ID = 1;
export const ALLOW_RULE_ID_START = 2;
export const TEMP_UNLOCK_RULE_ID_START = 10_000;
export const TEMP_UNLOCK_DURATION_MINUTES = 5;
export const TEMP_UNLOCK_BASE_COST = 25;
export const TEMP_UNLOCK_INCREMENT = 25;

// Path to the blocked page within the extension (used by declarativeNetRequest redirect)
export const BLOCKED_PAGE_EXTENSION_PATH = '/src/blocked/index.html';
export const SIDE_PANEL_EXTENSION_PATH = '/src/sidepanel/index.html';

export const MODEL_PLACEHOLDER_OPTIONS = [
  'Minimax-2.7',
  'Deepseek-v3.2',
  'Kimi-k2.5',
  'Minimax-2.5',
  'Nemotron',
] as const;
