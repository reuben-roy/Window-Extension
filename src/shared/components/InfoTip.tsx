import React from 'react';

export default function InfoTip({
  text,
  className = '',
}: {
  text: string;
  className?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={text}
      aria-label={text}
      className={`inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--fg-border)] bg-white text-[10px] font-semibold text-[var(--fg-muted)] transition hover:text-[var(--fg-text)] ${className}`}
    >
      i
    </button>
  );
}
