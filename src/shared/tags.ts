import { DEFAULT_TASK_TAGS } from './constants';
import type {
  DifficultyRank,
  EventPatternStat,
  EventRule,
  KeywordRule,
  TaskTag,
} from './types';

const AUTO_TAG_OCCURRENCE_THRESHOLD = 3;
const TAG_CORRECTION_THRESHOLD = 2;

export function slugifyTagKey(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'untagged';
}

export function humanizeTagKey(key: string): string {
  return key
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function normalizeEventPattern(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findTaskTag(tags: TaskTag[], key: string | null | undefined): TaskTag | null {
  if (!key) return null;
  return tags.find((tag) => tag.key === key) ?? null;
}

export function inferTaskTagKeyFromTitle(title: string, tags: TaskTag[]): string | null {
  const pattern = normalizeEventPattern(title);
  if (!pattern) return null;

  for (const tag of tags) {
    if (normalizeEventPattern(tag.label) === pattern) {
      return tag.key;
    }

    if (
      tag.aliases.some((alias) => {
        const normalizedAlias = normalizeEventPattern(alias);
        return normalizedAlias.length > 0 && pattern.includes(normalizedAlias);
      })
    ) {
      return tag.key;
    }
  }

  return null;
}

export function normalizeTaskTag(tag: TaskTag): TaskTag {
  return {
    ...tag,
    key: slugifyTagKey(tag.key || tag.label),
    label: tag.label.trim() || humanizeTagKey(tag.key),
    color: tag.color || '#64748b',
    aliases: normalizeStringArray(tag.aliases),
    alignedDomains: normalizeStringArray(tag.alignedDomains),
    supportiveDomains: normalizeStringArray(tag.supportiveDomains),
    baselineDifficulty: normalizeDifficultyRank(tag.baselineDifficulty),
    source: tag.source,
    updatedAt: tag.updatedAt || new Date().toISOString(),
  };
}

export function ensureDefaultTaskTags(tags: TaskTag[]): TaskTag[] {
  const merged = new Map<string, TaskTag>();

  for (const tag of DEFAULT_TASK_TAGS) {
    merged.set(tag.key, normalizeTaskTag(tag));
  }

  for (const tag of tags) {
    const normalized = normalizeTaskTag(tag);
    const existing = merged.get(normalized.key);
    if (!existing) {
      merged.set(normalized.key, normalized);
      continue;
    }

    merged.set(normalized.key, {
      ...existing,
      ...normalized,
      aliases: normalizeStringArray([...existing.aliases, ...normalized.aliases]),
      alignedDomains: normalizeStringArray([...existing.alignedDomains, ...normalized.alignedDomains]),
      supportiveDomains: normalizeStringArray([...existing.supportiveDomains, ...normalized.supportiveDomains]),
    });
  }

  return [...merged.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function ensureRuleMetadata(
  eventRules: EventRule[],
  keywordRules: KeywordRule[],
  taskTags: TaskTag[],
): {
  eventRules: EventRule[];
  keywordRules: KeywordRule[];
  taskTags: TaskTag[];
  changed: boolean;
} {
  let changed = false;
  let nextTags = ensureDefaultTaskTags(taskTags);

  const nextEventRules = eventRules.map((rule) => {
    const normalized: EventRule = {
      eventTitle: rule.eventTitle.trim(),
      domains: normalizeStringArray(rule.domains),
      tagKey: rule.tagKey ?? null,
      difficultyOverride:
        rule.difficultyOverride === undefined ? null : normalizeDifficultyRank(rule.difficultyOverride),
    };

    if (
      normalized.tagKey !== rule.tagKey ||
      normalized.difficultyOverride !== (rule.difficultyOverride ?? null) ||
      normalized.domains.length !== rule.domains.length
    ) {
      changed = true;
    }

    return normalized;
  });

  const nextKeywordRules = keywordRules.map((rule) => {
    const inferredTagKey = rule.tagKey ?? slugifyTagKey(rule.keyword);
    const normalized: KeywordRule = {
      keyword: rule.keyword.trim().toLowerCase(),
      domains: normalizeStringArray(rule.domains),
      createdAt: rule.createdAt,
      tagKey: inferredTagKey,
    };

    if (rule.tagKey !== inferredTagKey || normalized.keyword !== rule.keyword) {
      changed = true;
    }

    if (!findTaskTag(nextTags, inferredTagKey)) {
      nextTags = ensureDefaultTaskTags([
        ...nextTags,
        {
          key: inferredTagKey,
          label: humanizeTagKey(inferredTagKey),
          color: '#475569',
          aliases: [normalized.keyword],
          baselineDifficulty: inferBaselineDifficulty(normalized.keyword),
          alignedDomains: normalized.domains,
          supportiveDomains: [],
          source: 'keyword',
          updatedAt: new Date().toISOString(),
        },
      ]);
      changed = true;
    }

    return normalized;
  });

  return {
    eventRules: nextEventRules,
    keywordRules: nextKeywordRules,
    taskTags: nextTags,
    changed,
  };
}

export function observeEventPatterns(
  eventTitles: string[],
  stats: EventPatternStat[],
  taskTags: TaskTag[],
): {
  stats: EventPatternStat[];
  taskTags: TaskTag[];
  changed: boolean;
} {
  const nextStatsByPattern = new Map(
    stats.map((stat) => [stat.pattern, { ...stat }] satisfies [string, EventPatternStat]),
  );
  let nextTags = [...taskTags];
  let changed = false;
  const now = new Date().toISOString();

  for (const title of eventTitles) {
    const pattern = normalizeEventPattern(title);
    if (!pattern) continue;

    const current = nextStatsByPattern.get(pattern) ?? {
      pattern,
      label: humanizeTagKey(slugifyTagKey(pattern)),
      occurrences: 0,
      correctionCount: 0,
      correctedTagKey: null,
      autoTagKey: null,
      lastSeenAt: now,
    };

    current.occurrences += 1;
    current.lastSeenAt = now;

    const inferredExistingTagKey =
      current.correctedTagKey ??
      current.autoTagKey ??
      inferTaskTagKeyFromTitle(title, nextTags);

    if (!current.autoTagKey && !inferredExistingTagKey && current.occurrences >= AUTO_TAG_OCCURRENCE_THRESHOLD) {
      const key = slugifyTagKey(pattern);
      current.autoTagKey = key;
      nextTags = ensureDefaultTaskTags([
        ...nextTags,
        {
          key,
          label: humanizeTagKey(key),
          color: '#6d28d9',
          aliases: [pattern],
          baselineDifficulty: 3,
          alignedDomains: [],
          supportiveDomains: [],
          source: 'auto',
          updatedAt: now,
        },
      ]);
      changed = true;
    }

    nextStatsByPattern.set(pattern, current);
  }

  return {
    stats: [...nextStatsByPattern.values()].sort((a, b) => a.pattern.localeCompare(b.pattern)),
    taskTags: nextTags,
    changed,
  };
}

export function applyTagCorrection(
  title: string,
  tagKey: string | null,
  stats: EventPatternStat[],
  taskTags: TaskTag[],
): {
  stats: EventPatternStat[];
  taskTags: TaskTag[];
  changed: boolean;
} {
  const pattern = normalizeEventPattern(title);
  if (!pattern || !tagKey) {
    return { stats, taskTags, changed: false };
  }

  const nextStats = [...stats];
  const statIndex = nextStats.findIndex((stat) => stat.pattern === pattern);
  const current =
    statIndex >= 0
      ? { ...nextStats[statIndex] }
      : {
          pattern,
          label: humanizeTagKey(slugifyTagKey(pattern)),
          occurrences: 0,
          correctionCount: 0,
          correctedTagKey: null,
          autoTagKey: null,
          lastSeenAt: new Date().toISOString(),
        };

  current.correctionCount += 1;
  current.correctedTagKey = tagKey;
  current.lastSeenAt = new Date().toISOString();

  if (statIndex >= 0) {
    nextStats[statIndex] = current;
  } else {
    nextStats.push(current);
  }

  let nextTags = [...taskTags];
  let changed = true;
  if (current.correctionCount >= TAG_CORRECTION_THRESHOLD) {
    nextTags = nextTags.map((tag) =>
      tag.key === tagKey
        ? {
            ...tag,
            aliases: normalizeStringArray([...tag.aliases, pattern]),
            updatedAt: new Date().toISOString(),
          }
        : tag,
    );
  }

  return {
    stats: nextStats.sort((a, b) => a.pattern.localeCompare(b.pattern)),
    taskTags: ensureDefaultTaskTags(nextTags),
    changed,
  };
}

export function normalizeDifficultyRank(value: number | null | undefined): DifficultyRank {
  if (value === 1 || value === 2 || value === 3 || value === 5 || value === 8) {
    return value;
  }

  return 3;
}

export function inferBaselineDifficulty(value: string): DifficultyRank {
  const pattern = normalizeEventPattern(value);
  if (/deep|system|architecture|interview|coding|design/.test(pattern)) return 5;
  if (/research|study|learning|write|writing/.test(pattern)) return 3;
  if (/admin|email|meeting|sync|call/.test(pattern)) return 2;
  return 3;
}

function normalizeStringArray(values: string[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))]
    .map((value) => value.trim().toLowerCase())
    .sort();
}
