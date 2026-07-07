import React, { useEffect } from 'react';
import type { ExtendedTaskLibraryEntry } from '../../shared/types';
import type { ExtendedTaskListPreview } from '../lib';

export function ExtendedTaskListPreviewModal({
  preview,
  onClose,
}: {
  preview: ExtendedTaskListPreview | null;
  onClose: () => void;
}): React.JSX.Element | null {
  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [preview, onClose]);

  if (!preview) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-[rgba(9,14,30,0.14)] backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="extended-task-list-preview-title"
        className="fixed left-1/2 top-1/2 z-[70] w-[min(440px,calc(100vw-28px))] max-h-[min(520px,calc(100vh-40px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-white/80 bg-[rgba(255,255,255,0.98)] shadow-2xl ring-1 ring-[rgba(148,163,184,0.12)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--fg-border)] px-4 py-3">
          <div className="min-w-0">
            <h3 id="extended-task-list-preview-title" className="text-sm font-semibold text-[var(--fg-text)]">
              {preview.title}
            </h3>
            {preview.subtitle ? (
              <p className="mt-0.5 text-xs text-[var(--fg-muted)]">{preview.subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 rounded-full border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-1.5 text-xs font-medium text-[var(--fg-muted)] transition hover:bg-white hover:text-[var(--fg-text)]"
          >
            Close
          </button>
        </div>
        <ul className="max-h-[min(420px,calc(100vh-120px))] space-y-0 overflow-y-auto px-2 py-2">
          {preview.rows.map((row, index) => (
            <li
              key={row.id}
              className="flex items-start justify-between gap-2 rounded-md px-2 py-1.5 text-xs leading-snug text-[var(--fg-text)] hover:bg-[var(--fg-panel-soft)]"
            >
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-[var(--fg-muted)]">{index + 1}.</span> {row.label}
              </span>
              {row.url ? (
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-shrink-0 font-medium text-[var(--fg-accent)]"
                  onClick={(event) => event.stopPropagation()}
                >
                  Open
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

export function ExtendedTaskDragGrip({
  onDragStart,
  onDragEnd,
}: {
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}): React.JSX.Element {
  const dots = [
    [3, 3],
    [11, 3],
    [3, 9],
    [11, 9],
    [3, 15],
    [11, 15],
  ] as const;
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="mt-0.5 inline-flex cursor-grab select-none items-center justify-center rounded-md p-1 text-[var(--fg-muted)] active:cursor-grabbing"
      title="Drag onto a calendar occurrence"
      aria-label="Drag onto a calendar occurrence"
    >
      <svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true">
        {dots.map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="2" fill="currentColor" />
        ))}
      </svg>
    </div>
  );
}

export function ExtendedTaskLibraryCard({
  entry,
  dragging,
  canApply,
  applyLabel,
  className,
  onApply,
  onDragStart,
  onDragEnd,
  onDuplicate,
  onEdit,
  onDelete,
  onPreviewAllItems,
}: {
  entry: ExtendedTaskLibraryEntry;
  dragging: boolean;
  canApply: boolean;
  applyLabel: string;
  className?: string;
  onApply?: () => void;
  onDragStart: (entry: ExtendedTaskLibraryEntry, event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDuplicate?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPreviewAllItems?: (entry: ExtendedTaskLibraryEntry) => void;
}): React.JSX.Element {
  return (
    <div
      className={`${className ?? ''} rounded-md border px-3 py-2.5 transition ${
        dragging
          ? 'border-blue-300 bg-blue-50/70'
          : 'border-[var(--fg-border)] bg-[var(--fg-panel-soft)] hover:border-blue-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <ExtendedTaskDragGrip
            onDragStart={(event) => onDragStart(entry, event)}
            onDragEnd={onDragEnd}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium text-[var(--fg-text)]">{entry.title}</p>
              <span className="rounded-full border border-[var(--fg-border)] bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
                {entry.source === 'built-in' ? 'Default' : 'Editable'}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
              {entry.items.length} link{entry.items.length === 1 ? '' : 's'} · drag onto a calendar occurrence
            </p>
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
          {canApply && onApply ? (
            <button onClick={onApply} className="fg-button-secondary px-3 py-1.5 text-[11px]">
              {applyLabel}
            </button>
          ) : null}
          {entry.source === 'built-in' && onDuplicate ? (
            <button onClick={onDuplicate} className="fg-button-ghost px-3 py-1.5 text-[11px]">
              Duplicate
            </button>
          ) : null}
          {entry.source === 'user' && onEdit ? (
            <button onClick={onEdit} className="fg-button-ghost px-3 py-1.5 text-[11px]">
              Edit
            </button>
          ) : null}
          {entry.source === 'user' && onDelete ? (
            <button onClick={onDelete} className="fg-button-ghost px-3 py-1.5 text-[11px] text-rose-600">
              Delete
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 space-y-1">
        {entry.items.slice(0, 3).map((item, index) => (
          <p key={item.id} className="truncate text-xs text-[var(--fg-muted)]">
            {index + 1}. {item.label}
          </p>
        ))}
        {entry.items.length > 3 && onPreviewAllItems ? (
          <button
            type="button"
            title="View full link list"
            aria-label={`View all ${entry.items.length} links in this set`}
            onClick={() => onPreviewAllItems(entry)}
            className="text-left text-xs font-medium text-[var(--fg-accent)] underline decoration-[var(--fg-accent)]/40 underline-offset-2 transition hover:decoration-[var(--fg-accent)]"
          >
            +{entry.items.length - 3} more
          </button>
        ) : entry.items.length > 3 ? (
          <p className="text-xs text-[var(--fg-muted)]">+{entry.items.length - 3} more</p>
        ) : null}
      </div>
    </div>
  );
}
