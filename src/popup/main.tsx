import React from 'react';
import { createRoot } from 'react-dom/client';
import '../assets/styles/index.css';
import Popup from './Popup';

class PopupErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    console.error('[Window popup] render failure', error);
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="flex min-h-[420px] items-center justify-center bg-[var(--fg-bg)] p-4">
          <div className="fg-card w-full p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-600">
              Window popup error
            </p>
            <p className="mt-2 text-base font-semibold tracking-[-0.02em] text-[var(--fg-text)]">
              The popup failed to render
            </p>
            <p className="mt-2 text-xs text-[var(--fg-muted)]">
              {this.state.error.message}
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <PopupErrorBoundary>
      <Popup />
    </PopupErrorBoundary>
  </React.StrictMode>,
);
