import React from 'react';

export function EmptyCard({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="rounded-md border border-dashed border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-5 text-sm text-[var(--fg-muted)]">
      {text}
    </div>
  );
}
