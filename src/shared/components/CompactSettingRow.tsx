import React from 'react';
import InfoTip from './InfoTip';

export default function CompactSettingRow({
  label,
  hint,
  value,
  meta,
  control,
  footer,
  className = '',
}: {
  label: string;
  hint?: string;
  value?: React.ReactNode;
  meta?: React.ReactNode;
  control?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={`rounded-[22px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3.5 py-3 ${className}`}>
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--fg-muted)]">
              {label}
            </p>
            {hint ? <InfoTip text={hint} /> : null}
          </div>
          {value ? (
            <p className="mt-1 truncate text-sm font-semibold leading-5 text-[var(--fg-text)]">
              {value}
            </p>
          ) : null}
          {meta ? (
            <p className="mt-0.5 text-[11px] leading-4 text-[var(--fg-muted)]">
              {meta}
            </p>
          ) : null}
        </div>

        {control ? (
          <div className="shrink-0 self-start sm:self-center">
            {control}
          </div>
        ) : null}
      </div>

      {footer ? (
        <div className="mt-3 border-t border-[var(--fg-border)] pt-3">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
