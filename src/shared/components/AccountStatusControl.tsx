import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AccountConflict,
  AccountSyncState,
  AccountUser,
  CalendarState,
} from '../types';

export default function AccountStatusControl({
  accountUser,
  accountSyncState,
  accountConflict,
  calendarState,
  onSignIn,
  onRefresh,
  onSignOut,
  onResolveConflict,
  onConnectCalendar,
  onDisconnectCalendar,
}: {
  accountUser: AccountUser | null;
  accountSyncState: AccountSyncState;
  accountConflict: AccountConflict | null;
  calendarState: CalendarState;
  onSignIn: () => Promise<unknown>;
  onRefresh: () => Promise<unknown> | void;
  onSignOut: () => Promise<unknown>;
  onResolveConflict: (choice: 'local' | 'remote') => Promise<unknown>;
  onConnectCalendar: () => Promise<unknown>;
  onDisconnectCalendar: () => Promise<unknown>;
}): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!accountUser) {
      setMenuOpen(false);
    }
  }, [accountUser]);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const syncLabel = useMemo(() => {
    if (accountConflict) return 'Sync conflict';
    if (accountSyncState.lastError) return accountSyncState.lastError;
    if (accountSyncState.lastSyncedAt) {
      return `Synced ${formatRelativeTime(accountSyncState.lastSyncedAt)}`;
    }
    if (accountUser) return 'Connected';
    return 'Sync points and rules';
  }, [accountConflict, accountSyncState.lastError, accountSyncState.lastSyncedAt, accountUser]);

  const calendarSection = useMemo(
    () => getCalendarSectionState(calendarState),
    [calendarState],
  );
  const displayName = accountUser?.displayName?.trim() || accountUser?.email || 'Google account';
  const secondaryIdentity =
    accountUser?.displayName && accountUser.email ? accountUser.email : null;
  const anchorStatusClass = accountConflict
    ? 'bg-amber-400'
    : accountSyncState.lastError
      ? 'bg-rose-500'
      : 'bg-emerald-500';

  const runAction = async (
    key: string,
    action: () => Promise<unknown>,
    options: { closeMenu?: boolean } = {},
  ) => {
    setBusyAction(key);
    setError(null);
    try {
      await action();
      if (options.closeMenu) {
        setMenuOpen(false);
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusyAction(null);
    }
  };

  if (!accountUser) {
    return (
      <div ref={rootRef} className="relative flex flex-col items-end gap-2">
        <button
          onClick={() => void runAction('google', onSignIn)}
          disabled={busyAction !== null}
          className="fg-button-primary whitespace-nowrap px-4 py-2.5 text-sm"
        >
          {busyAction === 'google' ? 'Opening…' : 'Sign in with Google'}
        </button>

        <div className="rounded-full border border-[var(--fg-border)] bg-white/90 px-3 py-2 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-[11px] font-medium text-[var(--fg-text)]">Google Calendar</p>
              <p
                className={`text-[10px] ${
                  calendarSection.tone === 'error'
                    ? 'text-rose-600'
                    : calendarSection.tone === 'connected'
                      ? 'text-emerald-700'
                      : 'text-[var(--fg-muted)]'
                }`}
              >
                {calendarSection.detail}
              </p>
            </div>
            <CalendarServiceRow
              state={calendarSection}
              compact
              busyAction={busyAction}
              onConnectCalendar={() => runAction('calendar-connect', onConnectCalendar)}
              onDisconnectCalendar={() => runAction('calendar-disconnect', onDisconnectCalendar)}
            />
          </div>
        </div>

        {error && <p className="max-w-[260px] text-right text-xs text-rose-600">{error}</p>}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => {
          setMenuOpen((current) => !current);
          setError(null);
        }}
        className="relative flex h-11 w-11 items-center justify-center rounded-full border border-[var(--fg-border)] bg-white shadow-sm transition hover:shadow-md"
        aria-label="Open account menu"
        title={accountConflict ? 'Account sync conflict' : syncLabel}
      >
        <AccountAvatar
          displayName={accountUser.displayName}
          email={accountUser.email}
          avatarUrl={accountUser.avatarUrl}
          sizeClassName="h-9 w-9"
          textClassName="text-sm font-semibold"
        />
        <span
          className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white ${anchorStatusClass}`}
        />
      </button>

      {menuOpen && (
        <div className="absolute right-0 z-30 mt-3 w-[min(340px,calc(100vw-2rem))] rounded-[28px] border border-[var(--fg-border)] bg-white p-4 shadow-[0_24px_60px_rgba(15,23,42,0.16)]">
          <div className="flex items-start gap-3">
            <AccountAvatar
              displayName={accountUser.displayName}
              email={accountUser.email}
              avatarUrl={accountUser.avatarUrl}
              sizeClassName="h-12 w-12"
              textClassName="text-base font-semibold"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[var(--fg-text)]">{displayName}</p>
              {secondaryIdentity && (
                <p className="truncate text-xs text-[var(--fg-muted)]">{secondaryIdentity}</p>
              )}
              <p
                className={`mt-1 text-xs ${
                  accountConflict
                    ? 'text-amber-700'
                    : accountSyncState.lastError
                      ? 'text-rose-600'
                      : 'text-[var(--fg-muted)]'
                }`}
              >
                {syncLabel}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-[20px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[var(--fg-text)]">Google Calendar</p>
                <p
                  className={`text-xs ${
                    calendarSection.tone === 'error'
                      ? 'text-rose-600'
                      : calendarSection.tone === 'connected'
                        ? 'text-emerald-700'
                        : 'text-[var(--fg-muted)]'
                  }`}
                >
                  {calendarSection.detail}
                </p>
              </div>
              <CalendarServiceRow
                state={calendarSection}
                busyAction={busyAction}
                onConnectCalendar={() => runAction('calendar-connect', onConnectCalendar)}
                onDisconnectCalendar={() => runAction('calendar-disconnect', onDisconnectCalendar)}
              />
            </div>
            {calendarSection.description && (
              <p className="mt-2 text-xs leading-4 text-[var(--fg-muted)]">
                {calendarSection.description}
              </p>
            )}
          </div>

          {accountConflict && (
            <div className="mt-4 rounded-[20px] border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">Choose which data to keep</p>
              <p className="mt-1 text-xs leading-4 text-amber-800">
                Both this browser and your account already have data.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => void runAction('keep-local', () => onResolveConflict('local'))}
                  disabled={busyAction !== null}
                  className="fg-button-primary px-3 py-2 text-xs"
                >
                  {busyAction === 'keep-local' ? 'Saving…' : 'Use This Browser'}
                </button>
                <button
                  onClick={() => void runAction('keep-remote', () => onResolveConflict('remote'))}
                  disabled={busyAction !== null}
                  className="fg-button-secondary px-3 py-2 text-xs"
                >
                  {busyAction === 'keep-remote' ? 'Applying…' : 'Use Account Data'}
                </button>
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              onClick={() => void runAction('refresh', async () => { await Promise.resolve(onRefresh()); })}
              disabled={busyAction !== null}
              className="fg-button-ghost px-2.5 py-1.5 text-xs"
            >
              {busyAction === 'refresh' ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              onClick={() => void runAction('disconnect', onSignOut, { closeMenu: true })}
              disabled={busyAction !== null}
              className="fg-button-secondary px-3 py-2 text-xs"
            >
              {busyAction === 'disconnect' ? 'Signing out…' : 'Sign out'}
            </button>
          </div>

          {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
        </div>
      )}
    </div>
  );
}

function CalendarServiceRow({
  state,
  busyAction,
  compact = false,
  onConnectCalendar,
  onDisconnectCalendar,
}: {
  state: ReturnType<typeof getCalendarSectionState>;
  busyAction: string | null;
  compact?: boolean;
  onConnectCalendar: () => void;
  onDisconnectCalendar: () => void;
}): React.JSX.Element {
  if (state.kind === 'connected') {
    return compact ? (
      <button
        onClick={onDisconnectCalendar}
        disabled={busyAction !== null}
        className="text-xs font-medium text-[var(--fg-muted)] transition hover:text-rose-600"
      >
        {busyAction === 'calendar-disconnect' ? '…' : 'Disconnect'}
      </button>
    ) : (
      <button
        onClick={onDisconnectCalendar}
        disabled={busyAction !== null}
        className="fg-button-ghost px-2.5 py-1.5 text-xs"
      >
        {busyAction === 'calendar-disconnect' ? 'Disconnecting…' : 'Disconnect'}
      </button>
    );
  }

  if (state.kind === 'error') {
    return (
      <button
        onClick={onConnectCalendar}
        disabled={busyAction !== null}
        className={compact ? 'text-xs font-medium text-rose-600 transition hover:text-rose-700' : 'fg-button-secondary px-2.5 py-1.5 text-xs'}
      >
        {busyAction === 'calendar-connect' ? 'Reconnecting…' : 'Reconnect'}
      </button>
    );
  }

  return (
    <button
      onClick={onConnectCalendar}
      disabled={busyAction !== null}
      className={compact ? 'text-xs font-medium text-[var(--fg-accent)] transition hover:opacity-80' : 'fg-button-secondary px-2.5 py-1.5 text-xs'}
    >
      {busyAction === 'calendar-connect' ? 'Connecting…' : 'Connect'}
    </button>
  );
}

function AccountAvatar({
  displayName,
  email,
  avatarUrl,
  sizeClassName,
  textClassName,
}: {
  displayName: string | null | undefined;
  email: string | null | undefined;
  avatarUrl: string | null | undefined;
  sizeClassName: string;
  textClassName: string;
}): React.JSX.Element {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [avatarUrl]);

  if (avatarUrl && !imageFailed) {
    return (
      <img
        src={avatarUrl}
        alt={displayName ?? email ?? 'Account avatar'}
        className={`${sizeClassName} rounded-full object-cover`}
        referrerPolicy="no-referrer"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <div className={`${sizeClassName} flex items-center justify-center rounded-full bg-[var(--fg-panel-soft)] text-[var(--fg-accent)] ${textClassName}`}>
      {deriveInitials(displayName, email)}
    </div>
  );
}

function getCalendarSectionState(calendarState: CalendarState): {
  kind: 'connected' | 'error' | 'disconnected';
  tone: 'connected' | 'error' | 'muted';
  detail: string;
  description: string | null;
} {
  const { lastSyncedAt, authError } = calendarState;
  const connected = lastSyncedAt !== null && authError === null;
  const neverConnected = lastSyncedAt === null;

  if (connected) {
    return {
      kind: 'connected',
      tone: 'connected',
      detail: `Connected${lastSyncedAt ? ` · synced ${formatRelativeTime(lastSyncedAt)}` : ''}`,
      description: 'Calendar access stays separate from account sync.',
    };
  }

  if (!neverConnected && authError) {
    return {
      kind: 'error',
      tone: 'error',
      detail: 'Needs reconnect',
      description: authError,
    };
  }

  return {
    kind: 'disconnected',
    tone: 'muted',
    detail: 'Not connected',
    description: 'Reads your calendar to activate focus rules. No events are modified.',
  };
}

function deriveInitials(
  displayName: string | null | undefined,
  email: string | null | undefined,
): string {
  const source = displayName?.trim() || email?.trim() || '?';
  const words = source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (words.length === 0) return '?';
  if (words.length === 1) {
    return words[0].slice(0, 1).toUpperCase();
  }

  return words.map((word) => word.slice(0, 1).toUpperCase()).join('');
}

function formatRelativeTime(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
