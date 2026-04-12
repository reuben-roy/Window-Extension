import React, { useState } from 'react';
import type { CalendarState } from '../../shared/types';

interface Props {
  calendarState: CalendarState;
  onStateChange: () => void;
}

/**
 * Calendar connection status + connect/disconnect button.
 *
 * Three visual states:
 *   1. Not connected (no lastSyncedAt AND authError or first launch)
 *      → green "Connect Calendar" button
 *   2. Connected (lastSyncedAt is set, no authError)
 *      → green dot + "Connected" + "Disconnect" link
 *   3. Auth error (authError is set)
 *      → red error banner + "Reconnect" button
 */
export default function CalendarConnect({
  calendarState,
  onStateChange,
}: Props): React.JSX.Element {
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { lastSyncedAt, authError } = calendarState;
  const isConnected = lastSyncedAt !== null && authError === null;
  // If the user has NEVER successfully connected (lastSyncedAt is null), always
  // show the first-launch "Connect" screen — even if the background tick already
  // set authError by trying (and failing) a silent token fetch. The "Reconnect"
  // error state is only for users who WERE connected and lost their token.
  const neverConnected = lastSyncedAt === null;
  const hasError = !neverConnected && authError !== null;

  // ── Connect ───────────────────────────────────────────────────────────────

  const handleConnect = () => {
    setConnecting(true);
    setError(null);
    chrome.runtime.sendMessage(
      { type: 'CONNECT_CALENDAR' },
      (response: { ok: boolean; error?: string }) => {
        setConnecting(false);
        if (response?.ok) {
          onStateChange();
        } else {
          setError(response?.error ?? 'Connection failed');
        }
      },
    );
  };

  // ── Disconnect ────────────────────────────────────────────────────────────

  const handleDisconnect = () => {
    setDisconnecting(true);
    chrome.runtime.sendMessage(
      { type: 'DISCONNECT_CALENDAR' },
      () => {
        setDisconnecting(false);
        onStateChange();
      },
    );
  };

  // ── Never connected: show the initial connect CTA ──────────────────────────
  if (neverConnected) {
    return (
      <div className="rounded-xl bg-blue-50 border border-blue-100 px-3 py-3">
        <p className="text-xs font-semibold text-blue-800 mb-1">
          Connect your Google Calendar
        </p>
        <p className="text-[10px] text-blue-600 leading-relaxed mb-2.5">
          Window reads your calendar to know when to block distracting websites.
          No events are modified — only read access is requested.
        </p>
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="w-full py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {connecting ? 'Connecting…' : 'Connect Calendar'}
        </button>
        {error && <p className="text-[10px] text-red-500 mt-1.5">{error}</p>}
      </div>
    );
  }

  // ── Auth error: was connected, token expired or revoked ────────────────────
  if (hasError) {
    return (
      <div className="rounded-xl bg-red-50 border border-red-100 px-3 py-2.5">
        <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wide mb-0.5">
          Calendar disconnected
        </p>
        <p className="text-xs text-red-600 leading-relaxed mb-2">
          {authError}
        </p>
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="w-full py-1.5 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          {connecting ? 'Reconnecting…' : 'Reconnect Calendar'}
        </button>
        {error && <p className="text-[10px] text-red-500 mt-1.5">{error}</p>}
      </div>
    );
  }

  // ── Connected: show status + optional disconnect ──────────────────────────
  if (isConnected) {
    const syncedAgo = formatSyncedAgo(lastSyncedAt);
    return (
      <div className="flex items-center justify-between px-1 py-0.5">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
          <span className="text-[10px] text-gray-500">
            Calendar connected{syncedAgo ? ` · synced ${syncedAgo}` : ''}
          </span>
        </div>
        <button
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="text-[10px] text-gray-400 hover:text-red-500 transition-colors"
        >
          {disconnecting ? '…' : 'Disconnect'}
        </button>
      </div>
    );
  }

  return <></>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSyncedAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hr ago';
  return `${hours} hrs ago`;
}
