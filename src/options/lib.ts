import { deriveDifficultyRank } from '../shared/analytics';
import { isRedundantExactRuleCopy } from '../shared/ruleResolution';
import { findTaskTag, inferTaskTagKeyFromTitle, inferTaskTagKeysFromText } from '../shared/tags';
import type {
  AnalyticsSnapshot,
  CalendarEvent,
  DifficultyRank,
  EventRule,
  FocusSessionRecord,
  KeywordRule,
  QuizPackSummary,
  Settings,
  TaskTag,
} from '../shared/types';

export type TooltipMode = 'anchored' | 'modal';
export type TooltipPlacement = 'top' | 'bottom';

export interface ResolvedWorkspaceEvent {
  event: CalendarEvent;
  source: 'event' | 'keyword' | 'none' | 'override';
  ruleName: string | null;
  domains: string[];
  effectiveDomains: string[];
  tagKey: string | null;
  secondaryTagKeys: string[];
  difficultyRank: DifficultyRank | null;
  fallbackKeyword: string | null;
}

export interface ExtendedTaskListPreview {
  title: string;
  subtitle?: string;
  rows: Array<{ id: string; label: string; url?: string }>;
}

export interface ExtendedTaskSetDraftItem {
  id: string;
  label: string;
  url: string;
}

/** Wide enough for two-column event editor (tags + allowlist | task set + launch). */
export const TOOLTIP_WIDTH = 720;
export const TOOLTIP_HEIGHT = 720;
export const TOOLTIP_MARGIN = 20;
export const DEFAULT_TIME_GRID_START_MINUTES = 7 * 60;
export const DEFAULT_TIME_GRID_END_MINUTES = 21 * 60;
export const MIN_TIME_GRID_SPAN_MINUTES = 8 * 60;
export const TIME_GRID_ROUNDING_MINUTES = 30;
export const TIME_GRID_TOP_PADDING_MINUTES = 45;
export const TIME_GRID_BOTTOM_PADDING_MINUTES = 60;

export function chooseTooltipPosition(anchorRect: DOMRect): {
  mode: TooltipMode;
  placement: TooltipPlacement;
} {
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const spaceAbove = anchorRect.top;
  const canAnchorHorizontally = window.innerWidth >= TOOLTIP_WIDTH + TOOLTIP_MARGIN * 2;
  const canAnchorVertically = spaceBelow >= TOOLTIP_HEIGHT + 16 || spaceAbove >= TOOLTIP_HEIGHT + 16;

  if (!canAnchorHorizontally || !canAnchorVertically || window.innerWidth < 760) {
    return { mode: 'modal', placement: 'bottom' };
  }

  return {
    mode: 'anchored',
    placement: spaceBelow >= TOOLTIP_HEIGHT + 16 ? 'bottom' : 'top',
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function areRectsEqual(a: DOMRect, b: DOMRect): boolean {
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

export function splitDomains(value: string): string[] {
  return value
    .split(',')
    .map((domain) => domain.trim())
    .filter(Boolean);
}

export function splitCommaList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function safeHostname(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

export function getSelectableTaskTags(taskTags: TaskTag[], selectedKeys: string[] = []): TaskTag[] {
  const selected = new Set(selectedKeys.filter(Boolean));
  return taskTags.filter((tag) => tag.archivedAt === null || selected.has(tag.key));
}

export function resolveWorkspaceEvent(
  event: CalendarEvent,
  eventRules: EventRule[],
  keywordRules: KeywordRule[],
  taskTags: TaskTag[],
  recentSessions: FocusSessionRecord[],
  settings: Settings | null,
): ResolvedWorkspaceEvent {
  const exactRule = eventRules.find((rule) => rule.eventTitle === event.title);
  const keywordRule = settings?.keywordAutoMatchEnabled
    ? findBestKeywordRule(event.title, keywordRules)
    : null;
  const treatExactRuleAsFallback =
    exactRule !== undefined &&
    exactRule.domains.length > 0 &&
    keywordRule !== null &&
    isRedundantExactRuleCopy(exactRule, keywordRule);
  const titleMatches = inferTaskTagKeysFromText(event.title, taskTags);
  const descriptionMatches = inferTaskTagKeysFromText(event.description ?? '', taskTags, {
    excludeKeys: titleMatches,
  });
  const attendeeMatches = inferTaskTagKeysFromText(event.attendees.join(' '), taskTags, {
    excludeKeys: [...titleMatches, ...descriptionMatches],
  });
  const inferredTagKey =
    exactRule?.tagKey ??
    keywordRule?.tagKey ??
    titleMatches[0] ??
    descriptionMatches[0] ??
    attendeeMatches[0] ??
    inferTaskTagKeyFromTitle(event.title, taskTags);
  const secondaryTagKeys = exactRule
    ? exactRule.secondaryTagKeys
    : [...new Set([...titleMatches, ...descriptionMatches, ...attendeeMatches])]
        .filter((key) => key !== inferredTagKey)
        .slice(0, 2);
  const tag = findTaskTag(taskTags, inferredTagKey);
  const difficultyRank = inferredTagKey
    ? deriveDifficultyRank({
        baselineDifficulty: tag?.baselineDifficulty ?? null,
        scheduledStart: event.start,
        scheduledEnd: event.end,
        priorSessions: recentSessions.filter((session) => session.tagKey === inferredTagKey),
        override: exactRule?.difficultyOverride ?? null,
      })
    : exactRule?.difficultyOverride ?? null;

  if (exactRule && !treatExactRuleAsFallback) {
    return {
      event,
      source: exactRule.domains.length > 0 ? 'event' : 'override',
      ruleName: exactRule.eventTitle,
      domains: exactRule.domains,
      effectiveDomains: exactRule.domains,
      tagKey: inferredTagKey,
      secondaryTagKeys,
      difficultyRank,
      fallbackKeyword: keywordRule?.keyword ?? null,
    };
  }

  if (keywordRule) {
    return {
      event,
      source: 'keyword',
      ruleName: keywordRule.keyword,
      domains: [],
      effectiveDomains: keywordRule.domains,
      tagKey: inferredTagKey,
      secondaryTagKeys,
      difficultyRank,
      fallbackKeyword: null,
    };
  }

  return {
    event,
    source: 'none',
    ruleName: null,
    domains: [],
    effectiveDomains: [],
    tagKey: inferredTagKey,
    secondaryTagKeys,
    difficultyRank,
    fallbackKeyword: null,
  };
}

export function findBestKeywordRule(eventTitle: string, rules: KeywordRule[]): KeywordRule | null {
  const lower = eventTitle.toLowerCase();
  const matches = rules.filter(
    (rule) => rule.domains.length > 0 && lower.includes(rule.keyword.toLowerCase()),
  );
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => {
    const diff = b.keyword.length - a.keyword.length;
    if (diff !== 0) return diff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  })[0];
}

export function statusDot(source: 'event' | 'keyword' | 'none' | 'override'): string {
  if (source === 'event') return 'bg-emerald-500';
  if (source === 'keyword') return 'bg-amber-500';
  if (source === 'override') return 'bg-sky-500';
  return 'bg-slate-400';
}

export function calendarEventAppearance(event: CalendarEvent): {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
} {
  return {
    backgroundColor: event.backgroundColor ?? '#64748b',
    borderColor: event.backgroundColor ?? '#64748b',
    textColor: event.foregroundColor ?? '#ffffff',
  };
}

export function deriveTimeGridWindow(events: CalendarEvent[]): {
  slotMinTime: string;
  slotMaxTime: string;
  scrollTime: string;
} {
  const timedEvents = events.filter((event) => !event.isAllDay);

  if (timedEvents.length === 0) {
    return {
      slotMinTime: minutesToTimeString(DEFAULT_TIME_GRID_START_MINUTES),
      slotMaxTime: minutesToTimeString(DEFAULT_TIME_GRID_END_MINUTES),
      scrollTime: minutesToTimeString(DEFAULT_TIME_GRID_START_MINUTES),
    };
  }

  let earliestStart = Number.POSITIVE_INFINITY;
  let latestEnd = Number.NEGATIVE_INFINITY;

  for (const event of timedEvents) {
    const startDate = new Date(event.start);
    const endDate = new Date(event.end);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      continue;
    }

    const startMinutes = minutesIntoDay(startDate);
    const spansMultipleDays =
      startDate.getFullYear() !== endDate.getFullYear() ||
      startDate.getMonth() !== endDate.getMonth() ||
      startDate.getDate() !== endDate.getDate();
    const endMinutes = spansMultipleDays ? 24 * 60 : minutesIntoDay(endDate);
    const safeEndMinutes = Math.max(startMinutes + TIME_GRID_ROUNDING_MINUTES, endMinutes);

    earliestStart = Math.min(earliestStart, startMinutes);
    latestEnd = Math.max(latestEnd, safeEndMinutes);
  }

  if (!Number.isFinite(earliestStart) || !Number.isFinite(latestEnd)) {
    return {
      slotMinTime: minutesToTimeString(DEFAULT_TIME_GRID_START_MINUTES),
      slotMaxTime: minutesToTimeString(DEFAULT_TIME_GRID_END_MINUTES),
      scrollTime: minutesToTimeString(DEFAULT_TIME_GRID_START_MINUTES),
    };
  }

  let minMinutes = roundMinutes(
    earliestStart - TIME_GRID_TOP_PADDING_MINUTES,
    TIME_GRID_ROUNDING_MINUTES,
    'down',
  );
  let maxMinutes = roundMinutes(
    latestEnd + TIME_GRID_BOTTOM_PADDING_MINUTES,
    TIME_GRID_ROUNDING_MINUTES,
    'up',
  );

  if (maxMinutes - minMinutes < MIN_TIME_GRID_SPAN_MINUTES) {
    const deficit = MIN_TIME_GRID_SPAN_MINUTES - (maxMinutes - minMinutes);
    minMinutes -= Math.floor(deficit / 2);
    maxMinutes += Math.ceil(deficit / 2);
  }

  minMinutes = Math.max(0, minMinutes);
  maxMinutes = Math.min(24 * 60, maxMinutes);

  if (maxMinutes - minMinutes < TIME_GRID_ROUNDING_MINUTES) {
    maxMinutes = Math.min(24 * 60, minMinutes + MIN_TIME_GRID_SPAN_MINUTES);
  }

  const scrollMinutes = Math.max(
    minMinutes,
    roundMinutes(earliestStart - TIME_GRID_ROUNDING_MINUTES, TIME_GRID_ROUNDING_MINUTES, 'down'),
  );

  return {
    slotMinTime: minutesToTimeString(minMinutes),
    slotMaxTime: minutesToTimeString(maxMinutes),
    scrollTime: minutesToTimeString(scrollMinutes),
  };
}

export function minutesIntoDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function roundMinutes(
  value: number,
  increment: number,
  direction: 'down' | 'up',
): number {
  if (direction === 'down') {
    return Math.floor(value / increment) * increment;
  }

  return Math.ceil(value / increment) * increment;
}

export function minutesToTimeString(totalMinutes: number): string {
  const clampedMinutes = Math.max(0, Math.min(24 * 60, totalMinutes));
  const hours = Math.floor(clampedMinutes / 60);
  const minutes = clampedMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
}

export function formatTooltipDate(event: CalendarEvent): string {
  const startDate = new Date(event.start);
  const endDate = new Date(event.end);

  if (event.isAllDay) {
    const lastDay = new Date(endDate.getTime() - 86_400_000);
    const startLabel = startDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    const endLabel = lastDay.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    return startLabel === endLabel ? `${startLabel} · All day` : `${startLabel} – ${endLabel} · All day`;
  }

  return `${startDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · ${startDate.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })} – ${endDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function formatEventRange(event: CalendarEvent): string {
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

export function formatSessionRange(session: FocusSessionRecord): string {
  return `${new Date(session.scheduledStart).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })} · ${new Date(session.scheduledStart).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })} – ${new Date(session.scheduledEnd).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

export function chartX(
  index: number,
  count: number,
  width: number,
  paddingX: number,
): number {
  if (count <= 1) return width / 2;
  const usableWidth = width - paddingX * 2;
  return paddingX + (usableWidth / (count - 1)) * index;
}

export function chartY(
  value: number,
  max: number,
  height: number,
  paddingY: number,
): number {
  const usableHeight = height - paddingY * 2;
  if (max <= 0) return height - paddingY;
  return height - paddingY - (value / max) * usableHeight;
}

export function buildLinePath<T>(
  points: T[],
  getValue: (point: T) => number,
  max: number,
  width: number,
  height: number,
  paddingX: number,
  paddingY: number,
): string {
  return points
    .map((point, index) => {
      const x = chartX(index, points.length, width, paddingX);
      const y = chartY(getValue(point), max, height, paddingY);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
}

export function tagBreakdownWidth(
  productiveMinutes: number,
  items: AnalyticsSnapshot['tagBreakdown7d'],
): number {
  const max = Math.max(0, ...items.map((item) => item.productiveMinutes));
  return max > 0 ? (productiveMinutes / max) * 100 : 0;
}

export function humanizeActivityClass(value: 'aligned' | 'supportive' | 'distracted' | 'away' | 'break'): string {
  if (value === 'aligned') return 'Mostly productive';
  if (value === 'supportive') return 'Mostly supportive';
  if (value === 'distracted') return 'Mostly distracted';
  if (value === 'away') return 'Mostly away';
  return 'Mostly on break';
}

export function activityBarClass(value: 'aligned' | 'supportive' | 'distracted' | 'away' | 'break'): string {
  if (value === 'aligned') return 'bg-blue-600';
  if (value === 'supportive') return 'bg-emerald-600';
  if (value === 'distracted') return 'bg-rose-500';
  if (value === 'away') return 'bg-slate-400';
  return 'bg-amber-500';
}

export function dominantTreeActivityClass(
  node: AnalyticsSnapshot['consumptionTree7d'][number],
): 'aligned' | 'supportive' | 'distracted' | 'away' | 'break' {
  const entries: Array<['aligned' | 'supportive' | 'distracted' | 'away' | 'break', number]> = [
    ['aligned', node.productiveMinutes],
    ['supportive', node.supportiveMinutes],
    ['distracted', node.distractedMinutes],
    ['away', node.awayMinutes],
    ['break', node.breakMinutes],
  ];
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

export function formatMinutes(value: number): string {
  if (value <= 0) return '0m';
  if (value >= 60) {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${value}m`;
}

export function parseDifficultyRank(value: string): DifficultyRank | null {
  const next = Number(value);
  if (next === 1 || next === 2 || next === 3 || next === 5 || next === 8) {
    return next;
  }

  return null;
}

export function humanizeLearningTopicKey(topicKey: string): string {
  return topicKey
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatLearningTimestamp(value: string): string {
  const date = new Date(value);
  const deltaMs = Date.now() - date.getTime();
  if (Number.isNaN(date.getTime())) {
    return 'Updated recently';
  }

  const minutes = Math.max(0, Math.round(deltaMs / 60_000));
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;

  const days = Math.round(hours / 24);
  return `Updated ${days}d ago`;
}

export function formatLearningDueLabel(value: string): string {
  const date = new Date(value);
  const deltaMs = date.getTime() - Date.now();
  if (Number.isNaN(date.getTime())) {
    return 'Due soon';
  }

  if (deltaMs <= 0) {
    const overdueMinutes = Math.round(Math.abs(deltaMs) / 60_000);
    if (overdueMinutes < 60) return overdueMinutes === 0 ? 'Due now' : `${overdueMinutes}m overdue`;
    const overdueHours = Math.round(overdueMinutes / 60);
    return `${overdueHours}h overdue`;
  }

  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `Due in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Due in ${hours}h`;
  const days = Math.round(hours / 24);
  return `Due in ${days}d`;
}

export function formatLearningPackStatus(status: QuizPackSummary['status']): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'processing':
      return 'Processing';
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Needs retry';
    default:
      return status;
  }
}

export function safeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `extended-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyExtendedTaskSetDraftItem(): ExtendedTaskSetDraftItem {
  return {
    id: safeId(),
    label: '',
    url: '',
  };
}

export function moveDraftArrayItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (toIndex < 0 || toIndex >= items.length || fromIndex === toIndex) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function uniqueElements<T extends HTMLElement>(elements: Array<T | null | undefined>): T[] {
  return [...new Set(elements.filter((element): element is T => element instanceof HTMLElement))];
}

export function setExtendedTaskDropTargetState(elements: HTMLElement[], active: boolean): void {
  for (const element of elements) {
    if (active) {
      element.dataset.windowDropTarget = 'true';
      continue;
    }

    delete element.dataset.windowDropTarget;
  }
}

export function clearExtendedTaskDropTargets(): void {
  document
    .querySelectorAll<HTMLElement>('[data-window-drop-target="true"]')
    .forEach((element) => delete element.dataset.windowDropTarget);
}

export function sendMessageAsync<T = unknown>(message: { type: string; payload?: unknown }): Promise<T> {
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
