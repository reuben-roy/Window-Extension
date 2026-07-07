import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CompactSettingRow from '../../shared/components/CompactSettingRow';
import InfoTip from '../../shared/components/InfoTip';
import Toggle from '../../shared/components/Toggle';
import { isLearningFeatureEnabled } from '../../shared/learning';
import type {
  LearningState,
  LearningSubject,
  QuizPackSummary,
  ReviewQueueItem,
  Settings,
  UserLearningTopic,
} from '../../shared/types';
import {
  formatLearningDueLabel,
  formatLearningPackStatus,
  formatLearningTimestamp,
  humanizeLearningTopicKey,
} from '../lib';
import { EmptyCard } from './EmptyCard';

export function LearningWorkspace({
  settings,
  learningState,
  allTaxonomy,
  taxonomy,
  selectedTopics,
  selectedTopicKeys,
  packs,
  reviewQueue,
  search,
  customTopic,
  learningActionBusy,
  onSearchChange,
  onCustomTopicChange,
  onSaveTopics,
  onCreateCustomTopic,
  onRegeneratePack,
  onUpdateLearningSettings,
  onRefresh,
}: {
  settings: Settings;
  learningState: LearningState | null;
  allTaxonomy: LearningSubject[];
  taxonomy: LearningSubject[];
  selectedTopics: UserLearningTopic[];
  selectedTopicKeys: Set<string>;
  packs: QuizPackSummary[];
  reviewQueue: ReviewQueueItem[];
  search: string;
  customTopic: string;
  learningActionBusy: false | 'save' | 'custom' | string;
  onSearchChange: (value: string) => void;
  onCustomTopicChange: (value: string) => void;
  onSaveTopics: (topics: UserLearningTopic[]) => Promise<void>;
  onCreateCustomTopic: () => Promise<void>;
  onRegeneratePack: (packId: string) => Promise<void>;
  onUpdateLearningSettings: (patch: Partial<Settings['learningSettings']>) => Promise<void>;
  onRefresh: () => Promise<void>;
}): React.JSX.Element {
  const learningEnabled = isLearningFeatureEnabled(settings);
  const suggestions = learningState?.suggestions ?? [];
  const selectedTopicKeyList = useMemo(
    () => [...selectedTopicKeys].sort(),
    [selectedTopicKeys],
  );
  const [draftTopicKeys, setDraftTopicKeys] = useState<string[]>(selectedTopicKeyList);
  const previousSelectedSignatureRef = useRef(selectedTopicKeyList.join('|'));

  const selectedSignature = selectedTopicKeyList.join('|');
  const draftSignature = draftTopicKeys.join('|');

  useEffect(() => {
    setDraftTopicKeys((current) =>
      current.join('|') === previousSelectedSignatureRef.current ? selectedTopicKeyList : current,
    );
    previousSelectedSignatureRef.current = selectedSignature;
  }, [selectedSignature, selectedTopicKeyList]);

  const hasTopicChanges = draftSignature !== selectedSignature;
  const draftTopicKeySet = useMemo(() => new Set(draftTopicKeys), [draftTopicKeys]);
  const existingTopicsByKey = useMemo(
    () => new Map(selectedTopics.map((topic) => [topic.topicKey, topic])),
    [selectedTopics],
  );
  const catalogTopicIndex = useMemo(() => {
    const index = new Map<string, { label: string; subjectKey: string | null }>();
    for (const subject of allTaxonomy) {
      for (const topic of subject.topics) {
        index.set(topic.key, {
          label: topic.label,
          subjectKey: subject.key,
        });
      }
    }
    return index;
  }, [allTaxonomy]);
  const suggestionsByKey = useMemo(
    () => new Map(suggestions.map((suggestion) => [suggestion.topicKey, suggestion])),
    [suggestions],
  );
  const readyPacks = packs.filter((pack) => pack.status === 'ready');
  const queuedPacks = packs.filter((pack) => pack.status !== 'ready');
  const dueReviewCount = reviewQueue.filter((item) => new Date(item.dueAt).getTime() <= Date.now()).length;
  const nextReview = reviewQueue
    .slice()
    .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime())[0] ?? null;

  const toggleTopicSelection = useCallback((topicKey: string) => {
    setDraftTopicKeys((current) =>
      current.includes(topicKey)
        ? current.filter((key) => key !== topicKey)
        : [...current, topicKey].sort(),
    );
  }, []);

  const buildDraftTopics = useCallback((): UserLearningTopic[] => {
    const nowIso = new Date().toISOString();
    return [...draftTopicKeySet]
      .map((topicKey) => {
        const existing = existingTopicsByKey.get(topicKey);
        if (existing) {
          return existing;
        }

        const suggestion = suggestionsByKey.get(topicKey);
        const catalogTopic = catalogTopicIndex.get(topicKey);
        return {
          id: `draft-${topicKey}`,
          subjectKey: suggestion?.subjectKey ?? catalogTopic?.subjectKey ?? null,
          topicKey,
          label: suggestion?.label ?? catalogTopic?.label ?? humanizeLearningTopicKey(topicKey),
          source: suggestion ? 'suggested' : 'catalog',
          active: true,
          createdAt: nowIso,
          updatedAt: nowIso,
        } satisfies UserLearningTopic;
      })
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [catalogTopicIndex, draftTopicKeySet, existingTopicsByKey, suggestionsByKey]);

  const selectedTopicCards = buildDraftTopics();

  return (
    <section className="space-y-4">
      {!learningEnabled ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Learning is currently turned off. Your topics and generated packs stay saved, but Window will not suggest, schedule, or surface quizzes until you turn the feature back on in the Settings tab.
        </div>
      ) : null}

      {learningState?.lastError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {learningState.lastError}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[320px,minmax(0,1fr),300px]">
        <div className="space-y-4">
          <section className="fg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--fg-muted)]">
                  Study Topics
                </p>
                <h2 className="mt-1 text-base font-semibold tracking-[-0.03em] text-[var(--fg-text)]">
                  Explicit-first topic selection
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  void onRefresh();
                }}
                className="fg-button-ghost px-2 py-1 text-[11px]"
              >
                {learningState?.syncing ? 'Syncing…' : 'Refresh'}
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--fg-muted)]">
                  Search subjects or topics
                </span>
                <input
                  value={search}
                  onChange={(event) => onSearchChange(event.target.value)}
                  placeholder="AI, chemistry, thermodynamics…"
                  className="fg-input mt-2"
                  disabled={!learningEnabled}
                />
              </label>

              <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--fg-muted)]">
                  Custom topic
                </span>
                <div className="mt-2 flex gap-2">
                  <input
                    value={customTopic}
                    onChange={(event) => onCustomTopicChange(event.target.value)}
                    placeholder="Advanced optimization, redox chemistry…"
                    className="fg-input"
                    disabled={!learningEnabled}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void onCreateCustomTopic();
                    }}
                    disabled={!learningEnabled || learningActionBusy === 'custom' || !customTopic.trim()}
                    className="fg-button-primary shrink-0 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {learningActionBusy === 'custom' ? 'Adding…' : 'Add'}
                  </button>
                </div>
              </label>

              <div className="rounded-lg border border-[var(--fg-border)] bg-[var(--fg-panel-soft)]/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--fg-muted)]">
                    Selected topics
                  </p>
                  <span className="text-[11px] text-[var(--fg-muted)]">
                    {selectedTopicCards.length}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedTopicCards.length === 0 ? (
                    <p className="text-sm text-[var(--fg-muted)]">
                      Pick subjects from the catalog or add a custom topic to start.
                    </p>
                  ) : (
                    selectedTopicCards.map((topic) => (
                      <button
                        key={topic.topicKey}
                        type="button"
                        onClick={() => toggleTopicSelection(topic.topicKey)}
                        disabled={!learningEnabled}
                        className="inline-flex items-center gap-2 rounded-full border border-[var(--fg-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--fg-text)] transition hover:border-[var(--fg-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span>{topic.label}</span>
                        <span className="text-[var(--fg-muted)]">Remove</span>
                      </button>
                    ))
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-[11px] leading-5 text-[var(--fg-muted)]">
                    Suggestions never auto-enroll. Save changes when the selected set looks right.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void onSaveTopics(buildDraftTopics());
                    }}
                    disabled={!learningEnabled || !hasTopicChanges || learningActionBusy === 'save'}
                    className="fg-button-primary shrink-0 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {learningActionBusy === 'save' ? 'Saving…' : 'Save topics'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="fg-card p-4">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-[var(--fg-text)]">Suggested from activity</h2>
              <InfoTip text="Window can inspect event titles, task tags, and recent study signals, but suggestions still require approval." />
            </div>
            <div className="mt-3 space-y-2">
              {suggestions.length === 0 ? (
                <EmptyCard text="No suggestions yet. Turn on activity suggestions or spend more time in the topics you care about." />
              ) : (
                suggestions.map((suggestion) => {
                  const selected = draftTopicKeySet.has(suggestion.topicKey);
                  return (
                    <button
                      key={suggestion.id}
                      type="button"
                      onClick={() => toggleTopicSelection(suggestion.topicKey)}
                      disabled={!learningEnabled}
                      className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                        selected
                          ? 'border-[var(--fg-accent)] bg-[var(--fg-accent-soft)]'
                          : 'border-[var(--fg-border)] bg-white hover:border-[var(--fg-accent)]/50'
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-[var(--fg-text)]">{suggestion.label}</p>
                        <span className="text-[11px] uppercase tracking-wide text-[var(--fg-muted)]">
                          {selected ? 'Selected' : suggestion.source}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">{suggestion.reason}</p>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="fg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--fg-text)]">Review queue</h2>
              <span className="text-[11px] text-[var(--fg-muted)]">{reviewQueue.length} cards</span>
            </div>
            <div className="mt-3 space-y-2">
              {reviewQueue.length === 0 ? (
                <EmptyCard text="No review items due yet. Once packs are generated, spaced repetition cards will appear here." />
              ) : (
                reviewQueue.slice(0, 6).map((item) => (
                  <div key={item.progressId} className="rounded-lg border border-[var(--fg-border)] bg-white px-3 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--fg-text)]">{item.topicLabel}</p>
                        <p className="mt-1 text-xs text-[var(--fg-muted)]">{item.chapterTitle}</p>
                      </div>
                      <span className="rounded-full bg-[var(--fg-accent-soft)] px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--fg-accent)]">
                        {item.difficulty}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-[var(--fg-muted)]">
                      <span>{formatLearningDueLabel(item.dueAt)}</span>
                      <span>Seen {item.seenCount}x · streak {item.correctStreak}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="fg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--fg-muted)]">
                  Subject Catalog
                </p>
                <h2 className="mt-1 text-base font-semibold tracking-[-0.03em] text-[var(--fg-text)]">
                  Curated subjects and searchable subtopics
                </h2>
              </div>
              <span className="rounded-full border border-[var(--fg-border)] bg-white px-3 py-1 text-[11px] font-medium text-[var(--fg-muted)]">
                {taxonomy.reduce((count, subject) => count + subject.topics.length, 0)} topics shown
              </span>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {taxonomy.length === 0 ? (
                <div className="lg:col-span-2">
                  <EmptyCard text="No subjects matched that search. Try a broader keyword or add a custom topic instead." />
                </div>
              ) : (
                taxonomy.map((subject) => (
                  <div key={subject.key} className="rounded-xl border border-[var(--fg-border)] bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--fg-text)]">{subject.label}</h3>
                        <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">{subject.description}</p>
                      </div>
                      <span className="text-[11px] text-[var(--fg-muted)]">{subject.topics.length}</span>
                    </div>
                    <div className="mt-4 space-y-2">
                      {subject.topics.map((topic) => {
                        const checked = draftTopicKeySet.has(topic.key);
                        return (
                          <label
                            key={topic.key}
                            className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition ${
                              checked
                                ? 'border-[var(--fg-accent)] bg-[var(--fg-accent-soft)]'
                                : 'border-[var(--fg-border)] hover:border-[var(--fg-accent)]/40'
                            } ${!learningEnabled ? 'cursor-not-allowed opacity-55' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleTopicSelection(topic.key)}
                              disabled={!learningEnabled}
                              className="mt-1 h-4 w-4 rounded border-[var(--fg-border)] text-[var(--fg-accent)]"
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-[var(--fg-text)]">{topic.label}</span>
                              <span className="mt-1 block text-xs leading-5 text-[var(--fg-muted)]">
                                {topic.description}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="fg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--fg-muted)]">
                  Quiz Pack Library
                </p>
                <h2 className="mt-1 text-base font-semibold tracking-[-0.03em] text-[var(--fg-text)]">
                  Shared source packs and generated reviews
                </h2>
              </div>
              <div className="flex gap-2 text-[11px] text-[var(--fg-muted)]">
                <span>{readyPacks.length} ready</span>
                <span>{queuedPacks.length} processing</span>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {packs.length === 0 ? (
                <EmptyCard text="No quiz packs yet. Select topics and the worker will queue source discovery and pack generation." />
              ) : (
                packs.map((pack) => (
                  <div key={pack.id} className="rounded-xl border border-[var(--fg-border)] bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-[var(--fg-text)]">{pack.title}</h3>
                          <span className="rounded-full bg-[var(--fg-panel-soft)] px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--fg-muted)]">
                            {pack.sourceKind === 'paper-based' ? 'Paper-based' : 'Textbook'}
                          </span>
                          {pack.canonical ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-emerald-700">
                              Canonical
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                          {pack.topicLabel} · version {pack.versionNumber} · {pack.chapterCount} chapters · {pack.questionCount} questions
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void onRegeneratePack(pack.id);
                        }}
                        disabled={!learningEnabled || learningActionBusy === pack.id}
                        className="fg-button-secondary shrink-0 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {learningActionBusy === pack.id ? 'Rebuilding…' : 'Regenerate'}
                      </button>
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-3">
                      <CompactSettingRow
                        className="rounded-lg border border-[var(--fg-border)] bg-[var(--fg-panel-soft)]/65 px-3"
                        label="Status"
                        value={formatLearningPackStatus(pack.status)}
                        meta={pack.generatedAt ? formatLearningTimestamp(pack.generatedAt) : 'Waiting for generation'}
                      />
                      <CompactSettingRow
                        className="rounded-lg border border-[var(--fg-border)] bg-[var(--fg-panel-soft)]/65 px-3"
                        label="License mode"
                        value={pack.licenseMode === 'commercial_safe' ? 'Commercial safe' : 'Expanded OER'}
                        meta="Shared canon is segmented by license mode."
                      />
                      <CompactSettingRow
                        className="rounded-lg border border-[var(--fg-border)] bg-[var(--fg-panel-soft)]/65 px-3"
                        label="Coverage"
                        value={`${pack.chapterCount} chapters`}
                        meta={`${pack.questionCount} review prompts generated`}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="fg-card p-4">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-[var(--fg-text)]">Learning controls</h2>
              <InfoTip text="These settings govern how aggressively Window suggests topics, what licenses it will accept, and how often study prompts should surface." />
            </div>

            <div className="mt-4 space-y-3">
              <CompactSettingRow
                label="Activity suggestions"
                meta="Use event titles, task tags, and recent study behavior to propose new topics for approval."
                control={
                  <Toggle
                    checked={settings.learningSettings.suggestTopicsFromActivity}
                    disabled={!learningEnabled}
                    onChange={(checked) => {
                      void onUpdateLearningSettings({ suggestTopicsFromActivity: checked });
                    }}
                  />
                }
                className="rounded-lg border border-[var(--fg-border)] bg-[var(--fg-panel-soft)]/65 px-3"
              />

              <CompactSettingRow
                label="Auto-open quiz"
                meta="Automatically open the quiz window when a new question is ready, instead of waiting for you to click the FAB."
                control={
                  <Toggle
                    checked={settings.learningSettings.autoOpen}
                    disabled={!learningEnabled}
                    onChange={(checked) => {
                      void onUpdateLearningSettings({ autoOpen: checked });
                    }}
                  />
                }
                className="rounded-lg border border-[var(--fg-border)] bg-[var(--fg-panel-soft)]/65 px-3"
              />

              <CompactSettingRow
                label="Panel re-open delay"
                meta="After you close the in-page quiz panel, auto-open will not show it again until this many minutes have passed. Only applies when Auto-open quiz is enabled."
                control={
                  <select
                    value={settings.learningSettings.panelReopenCooldownMinutes}
                    onChange={(event) => {
                      void onUpdateLearningSettings({
                        panelReopenCooldownMinutes: Number(event.target.value),
                      });
                    }}
                    disabled={!learningEnabled || !settings.learningSettings.autoOpen}
                    className="fg-select w-[136px] text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value={1}>1 min</option>
                    <option value={5}>5 min</option>
                    <option value={10}>10 min</option>
                    <option value={15}>15 min</option>
                    <option value={20}>20 min</option>
                    <option value={30}>30 min</option>
                    <option value={45}>45 min</option>
                    <option value={60}>60 min</option>
                  </select>
                }
                className="rounded-lg border border-[var(--fg-border)] bg-[var(--fg-panel-soft)]/65 px-3"
              />

              <CompactSettingRow
                label="Review intensity"
                meta="Quiet surfaces fewer prompts, aggressive uses more of your breaks and idle time."
                control={
                  <select
                    value={settings.learningSettings.intensity}
                    onChange={(event) => {
                      void onUpdateLearningSettings({
                        intensity: event.target.value as Settings['learningSettings']['intensity'],
                      });
                    }}
                    disabled={!learningEnabled}
                    className="fg-select w-[136px] text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="quiet">Quiet</option>
                    <option value="balanced">Balanced</option>
                    <option value="aggressive">Aggressive</option>
                  </select>
                }
                className="rounded-lg border border-[var(--fg-border)] bg-[var(--fg-panel-soft)]/65 px-3"
              />

              <CompactSettingRow
                label="License mode"
                meta="Commercial safe restricts packs to business-safe sources. Expanded OER allows broader open educational material."
                control={
                  <select
                    value={settings.learningSettings.licenseMode}
                    onChange={(event) => {
                      void onUpdateLearningSettings({
                        licenseMode: event.target.value as Settings['learningSettings']['licenseMode'],
                      });
                    }}
                    disabled={!learningEnabled}
                    className="fg-select w-[168px] text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="commercial_safe">Commercial safe</option>
                    <option value="expanded_oer">Expanded OER</option>
                  </select>
                }
                className="rounded-lg border border-[var(--fg-border)] bg-[var(--fg-panel-soft)]/65 px-3"
              />
            </div>
          </section>

          <section className="fg-card p-4">
            <h2 className="text-sm font-semibold text-[var(--fg-text)]">Study health</h2>
            <div className="mt-4 grid gap-3">
              <CompactSettingRow
                label="Selected topics"
                value={selectedTopics.length.toString()}
                meta={selectedTopics.length > 0 ? selectedTopics.map((topic) => topic.label).slice(0, 3).join(', ') : 'No active topics yet'}
                className="rounded-lg border border-[var(--fg-border)] bg-white px-3"
              />
              <CompactSettingRow
                label="Review queue"
                value={`${dueReviewCount} due`}
                meta={
                  nextReview
                    ? `${nextReview.topicLabel} · ${nextReview.chapterTitle} · ${formatLearningDueLabel(nextReview.dueAt)}`
                    : 'No scheduled review cards yet'
                }
                className="rounded-lg border border-[var(--fg-border)] bg-white px-3"
              />
              <CompactSettingRow
                label="Pack versions"
                value={`${packs.length} tracked`}
                meta={
                  readyPacks.length > 0
                    ? `${readyPacks.length} canonical/ready packs available for reuse`
                    : 'The worker will generate shared canonical packs after sources are ingested'
                }
                className="rounded-lg border border-[var(--fg-border)] bg-white px-3"
              />
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
