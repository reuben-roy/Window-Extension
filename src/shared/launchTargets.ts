import {
  getEventLaunchTargets,
  setEventLaunchTargets,
} from './storage';
import type {
  CalendarEvent,
  EventLaunchTarget,
} from './types';

const EVENT_LAUNCH_TARGET_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizeLaunchUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function getLaunchTargetHost(launchUrl: string): string | null {
  try {
    return new URL(launchUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function pruneExpiredEventLaunchTargets(
  targets: EventLaunchTarget[],
  now: number = Date.now(),
): EventLaunchTarget[] {
  const deduped = new Map<string, EventLaunchTarget>();

  for (const target of targets) {
    const normalizedUrl = normalizeLaunchUrl(target.launchUrl);
    if (normalizedUrl === null) continue;
    if (new Date(target.end).getTime() + EVENT_LAUNCH_TARGET_RETENTION_MS <= now) continue;

    const normalizedTarget: EventLaunchTarget = {
      ...target,
      launchUrl: normalizedUrl,
    };
    const previous = deduped.get(target.calendarEventId);
    if (
      previous === undefined ||
      new Date(normalizedTarget.updatedAt).getTime() >= new Date(previous.updatedAt).getTime()
    ) {
      deduped.set(target.calendarEventId, normalizedTarget);
    }
  }

  return [...deduped.values()].sort(
    (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime(),
  );
}

export async function reconcileEventLaunchTargets(): Promise<EventLaunchTarget[]> {
  const targets = await getEventLaunchTargets();
  const pruned = pruneExpiredEventLaunchTargets(targets);
  if (JSON.stringify(pruned) !== JSON.stringify(targets)) {
    await setEventLaunchTargets(pruned);
  }
  return pruned;
}

export async function upsertEventLaunchTarget(
  event: CalendarEvent,
  rawLaunchUrl: string,
): Promise<{ ok: boolean; error?: string; target?: EventLaunchTarget }> {
  const launchUrl = normalizeLaunchUrl(rawLaunchUrl);
  if (launchUrl === null) {
    return { ok: false, error: 'Enter a valid http:// or https:// URL.' };
  }

  const targets = await reconcileEventLaunchTargets();
  const nextTarget: EventLaunchTarget = {
    calendarEventId: event.id,
    eventTitle: event.title,
    start: event.start,
    end: event.end,
    launchUrl,
    updatedAt: new Date().toISOString(),
  };

  const updated = targets.filter((target) => target.calendarEventId !== event.id);
  updated.push(nextTarget);
  const pruned = pruneExpiredEventLaunchTargets(updated);
  await setEventLaunchTargets(pruned);

  return { ok: true, target: nextTarget };
}

export async function removeEventLaunchTarget(calendarEventId: string): Promise<void> {
  const targets = await reconcileEventLaunchTargets();
  const updated = targets.filter((target) => target.calendarEventId !== calendarEventId);
  await setEventLaunchTargets(updated);
}

export function findEventLaunchTarget(
  calendarEventId: string,
  targets: EventLaunchTarget[],
): EventLaunchTarget | null {
  return targets.find((target) => target.calendarEventId === calendarEventId) ?? null;
}

export function resolveActiveLaunchTarget(
  activeEvents: CalendarEvent[],
  targets: EventLaunchTarget[],
): EventLaunchTarget | null {
  const targetByEventId = new Map(
    targets.map((target) => [target.calendarEventId, target] as const),
  );

  const sortedActiveEvents = [...activeEvents].sort(
    (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime(),
  );

  for (const event of sortedActiveEvents) {
    const target = targetByEventId.get(event.id);
    if (target) return target;
  }

  return null;
}
