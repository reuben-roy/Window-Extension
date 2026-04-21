import {
  DEFAULT_ACCOUNT_SYNC_STATE,
  DEFAULT_ALL_TIME_STATS,
  DEFAULT_GLOBAL_ALLOWLIST,
  DEFAULT_TASK_TAGS,
} from './constants';
import {
  getAllTimeStats,
  getEventBindings,
  getEventRules,
  getGlobalAllowlist,
  getKeywordRules,
  getPointsHistory,
  getProfiles,
  getTaskTags,
} from './storage';
import { ensureDefaultTaskTags, ensureRuleMetadata } from './tags';
import type {
  AccountSnapshot,
  AccountSyncState,
  EventBindings,
  EventRule,
  KeywordRule,
  PointsHistory,
  Profiles,
  TaskTag,
} from './types';

export const ACCOUNT_SYNCED_STORAGE_KEYS = [
  'allTimeStats',
  'pointsHistory',
  'profiles',
  'eventBindings',
  'eventRules',
  'keywordRules',
  'taskTags',
  'globalAllowlist',
] as const;

export function createEmptyAccountSnapshot(): AccountSnapshot {
  return {
    allTimeStats: { ...DEFAULT_ALL_TIME_STATS },
    pointsHistory: {},
    profiles: {},
    eventBindings: {},
    eventRules: [],
    keywordRules: [],
    taskTags: [...DEFAULT_TASK_TAGS],
    globalAllowlist: [...DEFAULT_GLOBAL_ALLOWLIST],
  };
}

export function createDefaultAccountSyncState(): AccountSyncState {
  return { ...DEFAULT_ACCOUNT_SYNC_STATE };
}

export async function buildAccountSnapshotFromStorage(): Promise<AccountSnapshot> {
  const [
    allTimeStats,
    pointsHistory,
    profiles,
    eventBindings,
    eventRules,
    keywordRules,
    taskTags,
    globalAllowlist,
  ] = await Promise.all([
    getAllTimeStats(),
    getPointsHistory(),
    getProfiles(),
    getEventBindings(),
    getEventRules(),
    getKeywordRules(),
    getTaskTags(),
    getGlobalAllowlist(),
  ]);

  return normalizeAccountSnapshot({
    allTimeStats,
    pointsHistory,
    profiles,
    eventBindings,
    eventRules,
    keywordRules,
    taskTags,
    globalAllowlist,
  });
}

export async function applyAccountSnapshotToStorage(
  snapshot: AccountSnapshot,
): Promise<void> {
  const normalized = normalizeAccountSnapshot(snapshot);
  await new Promise<void>((resolve, reject) => {
    chrome.storage.sync.set(
      {
        allTimeStats: normalized.allTimeStats,
        pointsHistory: normalized.pointsHistory,
        profiles: normalized.profiles,
        eventBindings: normalized.eventBindings,
        eventRules: normalized.eventRules,
        keywordRules: normalized.keywordRules,
        taskTags: normalized.taskTags,
        globalAllowlist: normalized.globalAllowlist,
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      },
    );
  });
}

export function normalizeAccountSnapshot(
  snapshot: Partial<AccountSnapshot> | null | undefined,
): AccountSnapshot {
  const empty = createEmptyAccountSnapshot();
  const migrated = ensureRuleMetadata(
    snapshot?.eventRules ?? empty.eventRules,
    snapshot?.keywordRules ?? empty.keywordRules,
    snapshot?.taskTags ?? empty.taskTags,
  );

  return {
    allTimeStats: {
      ...empty.allTimeStats,
      ...(snapshot?.allTimeStats ?? {}),
    },
    pointsHistory: normalizePointsHistory(snapshot?.pointsHistory ?? empty.pointsHistory),
    profiles: normalizeProfiles(snapshot?.profiles ?? empty.profiles),
    eventBindings: normalizeStringRecord(snapshot?.eventBindings ?? empty.eventBindings),
    eventRules: normalizeEventRules(migrated.eventRules),
    keywordRules: normalizeKeywordRules(migrated.keywordRules),
    taskTags: normalizeTaskTags(migrated.taskTags),
    globalAllowlist: normalizeStringArray(snapshot?.globalAllowlist ?? empty.globalAllowlist),
  };
}

export function accountSnapshotHasUserData(snapshot: AccountSnapshot): boolean {
  const normalized = normalizeAccountSnapshot(snapshot);
  const empty = normalizeAccountSnapshot(createEmptyAccountSnapshot());

  return (
    JSON.stringify(normalized.allTimeStats) !== JSON.stringify(empty.allTimeStats) ||
    Object.keys(normalized.pointsHistory).length > 0 ||
    Object.keys(normalized.profiles).length > 0 ||
    Object.keys(normalized.eventBindings).length > 0 ||
    normalized.eventRules.length > 0 ||
    normalized.keywordRules.length > 0 ||
    JSON.stringify(normalized.taskTags) !== JSON.stringify(empty.taskTags) ||
    JSON.stringify(normalized.globalAllowlist) !== JSON.stringify(empty.globalAllowlist)
  );
}

export function areAccountSnapshotsEqual(
  left: AccountSnapshot,
  right: AccountSnapshot,
): boolean {
  return serializeAccountSnapshot(left) === serializeAccountSnapshot(right);
}

export function isAccountSyncedStorageKey(key: string): boolean {
  return ACCOUNT_SYNCED_STORAGE_KEYS.includes(
    key as (typeof ACCOUNT_SYNCED_STORAGE_KEYS)[number],
  );
}

function serializeAccountSnapshot(snapshot: AccountSnapshot): string {
  const normalized = normalizeAccountSnapshot(snapshot);
  return JSON.stringify({
    ...normalized,
    pointsHistory: sortObject(normalized.pointsHistory),
    profiles: sortNestedStringArrays(normalized.profiles),
    eventBindings: sortObject(normalized.eventBindings),
    eventRules: [...normalized.eventRules].sort((a, b) => a.eventTitle.localeCompare(b.eventTitle)),
    keywordRules: [...normalized.keywordRules].sort((a, b) => a.keyword.localeCompare(b.keyword)),
    taskTags: [...normalized.taskTags].sort((a, b) => a.key.localeCompare(b.key)),
    globalAllowlist: [...normalized.globalAllowlist].sort(),
  });
}

function normalizePointsHistory(history: PointsHistory): PointsHistory {
  return Object.entries(history).reduce<PointsHistory>((acc, [key, value]) => {
    acc[key] = {
      earned: value?.earned ?? 0,
      tasksCompleted: value?.tasksCompleted ?? 0,
      tasksDismissed: value?.tasksDismissed ?? 0,
      tasksExpired: value?.tasksExpired ?? 0,
      snoozesUsed: value?.snoozesUsed ?? 0,
      perfectDays: value?.perfectDays ?? 0,
      longestStreak: value?.longestStreak ?? 0,
    };
    return acc;
  }, {});
}

function normalizeProfiles(profiles: Profiles): Profiles {
  return Object.entries(profiles).reduce<Profiles>((acc, [key, value]) => {
    acc[key] = normalizeStringArray(value);
    return acc;
  }, {});
}

function normalizeEventRules(rules: EventRule[]): EventRule[] {
  return rules
    .filter((rule) => Boolean(rule?.eventTitle))
    .map((rule) => ({
      eventTitle: rule.eventTitle,
      domains: normalizeStringArray(rule.domains),
      tagKey: typeof rule.tagKey === 'string' && rule.tagKey.trim().length > 0 ? rule.tagKey : null,
      secondaryTagKeys: normalizeStringArray(rule.secondaryTagKeys ?? []),
      difficultyOverride: rule.difficultyOverride ?? null,
    }));
}

function normalizeKeywordRules(rules: KeywordRule[]): KeywordRule[] {
  return rules
    .filter((rule) => Boolean(rule?.keyword))
    .map((rule) => ({
      keyword: rule.keyword,
      domains: normalizeStringArray(rule.domains),
      createdAt: rule.createdAt,
      tagKey: typeof rule.tagKey === 'string' && rule.tagKey.trim().length > 0 ? rule.tagKey : null,
    }));
}

function normalizeTaskTags(tags: TaskTag[]): TaskTag[] {
  return ensureDefaultTaskTags(tags);
}

function normalizeStringArray(values: string[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string'))].sort();
}

function normalizeStringRecord(values: EventBindings): EventBindings {
  return Object.entries(values).reduce<EventBindings>((acc, [key, value]) => {
    if (typeof value === 'string') {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function sortObject<T extends Record<string, unknown>>(value: T): T {
  return Object.keys(value)
    .sort()
    .reduce<T>((acc, key) => {
      acc[key as keyof T] = value[key as keyof T];
      return acc;
    }, {} as T);
}

function sortNestedStringArrays(value: Record<string, string[]>): Record<string, string[]> {
  return Object.keys(value)
    .sort()
    .reduce<Record<string, string[]>>((acc, key) => {
      acc[key] = [...value[key]].sort();
      return acc;
    }, {});
}
