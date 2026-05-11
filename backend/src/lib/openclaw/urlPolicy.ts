import { isIP } from 'node:net';
import type { OpenClawFetchMode } from '../../env.js';

function isMetadataOrLinkLocalIpv4(parts: readonly number[]): boolean {
  const [a, b] = parts;
  return (a === 169 && b === 254) || a === 0;
}

/** CGNAT — often Tailscale IPs when using IP literals instead of DNS. */
function isSharedAddressSpace(parts: readonly number[]): boolean {
  const [a, b] = parts;
  return a === 100 && b >= 64 && b <= 127;
}

function parseIpv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (!nums.every((p) => Number.isInteger(p) && p >= 0 && p <= 255)) {
    return null;
  }
  return nums;
}

function isLoopbackOrPrivateIpv4(parts: readonly number[]): boolean {
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return a === 192 && b === 168;
}

function ipv6IsLoopbackOrPrivate(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === '::1' ||
    h.startsWith('fc') ||
    h.startsWith('fd') ||
    h.startsWith('fe80:')
  );
}

function hostMatchesAllowedSuffix(hostnameLower: string, suffixes: string[]): boolean {
  return suffixes.some((raw) => {
    let suf = raw.trim().toLowerCase();
    if (!suf) return false;
    if (suf.startsWith('.')) suf = suf.slice(1);
    return hostnameLower === suf || hostnameLower.endsWith(`.${suf}`);
  });
}

/** Parse user input into a WHATWG URL; prepends https? if missing scheme. */
export function coerceOpenClawBaseUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Base URL is empty.');
  }

  try {
    const withScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//u.test(trimmed)
      ? trimmed
      : `http://${trimmed}`;
    return new URL(withScheme);
  } catch {
    throw new Error('Base URL is not a valid URL.');
  }
}

export function normalizedOpenClawOrigin(url: URL): string {
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('OpenClaw base URL must not include a path (use scheme, host, and port only).');
  }
  url.hash = '';
  url.search = '';
  return url.origin.replace(/\/+$/u, '');
}

/** Always blocked — SSRF/metadata risk even in permissive mode. */
function assertNotBlockedMetadataIpv4(parts: readonly number[]): void {
  if (isMetadataOrLinkLocalIpv4(parts)) {
    throw new Error('That host or IP address is blocked for safety.');
  }
}

export function assertOpenClawUrlAllowed(
  url: URL,
  mode: OpenClawFetchMode,
  allowedHostSuffixes: string[],
): void {
  const protocol = url.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed.');
  }

  const host = url.hostname;
  if (!host) {
    throw new Error('Hostname is missing.');
  }

  const ipKind = isIP(host);

  if (ipKind === 4) {
    const parts = parseIpv4(host);
    if (!parts) {
      throw new Error('Invalid IPv4 literal.');
    }
    assertNotBlockedMetadataIpv4(parts);
    if (isLoopbackOrPrivateIpv4(parts) || isSharedAddressSpace(parts)) {
      if (mode === 'strict') {
        throw new Error(
          'This IP address is not allowed while the backend is running in strict OpenClaw URL mode.',
        );
      }
      return;
    }
    return;
  }

  if (ipKind === 6) {
    if (ipv6IsLoopbackOrPrivate(host)) {
      if (mode === 'strict') {
        throw new Error(
          'This IPv6 address is not allowed while the backend is running in strict OpenClaw URL mode.',
        );
      }
    }
    return;
  }

  const hostLower = host.toLowerCase();

  if (hostLower === 'localhost') {
    if (mode === 'strict') {
      throw new Error(
        'localhost is not allowed while the backend is running in strict OpenClaw URL mode.',
      );
    }
    return;
  }

  if (mode === 'strict' && allowedHostSuffixes.length > 0) {
    if (!hostMatchesAllowedSuffix(hostLower, allowedHostSuffixes)) {
      throw new Error(
        'This hostname does not match an allowed suffix configured on the Window server.',
      );
    }
    return;
  }

  if (mode === 'strict' && allowedHostSuffixes.length === 0 && !hostLower.includes('.')) {
    throw new Error(
      'Strict mode requires a fully qualified hostname (for example *.ts.net) unless OPENCLAW_ALLOWED_HOST_SUFFIXES is set.',
    );
  }
}
