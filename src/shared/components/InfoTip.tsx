import React, { useId, useState } from 'react';

export default function InfoTip({
  text,
  className = '',
}: {
  text: string;
  className?: string;
}): React.JSX.Element {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        aria-label={text}
        aria-describedby={open ? tooltipId : undefined}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-[var(--fg-border)] bg-[rgba(255,255,255,0.92)] text-[10px] font-semibold text-[var(--fg-muted)] transition hover:border-[rgba(15,23,42,0.18)] hover:text-[var(--fg-text)]"
      >
        ?
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className={`pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-30 w-[220px] -translate-x-1/2 rounded-[14px] border border-[rgba(15,23,42,0.08)] bg-[rgba(15,23,42,0.96)] px-3 py-2 text-[11px] leading-4 text-white shadow-[0_18px_44px_rgba(15,23,42,0.22)] transition duration-150 ${
          open ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
        }`}
      >
        {text}
      </span>
    </span>
  );
}
