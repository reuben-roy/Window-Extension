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
  const hasValue = value !== undefined && value !== null;
  const hasMeta = meta !== undefined && meta !== null;
  const hasFooter = footer !== undefined && footer !== null;
  const hasDetail = hasValue || hasMeta;

  return (
    <div className={`h-full py-1.5 ${className}`}>
      <div
        className={`flex min-w-0 gap-2 ${
          control
            ? hasDetail
              ? 'flex-row items-start justify-between'
              : 'flex-row items-center justify-between'
            : 'flex-col gap-0.5'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-[11px] font-medium uppercase leading-tight tracking-wide text-[var(--fg-muted)]">
              {label}
            </p>
            {hint ? <InfoTip text={hint} /> : null}
          </div>
          {hasValue ? (
            <p className="mt-0.5 truncate text-xs font-semibold leading-tight text-[var(--fg-text)]">
              {value}
            </p>
          ) : null}
          {hasMeta ? (
            <p className="mt-0.5 text-[11px] leading-snug text-[var(--fg-muted)]">{meta}</p>
          ) : null}
        </div>

        {control ? (
          <div
            className={`shrink-0 ${hasDetail ? 'pt-0.5' : ''} ${
              hasDetail ? 'self-start' : 'self-center'
            }`}
          >
            {control}
          </div>
        ) : null}
      </div>

      {hasFooter ? (
        <div className="mt-2 border-t border-[var(--fg-border)] pt-2">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
