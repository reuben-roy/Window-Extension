import React, { useEffect, useRef, useState } from 'react';
import InfoTip from '../../shared/components/InfoTip';
import { removeEventRule, upsertEventRule } from '../../shared/eventRules';
import { removeEventLaunchTarget, upsertEventLaunchTarget } from '../../shared/launchTargets';
import type { EventLaunchTarget, ExtendedTaskAssignment, TaskTag } from '../../shared/types';
import {
  TOOLTIP_HEIGHT,
  TOOLTIP_MARGIN,
  TOOLTIP_WIDTH,
  clamp,
  formatTooltipDate,
  getSelectableTaskTags,
  parseDifficultyRank,
  safeHostname,
  splitDomains,
  statusDot,
} from '../lib';
import type { ResolvedWorkspaceEvent, TooltipMode, TooltipPlacement } from '../lib';

export const EventRuleTooltip = React.forwardRef<HTMLDivElement, {
  resolvedEvent: ResolvedWorkspaceEvent;
  launchTarget: EventLaunchTarget | null;
  extendedTaskAssignment: ExtendedTaskAssignment | null;
  onRemoveExtendedTaskAssignment: (calendarEventId: string) => Promise<void>;
  taskTags: TaskTag[];
  anchorRect: DOMRect;
  mode: TooltipMode;
  placement: TooltipPlacement;
  onClose: () => void;
  onSaved: () => Promise<void>;
  savingRule: boolean;
  onSavingChange: (value: boolean) => void;
}>(
  (
    {
      resolvedEvent,
      launchTarget,
      extendedTaskAssignment,
      onRemoveExtendedTaskAssignment,
      taskTags,
      anchorRect,
      mode,
      placement,
      onClose,
      onSaved,
      savingRule,
      onSavingChange,
    },
    ref,
  ) => {
    const exactRuleExists = resolvedEvent.source === 'event' || resolvedEvent.source === 'override';
    const hasUnrestrictedOverride = resolvedEvent.source === 'override';
    const keywordFallbackActive = resolvedEvent.source === 'keyword';
    const startsInEditing = resolvedEvent.source === 'none';
    const currentDomainsValue = exactRuleExists ? resolvedEvent.domains.join(', ') : '';
    const currentEffectiveDomainsValue = resolvedEvent.effectiveDomains.join(', ');
    const currentLaunchUrlValue = launchTarget?.launchUrl ?? '';
    const displayedDomains = exactRuleExists ? resolvedEvent.domains : resolvedEvent.effectiveDomains;
    const canCopyFallbackDomains = keywordFallbackActive && resolvedEvent.effectiveDomains.length > 0;
    const [domainsInput, setDomainsInput] = useState(currentDomainsValue);
    const [launchUrlInput, setLaunchUrlInput] = useState(currentLaunchUrlValue);
    const [tagKey, setTagKey] = useState(resolvedEvent.tagKey ?? '');
    const [secondaryTagKeys, setSecondaryTagKeys] = useState<string[]>(resolvedEvent.secondaryTagKeys);
    const [difficultyRank, setDifficultyRank] = useState<string>(
      resolvedEvent.difficultyRank ? String(resolvedEvent.difficultyRank) : '',
    );
    const [editing, setEditing] = useState(startsInEditing);
    const [editingLaunchTarget, setEditingLaunchTarget] = useState(false);
    const [error, setError] = useState('');
    const [launchError, setLaunchError] = useState('');
    const [savingLaunchTarget, setSavingLaunchTarget] = useState(false);
    const [removingExtendedTask, setRemovingExtendedTask] = useState(false);
    const previousEventIdRef = useRef(resolvedEvent.event.id);

    // Only reset the draft when switching events. Background storage refreshes
    // happen often enough that syncing on every prop change can wipe mid-typing edits.
    useEffect(() => {
      if (previousEventIdRef.current === resolvedEvent.event.id) {
        return;
      }
      previousEventIdRef.current = resolvedEvent.event.id;
      setDomainsInput(currentDomainsValue);
      setLaunchUrlInput(currentLaunchUrlValue);
      setTagKey(resolvedEvent.tagKey ?? '');
      setSecondaryTagKeys(resolvedEvent.secondaryTagKeys);
      setDifficultyRank(resolvedEvent.difficultyRank ? String(resolvedEvent.difficultyRank) : '');
      setEditing(startsInEditing);
      setError('');
      setLaunchError('');
      setEditingLaunchTarget(false);
      setRemovingExtendedTask(false);
    }, [currentDomainsValue, currentLaunchUrlValue, resolvedEvent.difficultyRank, resolvedEvent.event.id, resolvedEvent.secondaryTagKeys, resolvedEvent.tagKey, startsInEditing]);

    const positioning = mode === 'modal'
      ? {
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }
      : {
          top:
            placement === 'bottom'
              ? `${Math.min(window.innerHeight - TOOLTIP_HEIGHT - TOOLTIP_MARGIN, anchorRect.bottom + 14)}px`
              : `${Math.max(TOOLTIP_MARGIN, anchorRect.top - TOOLTIP_HEIGHT - 14)}px`,
          left: `${clamp(anchorRect.left + anchorRect.width / 2 - TOOLTIP_WIDTH / 2, TOOLTIP_MARGIN, window.innerWidth - TOOLTIP_WIDTH - TOOLTIP_MARGIN)}px`,
          transform: 'none',
        };
    const saveAsUnrestricted = splitDomains(domainsInput).length === 0;
    const titleModeLabel =
      resolvedEvent.source === 'event'
        ? 'Exact Event Rule'
        : resolvedEvent.source === 'keyword'
          ? 'Keyword fallback'
          : resolvedEvent.source === 'override'
            ? 'Unrestricted override'
            : 'Unrestricted';
    const summaryTitle =
      resolvedEvent.source === 'event'
        ? `Using exact title rule “${resolvedEvent.ruleName}”`
        : resolvedEvent.source === 'keyword'
          ? `Using keyword fallback “${resolvedEvent.ruleName}”`
          : resolvedEvent.source === 'override'
            ? 'This title is explicitly unrestricted'
            : 'No exact rule yet';
    const summaryBody =
      resolvedEvent.source === 'event'
        ? 'Editing here updates the exact Event Rule used by every event with this title.'
        : resolvedEvent.source === 'keyword'
          ? 'These sites are coming from a keyword match. Create an exact rule only if this title should pin custom sites or stay unrestricted.'
          : resolvedEvent.source === 'override'
            ? resolvedEvent.fallbackKeyword
              ? `Keyword fallback “${resolvedEvent.fallbackKeyword}” is currently suppressed for this exact title.`
              : 'This exact-title override keeps the event unrestricted until you add allowed sites again.'
            : 'Browsing stays unrestricted unless you save allowed sites for this event title.';
    const saveButtonLabel = saveAsUnrestricted
      ? resolvedEvent.source === 'none'
        ? 'Keep Unrestricted'
        : hasUnrestrictedOverride
          ? 'Save Unrestricted Override'
          : 'Create Unrestricted Override'
      : exactRuleExists
        ? 'Save Rule'
        : 'Create Exact Rule';
    const unrestrictedBadgeLabel = saveAsUnrestricted
      ? resolvedEvent.source === 'none'
        ? 'Keeps unrestricted'
        : exactRuleExists
          ? 'Saves as unrestricted override'
          : 'Creates unrestricted override'
      : null;
    const editButtonLabel = exactRuleExists ? 'Edit' : keywordFallbackActive ? 'Create Rule' : 'Edit';
    const hasLaunchTarget = launchTarget !== null;
    const launchTargetHost = launchTarget ? safeHostname(launchTarget.launchUrl) : null;

    return (
      <>
        {mode === 'modal' ? (
          <div
            className="fixed inset-0 z-40 bg-[rgba(9,14,30,0.12)] backdrop-blur-[2px]"
            onClick={onClose}
          />
        ) : null}
        <div
          ref={ref}
          className={`fixed z-50 w-[min(720px,calc(100vw-24px))] rounded-xl border border-white/80 bg-[rgba(255,255,255,0.98)] p-4 shadow-2xl ring-1 ring-[rgba(148,163,184,0.12)] ${
            mode === 'modal' ? 'max-h-[min(720px,calc(100vh-40px))] overflow-auto' : 'max-h-[min(720px,calc(100vh-32px))] overflow-auto'
          }`}
          style={positioning}
          role="dialog"
          aria-modal="true"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(148,163,184,0.25)] bg-[rgba(241,245,249,0.78)] px-2.5 py-1 text-[11px] font-semibold text-[var(--fg-muted)]">
                <span className={`h-2 w-2 rounded-full ${statusDot(resolvedEvent.source)}`} />
                {titleModeLabel}
              </div>
              <h3 className="text-[1.9rem] font-semibold tracking-[-0.04em] text-[var(--fg-text)]">
                {resolvedEvent.event.title}
              </h3>
              <p className="text-sm font-medium text-[var(--fg-muted)]">
                {formatTooltipDate(resolvedEvent.event)}
              </p>
              {resolvedEvent.event.recurrenceHint && (
                <p className="max-w-[30ch] text-xs leading-5 text-[var(--fg-muted)]">
                  {resolvedEvent.event.recurrenceHint}. Changes here apply to all events with this exact title.
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-full border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-1.5 text-sm font-medium text-[var(--fg-muted)] transition hover:bg-white hover:text-[var(--fg-text)]"
              aria-label="Close event rule editor"
            >
              Close
            </button>
          </div>

          <div className="mb-4 rounded-md border border-[rgba(148,163,184,0.18)] bg-[linear-gradient(180deg,rgba(248,250,252,0.96),rgba(241,245,249,0.9))] px-3 py-2.5.5">
            <p className="text-sm font-medium text-[var(--fg-text)]">
              {summaryTitle}
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
              {summaryBody}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start lg:gap-5">
            <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-[rgba(148,163,184,0.16)] bg-[var(--fg-panel-soft)] px-3 py-2.5">
                <p className="text-sm font-medium text-[var(--fg-text)]">Primary tag</p>
                <select
                  value={tagKey}
                  onChange={(event) => setTagKey(event.target.value)}
                  disabled={!editing}
                  className="fg-select mt-2 w-full disabled:cursor-not-allowed disabled:bg-[rgba(248,250,252,0.92)] disabled:text-[var(--fg-muted)]"
                >
                  <option value="">No explicit tag</option>
                  {getSelectableTaskTags(taskTags, [tagKey, ...secondaryTagKeys]).map((tag) => (
                    <option key={tag.key} value={tag.key}>
                      {tag.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[var(--fg-muted)]">
                  Exact rules can pin a tag instead of relying on keyword inference.
                </p>
              </div>

              <div className="rounded-md border border-[rgba(148,163,184,0.16)] bg-[var(--fg-panel-soft)] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-[var(--fg-text)]">Secondary tags</p>
                  <InfoTip text="Optional supporting tags for this exact title. Window stores them on the session, but the main charts still group by the primary tag." />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {getSelectableTaskTags(taskTags, [tagKey, ...secondaryTagKeys])
                    .filter((tag) => tag.key !== tagKey)
                    .map((tag) => {
                      const selected = secondaryTagKeys.includes(tag.key);
                      return (
                        <button
                          key={tag.key}
                          type="button"
                          disabled={!editing && !selected}
                          onClick={() =>
                            setSecondaryTagKeys((current) =>
                              selected
                                ? current.filter((key) => key !== tag.key)
                                : [...current, tag.key].slice(0, 2),
                            )
                          }
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                            selected
                              ? 'border-[var(--fg-accent)] bg-[var(--fg-accent-soft)] text-[var(--fg-accent)]'
                              : 'border-[var(--fg-border)] bg-white text-[var(--fg-muted)]'
                          } disabled:cursor-not-allowed disabled:opacity-70`}
                        >
                          {tag.label}
                        </button>
                      );
                    })}
                </div>
                <p className="mt-2 text-xs text-[var(--fg-muted)]">
                  Select up to two. Archived tags stay hidden unless already attached here.
                </p>
              </div>

              <div className="rounded-md border border-[rgba(148,163,184,0.16)] bg-[var(--fg-panel-soft)] px-3 py-2.5">
                <p className="text-sm font-medium text-[var(--fg-text)]">Difficulty</p>
                <select
                  value={difficultyRank}
                  onChange={(event) => setDifficultyRank(event.target.value)}
                  disabled={!editing}
                  className="fg-select mt-2 w-full disabled:cursor-not-allowed disabled:bg-[rgba(248,250,252,0.92)] disabled:text-[var(--fg-muted)]"
                >
                  <option value="">Auto from tag and history</option>
                  <option value="1">1 · Routine</option>
                  <option value="2">2 · Light</option>
                  <option value="3">3 · Standard</option>
                  <option value="5">5 · Demanding</option>
                  <option value="8">8 · Deep</option>
                </select>
                <p className="text-xs text-[var(--fg-muted)]">
                  Use an exact override only when this block is consistently easier or harder than the tag default.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-[rgba(148,163,184,0.16)] bg-white px-4 py-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[var(--fg-text)]">Allowed sites</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                    Leave this empty to keep this event unrestricted, even if a keyword fallback matches.
                  </p>
                </div>
              {!editing && (
                <button
                  onClick={() => {
                    setDomainsInput(currentDomainsValue);
                    setError('');
                    setEditing(true);
                  }}
                  className="fg-button-ghost"
                >
                  {editButtonLabel}
                </button>
              )}
              </div>

              {editing ? (
                <>
                {canCopyFallbackDomains ? (
                  <div className="mb-3 rounded-md border border-[rgba(59,130,246,0.14)] bg-[rgba(239,246,255,0.78)] px-3.5 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="max-w-[22rem]">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-700">
                          Current keyword fallback
                        </p>
                        <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                          These sites are active now through the keyword rule. Copy them only if you want to pin this exact title to the same list.
                        </p>
                      </div>
                      <button
                        onClick={() => setDomainsInput(currentEffectiveDomainsValue)}
                        className="rounded-full border border-[rgba(59,130,246,0.18)] bg-white px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:border-[rgba(59,130,246,0.26)] hover:bg-sky-50"
                      >
                        Copy current sites
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {resolvedEvent.effectiveDomains.map((domain) => (
                        <span
                          key={domain}
                          className="rounded-full border border-[rgba(148,163,184,0.2)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--fg-text)]"
                        >
                          {domain}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                <textarea
                  rows={4}
                  value={domainsInput}
                  onChange={(event) => setDomainsInput(event.target.value)}
                  className="fg-input min-h-[132px] resize-none"
                  placeholder="github.com, claude.ai, docs.google.com"
                  autoFocus
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs leading-5 text-[var(--fg-muted)]">
                    Enter domains separated by commas. Subdomains are allowed automatically by the block rule.
                  </p>
                  {unrestrictedBadgeLabel ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                      {unrestrictedBadgeLabel}
                    </span>
                  ) : null}
                </div>
                {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        setError('');
                        onSavingChange(true);
                        const result = await upsertEventRule(
                          resolvedEvent.event.title,
                          splitDomains(domainsInput),
                          {
                            tagKey: tagKey || null,
                            secondaryTagKeys,
                            difficultyOverride: parseDifficultyRank(difficultyRank),
                          },
                        );
                        onSavingChange(false);
                        if (!result.ok) {
                          setError(result.error ?? 'Unable to save Event Rule.');
                          return;
                        }
                        setEditing(false);
                        await onSaved();
                      }}
                      disabled={savingRule}
                      className="fg-button-primary"
                    >
                      {savingRule ? 'Saving…' : saveButtonLabel}
                    </button>
                    <button
                      onClick={() => {
                        setDomainsInput(currentDomainsValue);
                        setTagKey(resolvedEvent.tagKey ?? '');
                        setSecondaryTagKeys(resolvedEvent.secondaryTagKeys);
                        setDifficultyRank(resolvedEvent.difficultyRank ? String(resolvedEvent.difficultyRank) : '');
                        setError('');
                        setEditing(false);
                      }}
                      className="fg-button-secondary"
                    >
                      Cancel
                    </button>
                  </div>

                  {exactRuleExists && (
                    <button
                      onClick={async () => {
                        await removeEventRule(resolvedEvent.event.title);
                        await onSaved();
                      }}
                      className="text-sm font-medium text-rose-600 transition hover:text-rose-700"
                    >
                      {hasUnrestrictedOverride ? 'Delete unrestricted override' : 'Remove exact rule'}
                    </button>
                  )}
                </div>
                </>
              ) : (
                <div>
                  {displayedDomains.length > 0 ? (
                    <>
                    {keywordFallbackActive ? (
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
                        From keyword fallback
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {displayedDomains.map((domain) => (
                      <span
                        key={domain}
                        className="rounded-full border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-1.5 text-xs font-medium text-[var(--fg-text)]"
                      >
                        {domain}
                      </span>
                      ))}
                    </div>
                    {keywordFallbackActive ? (
                      <p className="mt-3 text-xs leading-5 text-[var(--fg-muted)]">
                        This title is still following the shared keyword rule. Create an exact rule only if you want this event title to stop inheriting those sites.
                      </p>
                    ) : null}
                    </>
                  ) : hasUnrestrictedOverride ? (
                    <p className="text-sm leading-6 text-[var(--fg-muted)]">
                      This exact-title override keeps the event unrestricted.
                      {resolvedEvent.fallbackKeyword
                        ? ` Keyword fallback "${resolvedEvent.fallbackKeyword}" will stay off until you delete the override.`
                        : ''}
                    </p>
                  ) : (
                    <p className="text-sm text-[var(--fg-muted)]">No domains saved yet.</p>
                  )}
                  {exactRuleExists ? (
                    <button
                      onClick={async () => {
                        await removeEventRule(resolvedEvent.event.title);
                        await onSaved();
                      }}
                      className="mt-4 text-sm font-medium text-rose-600 transition hover:text-rose-700"
                    >
                      {hasUnrestrictedOverride ? 'Delete unrestricted override' : 'Remove exact rule'}
                    </button>
                  ) : null}
                </div>
              )}
            </div>

            </div>

            <div className="space-y-4">
              <div className="rounded-lg border border-[rgba(148,163,184,0.16)] bg-white px-4 py-4 shadow-sm">
                <div className="mb-3">
                  <p className="text-sm font-medium text-[var(--fg-text)]">Routine</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                    Occurrence checklist from Routines (right rail). This applies only to this calendar block, not every event with the same title.
                  </p>
                </div>
                {extendedTaskAssignment ? (
                  <div className="space-y-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--fg-text)]">{extendedTaskAssignment.setTitle}</p>
                      <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
                        {extendedTaskAssignment.items.length} linked step
                        {extendedTaskAssignment.items.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="max-h-[220px] space-y-1.5 overflow-y-auto rounded-md border border-[rgba(148,163,184,0.14)] bg-[var(--fg-panel-soft)] px-2.5 py-2">
                      {extendedTaskAssignment.items.slice(0, 12).map((item, index) => (
                        <div key={item.id} className="flex items-start justify-between gap-2 text-[11px] leading-snug">
                          <span
                            className={`min-w-0 flex-1 ${
                              item.completedAt !== null ? 'text-emerald-800 line-through' : 'text-[var(--fg-text)]'
                            }`}
                          >
                            <span className="font-semibold text-[var(--fg-muted)]">{index + 1}.</span> {item.label}
                          </span>
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex-shrink-0 font-medium text-[var(--fg-accent)]"
                          >
                            Open
                          </a>
                        </div>
                      ))}
                      {extendedTaskAssignment.items.length > 12 ? (
                        <p className="text-[11px] text-[var(--fg-muted)]">
                          +{extendedTaskAssignment.items.length - 12} more steps — scroll or use the workspace rail for the full list.
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      disabled={removingExtendedTask}
                      onClick={async () => {
                        setRemovingExtendedTask(true);
                        try {
                          await onRemoveExtendedTaskAssignment(resolvedEvent.event.id);
                          await onSaved();
                        } finally {
                          setRemovingExtendedTask(false);
                        }
                      }}
                      className="w-full rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                    >
                      {removingExtendedTask ? 'Removing…' : 'Remove routine from this occurrence'}
                    </button>
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-[var(--fg-muted)]">
                    No routine linked yet. Drag a routine card from <strong>Routines</strong> onto this event on the calendar.
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-[rgba(148,163,184,0.16)] bg-white px-4 py-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[var(--fg-text)]">Launch page</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                    Save one exact task URL for this calendar occurrence. Window can bring that page forward automatically when the block starts.
                  </p>
                </div>
                {!editingLaunchTarget && (
                  <button
                    onClick={() => {
                      setLaunchUrlInput(currentLaunchUrlValue);
                      setLaunchError('');
                      setEditingLaunchTarget(true);
                    }}
                    className="fg-button-ghost"
                  >
                    {hasLaunchTarget ? 'Edit' : 'Add'}
                  </button>
                )}
              </div>

              {editingLaunchTarget ? (
                <>
                  <input
                    type="url"
                    value={launchUrlInput}
                    onChange={(event) => setLaunchUrlInput(event.target.value)}
                    className="fg-input"
                    placeholder="https://leetcode.com/problems/two-sum/"
                    autoFocus={!editing}
                  />
                  <p className="mt-3 text-xs leading-5 text-[var(--fg-muted)]">
                    Exact `http://` or `https://` only. This launch page is saved for this event occurrence only and does not create an exact Event Rule.
                  </p>
                  {launchError && <p className="mt-3 text-xs text-rose-600">{launchError}</p>}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          setLaunchError('');
                          setSavingLaunchTarget(true);
                          const result = await upsertEventLaunchTarget(
                            resolvedEvent.event,
                            launchUrlInput,
                          );
                          setSavingLaunchTarget(false);
                          if (!result.ok) {
                            setLaunchError(result.error ?? 'Unable to save launch page.');
                            return;
                          }
                          setEditingLaunchTarget(false);
                          await onSaved();
                        }}
                        disabled={savingLaunchTarget}
                        className="fg-button-primary"
                      >
                        {savingLaunchTarget ? 'Saving…' : hasLaunchTarget ? 'Save launch page' : 'Add launch page'}
                      </button>
                      <button
                        onClick={() => {
                          setLaunchUrlInput(currentLaunchUrlValue);
                          setLaunchError('');
                          setEditingLaunchTarget(false);
                        }}
                        className="fg-button-secondary"
                      >
                        Cancel
                      </button>
                    </div>

                    {hasLaunchTarget ? (
                      <button
                        onClick={async () => {
                          await removeEventLaunchTarget(resolvedEvent.event.id);
                          setLaunchError('');
                          setEditingLaunchTarget(false);
                          await onSaved();
                        }}
                        className="text-sm font-medium text-rose-600 transition hover:text-rose-700"
                      >
                        Remove launch page
                      </button>
                    ) : null}
                  </div>
                </>
              ) : hasLaunchTarget ? (
                <div className="space-y-3">
                  <div className="rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3.5 py-3">
                    <p className="truncate text-sm font-medium text-[var(--fg-text)]">
                      {launchTargetHost}
                    </p>
                    <p className="mt-1 break-all text-xs leading-5 text-[var(--fg-muted)]">
                      {launchTarget.launchUrl}
                    </p>
                  </div>
                  <p className="text-xs leading-5 text-[var(--fg-muted)]">
                    This launch page stays tied to this occurrence only. Saving it does not change the title-wide allowlist rule.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-[var(--fg-muted)]">No launch page saved for this occurrence.</p>
              )}
              </div>

            </div>

          </div>
        </div>
      </>
    );
  },
);

EventRuleTooltip.displayName = 'EventRuleTooltip';
