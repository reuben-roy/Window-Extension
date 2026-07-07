import React, { useEffect, useMemo, useRef, useState } from 'react';
import InfoTip from '../../shared/components/InfoTip';
import type {
  AnalyticsSnapshot,
  ConsumptionTimelinePoint,
  DifficultyRank,
  FocusSessionRecord,
  TaskTag,
} from '../../shared/types';
import {
  activityBarClass,
  buildLinePath,
  chartX,
  chartY,
  dominantTreeActivityClass,
  formatMinutes,
  formatSessionRange,
  getSelectableTaskTags,
  humanizeActivityClass,
  parseDifficultyRank,
  tagBreakdownWidth,
} from '../lib';
import { EmptyCard } from './EmptyCard';

export function AnalyticsWorkspace({
  analyticsSnapshot,
  taskTags,
  onRefresh,
  onSaveOverride,
}: {
  analyticsSnapshot: AnalyticsSnapshot;
  taskTags: TaskTag[];
  onRefresh: () => void;
  onSaveOverride: (
    focusSessionId: string,
    tagKey: string | null,
    difficultyRank: DifficultyRank | null,
  ) => void;
}): React.JSX.Element {
  const [metricsRange, setMetricsRange] = useState<'7d' | '30d'>('7d');
  const [consumptionRange, setConsumptionRange] = useState<'7d' | '30d' | '90d' | '365d'>('7d');

  const summary = metricsRange === '30d' ? analyticsSnapshot.summary30d : analyticsSnapshot.summary7d;
  const recentSessions = analyticsSnapshot.recentSessions.slice(0, 12);
  const consumptionPoints = useMemo(() => {
    if (consumptionRange === '30d') return analyticsSnapshot.consumptionTimeline30d;
    if (consumptionRange === '90d') return analyticsSnapshot.consumptionTimeline90d;
    if (consumptionRange === '365d') return analyticsSnapshot.consumptionTimeline365d;
    return analyticsSnapshot.consumptionTimeline7d;
  }, [analyticsSnapshot, consumptionRange]);

  const domainBreakdown = useMemo(() => {
    if (consumptionRange === '30d') return analyticsSnapshot.domainBreakdown30d;
    if (consumptionRange === '90d') return analyticsSnapshot.domainBreakdown90d;
    if (consumptionRange === '365d') return analyticsSnapshot.domainBreakdown365d;
    return analyticsSnapshot.domainBreakdown7d;
  }, [analyticsSnapshot, consumptionRange]);

  return (
    <div className="space-y-4">
      <section className="fg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.02em] text-[var(--fg-text)]">Analytics</h2>
            <p className="mt-1 text-sm text-[var(--fg-muted)]">
              Calendar-linked focus sessions, grouped by time quality, tags, and inferred difficulty.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] p-1">
              <button
                className={`rounded-full px-3 py-1 text-xs font-medium ${metricsRange === '7d' ? 'bg-white text-[var(--fg-text)]' : 'text-[var(--fg-muted)]'}`}
                onClick={() => setMetricsRange('7d')}
              >
                7d
              </button>
              <button
                className={`rounded-full px-3 py-1 text-xs font-medium ${metricsRange === '30d' ? 'bg-white text-[var(--fg-text)]' : 'text-[var(--fg-muted)]'}`}
                onClick={() => setMetricsRange('30d')}
              >
                30d
              </button>
            </div>
            <button onClick={onRefresh} className="fg-button-secondary px-3 py-2 text-sm">
              Refresh Analytics
            </button>
          </div>
        </div>

        <div className="mb-3 grid gap-3 xl:grid-cols-[minmax(0,1.45fr),repeat(3,minmax(0,0.55fr))]">
          <div className="rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--fg-muted)]">
              What We Track
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--fg-muted)]">
              Window only scores time while a calendar event is active. Each minute is marked productive on allowed domains, supportive on helper domains, distracted on everything else, away when you go idle, and break while focus blocking is snoozed.
            </p>
          </div>
          <AnalyticsMetricCard label="Sessions" value={String(summary.totalFocusSessions)} />
          <AnalyticsMetricCard label="Break" value={formatMinutes(summary.breakMinutes)} />
          <AnalyticsMetricCard label="Left early" value={String(summary.leftEarlyCount)} />
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <AnalyticsMetricCard label="Productive" value={formatMinutes(summary.productiveMinutes)} />
          <AnalyticsMetricCard label="Supportive" value={formatMinutes(summary.supportiveMinutes)} />
          <AnalyticsMetricCard label="Distracted" value={formatMinutes(summary.distractedMinutes)} />
          <AnalyticsMetricCard label="Away" value={formatMinutes(summary.awayMinutes)} />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr),minmax(0,0.92fr)]">
        <div className="fg-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--fg-text)]">Consumption graph</h3>
              <InfoTip text="Daily lines built from recorded sites and pages during active focus blocks. Productive, supportive, and distracted time are shown separately." />
            </div>
            <div className="rounded-full border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] p-1">
              {(['7d', '30d', '90d', '365d'] as const).map((range) => (
                <button
                  key={range}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${consumptionRange === range ? 'bg-white text-[var(--fg-text)]' : 'text-[var(--fg-muted)]'}`}
                  onClick={() => setConsumptionRange(range)}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
          <ConsumptionTimelineChart points={consumptionPoints} />
        </div>

        <div className="fg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--fg-text)]">Consumption map</h3>
            <InfoTip text="Top domains come from local browsing telemetry during focus sessions. Domain breakdowns beyond 7 days are approximations built from compact daily rollups." />
          </div>
          <div className="space-y-3">
            <ConsumptionBreakdownList items={domainBreakdown.slice(0, 8)} />
            {consumptionRange === '7d' ? (
              <div className="border-t border-[var(--fg-border)] pt-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--fg-muted)]">
                  Domain tree
                </p>
                <div className="mt-2">
                  <ConsumptionTreeView nodes={analyticsSnapshot.consumptionTree7d.slice(0, 8)} />
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2 text-xs text-[var(--fg-muted)]">
                Domain tree is shown for 7d only (it requires full session-resolution domain history).
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.84fr),minmax(0,1.16fr)]">
        <div className="space-y-4">
          <div className="fg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--fg-text)]">Time by tag</h3>
              <InfoTip text="Grouped by the primary task tag on each focus session so users can compare what categories actually get completed." />
            </div>
            <div className="space-y-2">
              {analyticsSnapshot.tagBreakdown7d.length === 0 ? (
                <EmptyCard text="No tagged focus sessions yet." />
              ) : (
                analyticsSnapshot.tagBreakdown7d.map((item) => (
                  <div
                    key={item.tagKey}
                    className="rounded-[18px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3.5 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
                        <p className="truncate text-sm font-medium text-[var(--fg-text)]">{item.label}</p>
                      </div>
                      <p className="text-xs text-[var(--fg-muted)]">{formatMinutes(item.productiveMinutes)}</p>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${tagBreakdownWidth(item.productiveMinutes, analyticsSnapshot.tagBreakdown7d)}%`,
                          background: item.color,
                        }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-[var(--fg-muted)]">
                      {item.sessions} session{item.sessions === 1 ? '' : 's'} · {formatMinutes(item.distractedMinutes)} distracted
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="fg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--fg-text)]">Difficulty matrix</h3>
              <InfoTip text="Difficulty is a five-rank scale. Focus score compares productive minutes against distracted and away time." />
            </div>
            <div className="space-y-2">
              {analyticsSnapshot.difficultyBreakdown7d.length === 0 ? (
                <EmptyCard text="No difficulty data yet." />
              ) : (
                analyticsSnapshot.difficultyBreakdown7d.map((item) => (
                  <div
                    key={item.difficultyRank}
                    className="rounded-[18px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3.5 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-[var(--fg-text)]">Difficulty {item.difficultyRank}</p>
                      <p className="text-xs text-[var(--fg-muted)]">{item.focusScore}% focus score</p>
                    </div>
                    <p className="mt-1 text-xs text-[var(--fg-muted)]">
                      {formatMinutes(item.productiveMinutes)} productive · {formatMinutes(item.distractedMinutes)} distracted · {item.sessions} session{item.sessions === 1 ? '' : 's'}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="fg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--fg-text)]">Recent sessions</h3>
            <InfoTip text="Override tag or difficulty here when Window inferred the wrong classification." />
          </div>
          <div className="space-y-3">
            {recentSessions.length === 0 ? (
              <EmptyCard text="No focus sessions recorded yet." />
            ) : (
              recentSessions.map((session) => (
                <SessionAnalyticsRow
                  key={session.id}
                  session={session}
                  taskTags={taskTags}
                  onSaveOverride={onSaveOverride}
                />
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function AnalyticsMetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="rounded-[18px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3.5 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--fg-muted)]">{label}</p>
      <p className="mt-1.5 text-xl font-semibold tracking-[-0.03em] text-[var(--fg-text)]">{value}</p>
    </div>
  );
}

function ConsumptionTimelineChart({
  points,
}: {
  points: ConsumptionTimelinePoint[];
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const max = Math.max(
    0,
    ...points.map((point) =>
      Math.max(point.productiveMinutes, point.supportiveMinutes, point.distractedMinutes),
    ),
  );

  if (points.length === 0 || max <= 0) {
    return <EmptyCard text="No page-level consumption has been recorded yet." />;
  }

  const chartWidth = 560;
  const chartHeight = 180;
  const paddingX = 14;
  const paddingY = 18;
  const effectiveIndex = hoverIndex ?? selectedIndex;
  const effectivePoint = effectiveIndex == null ? null : points[effectiveIndex] ?? null;
  const tickEvery = points.length <= 14 ? 1 : points.length <= 60 ? 7 : points.length <= 120 ? 14 : 30;

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="relative rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-3"
        onMouseLeave={() => setHoverIndex(null)}
      >
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="h-[180px] w-full"
          onMouseMove={(event) => {
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return;
            const x = event.clientX - rect.left;
            const innerWidth = rect.width;
            if (innerWidth <= 0) return;
            const index = Math.round((x / innerWidth) * (points.length - 1));
            setHoverIndex(Math.max(0, Math.min(points.length - 1, index)));
          }}
          onClick={() => {
            if (hoverIndex == null) return;
            setSelectedIndex(hoverIndex);
          }}
        >
          {points.map((point, index) => {
            const x = chartX(index, points.length, chartWidth, paddingX);
            return (
              <line
                key={point.date}
                x1={x}
                x2={x}
                y1={paddingY}
                y2={chartHeight - paddingY}
                stroke={index === points.length - 1 ? 'rgba(37,99,235,0.16)' : 'rgba(148,163,184,0.18)'}
                strokeDasharray="3 6"
              />
            );
          })}
          {effectiveIndex != null ? (
            <line
              x1={chartX(effectiveIndex, points.length, chartWidth, paddingX)}
              x2={chartX(effectiveIndex, points.length, chartWidth, paddingX)}
              y1={paddingY}
              y2={chartHeight - paddingY}
              stroke="rgba(37,99,235,0.28)"
              strokeWidth="2"
            />
          ) : null}
          <path d={buildLinePath(points, (point) => point.productiveMinutes, max, chartWidth, chartHeight, paddingX, paddingY)} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <path d={buildLinePath(points, (point) => point.supportiveMinutes, max, chartWidth, chartHeight, paddingX, paddingY)} fill="none" stroke="#0f766e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d={buildLinePath(points, (point) => point.distractedMinutes, max, chartWidth, chartHeight, paddingX, paddingY)} fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((point, index) => (
            <circle
              key={`${point.date}-productive`}
              cx={chartX(index, points.length, chartWidth, paddingX)}
              cy={chartY(point.productiveMinutes, max, chartHeight, paddingY)}
              r="3.5"
              fill="#2563eb"
            />
          ))}
        </svg>

        {effectivePoint ? (
          <div className="pointer-events-none absolute right-3 top-3 w-[240px] rounded-md border border-[var(--fg-border)] bg-white px-3 py-2 text-xs text-[var(--fg-text)] shadow-sm">
            <p className="font-medium">
              {new Date(effectivePoint.date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
              <span className="font-normal text-[var(--fg-muted)]">· {formatMinutes(effectivePoint.totalMinutes)} total</span>
            </p>
            <div className="mt-1 space-y-0.5 text-[var(--fg-muted)]">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: '#2563eb' }} />Productive</span>
                <span className="font-medium text-[var(--fg-text)]">{formatMinutes(effectivePoint.productiveMinutes)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: '#0f766e' }} />Supportive</span>
                <span className="font-medium text-[var(--fg-text)]">{formatMinutes(effectivePoint.supportiveMinutes)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: '#dc2626' }} />Distracted</span>
                <span className="font-medium text-[var(--fg-text)]">{formatMinutes(effectivePoint.distractedMinutes)}</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3 text-xs text-[var(--fg-muted)]">
          <ChartLegend color="#2563eb" label="Productive" />
          <ChartLegend color="#0f766e" label="Supportive" />
          <ChartLegend color="#dc2626" label="Distracted" />
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-[var(--fg-muted)]">
          {points.map((point, index) => {
            if (index % tickEvery !== 0 && index !== points.length - 1) return null;
            return (
              <span key={point.date}>
                {point.label} {formatMinutes(point.totalMinutes)}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ConsumptionBreakdownList({
  items,
}: {
  items: AnalyticsSnapshot['domainBreakdown7d'];
}): React.JSX.Element {
  const max = Math.max(0, ...items.map((item) => item.totalMinutes));

  if (items.length === 0) {
    return <EmptyCard text="No domains have been tracked yet." />;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.domain} className="rounded-[18px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3.5 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--fg-text)]">{item.label}</p>
              <p className="mt-1 text-xs text-[var(--fg-muted)]">
                {item.visits} visit{item.visits === 1 ? '' : 's'} · {humanizeActivityClass(item.primaryActivityClass)}
              </p>
            </div>
            <span className="text-xs font-medium text-[var(--fg-muted)]">{formatMinutes(item.totalMinutes)}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
            <div
              className={`h-full rounded-full ${activityBarClass(item.primaryActivityClass)}`}
              style={{ width: `${max > 0 ? (item.totalMinutes / max) * 100 : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ConsumptionTreeView({
  nodes,
}: {
  nodes: AnalyticsSnapshot['consumptionTree7d'];
}): React.JSX.Element {
  const max = Math.max(0, ...nodes.map((node) => node.totalMinutes));

  if (nodes.length === 0) {
    return <EmptyCard text="The domain tree will appear once page telemetry accumulates." />;
  }

  return (
    <div className="space-y-1">
      {nodes.map((node) => (
        <ConsumptionTreeNodeRow key={node.id} node={node} max={max} />
      ))}
    </div>
  );
}

function ConsumptionTreeNodeRow({
  node,
  max,
}: {
  node: AnalyticsSnapshot['consumptionTree7d'][number];
  max: number;
}): React.JSX.Element {
  const activityClass = dominantTreeActivityClass(node);

  return (
    <div className="space-y-1">
      <div
        className="grid grid-cols-[minmax(0,1fr),84px] items-center gap-3 border-b border-[var(--fg-border)] py-2 last:border-b-0"
        style={{ paddingLeft: `${node.depth * 14}px` }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${activityBarClass(activityClass)}`} />
            <p className="truncate text-sm font-medium text-[var(--fg-text)]">{node.label}</p>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--fg-panel-soft)]">
            <div
              className={`h-full rounded-full ${activityBarClass(activityClass)}`}
              style={{ width: `${max > 0 ? (node.totalMinutes / max) * 100 : 0}%` }}
            />
          </div>
        </div>
        <span className="text-right text-xs text-[var(--fg-muted)]">{formatMinutes(node.totalMinutes)}</span>
      </div>
      {node.children.slice(0, 4).map((child) => (
        <ConsumptionTreeNodeRow key={child.id} node={child} max={max} />
      ))}
    </div>
  );
}

function ChartLegend({
  color,
  label,
}: {
  color: string;
  label: string;
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function SessionAnalyticsRow({
  session,
  taskTags,
  onSaveOverride,
}: {
  session: FocusSessionRecord;
  taskTags: TaskTag[];
  onSaveOverride: (
    focusSessionId: string,
    tagKey: string | null,
    difficultyRank: DifficultyRank | null,
  ) => void;
}): React.JSX.Element {
  const [tagKey, setTagKey] = useState(session.tagKey ?? '');
  const [difficulty, setDifficulty] = useState(session.difficultyRank ? String(session.difficultyRank) : '');

  useEffect(() => {
    setTagKey(session.tagKey ?? '');
    setDifficulty(session.difficultyRank ? String(session.difficultyRank) : '');
  }, [session.difficultyRank, session.id, session.tagKey]);

  return (
    <div className="rounded-md border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--fg-text)]">{session.eventTitle}</p>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            {formatSessionRange(session)} · {formatMinutes(session.productiveMinutes)} productive · {formatMinutes(session.distractedMinutes)} distracted
          </p>
        </div>
        {session.leftEarly ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-800">
            Left early
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr),140px,120px]">
        <select
          value={tagKey}
          onChange={(event) => setTagKey(event.target.value)}
          className="fg-select"
        >
          <option value="">No tag</option>
          {getSelectableTaskTags(taskTags, [tagKey]).map((tag) => (
            <option key={tag.key} value={tag.key}>
              {tag.label}
            </option>
          ))}
        </select>

        <select
          value={difficulty}
          onChange={(event) => setDifficulty(event.target.value)}
          className="fg-select"
        >
          <option value="">Auto</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="5">5</option>
          <option value="8">8</option>
        </select>

        <button
          onClick={() => onSaveOverride(session.id, tagKey || null, parseDifficultyRank(difficulty))}
          className="fg-button-secondary px-3 py-2 text-sm"
        >
          Save
        </button>
      </div>
    </div>
  );
}
