import React, { useState } from 'react';
import InfoTip from './InfoTip';

export default function SettingsGroup({
  title,
  subtitle,
  hint,
  actions,
  collapsible = false,
  defaultOpen = true,
  className = '',
  bodyClassName = 'mt-3 space-y-2.5',
  children,
}: {
  title: string;
  subtitle?: string;
  hint?: string;
  actions?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const visible = collapsible ? open : true;

  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--fg-text)]">{title}</h2>
            {hint ? <InfoTip text={hint} /> : null}
          </div>
          {subtitle ? (
            <p className="mt-0.5 text-xs leading-5 text-[var(--fg-muted)]">{subtitle}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {collapsible ? (
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              className="fg-button-ghost px-3 py-1.5 text-xs"
            >
              {visible ? 'Hide' : 'Show'}
            </button>
          ) : null}
        </div>
      </div>

      {visible ? (
        <div className={bodyClassName}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
