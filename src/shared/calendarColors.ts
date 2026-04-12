export interface CalendarColorDefinition {
  background: string;
  foreground: string;
}

export type CalendarEventColorSource = 'google-event' | 'derived' | 'default';

export interface CalendarEventColors {
  googleColorId?: string;
  backgroundColor: string;
  foregroundColor: string;
  colorSource: CalendarEventColorSource;
  familyKey: string;
}

const DEFAULT_EVENT_COLOR: CalendarColorDefinition = {
  background: '#64748b',
  foreground: '#ffffff',
};

const DERIVED_EVENT_PALETTE: CalendarColorDefinition[] = [
  { background: '#7986cb', foreground: '#ffffff' },
  { background: '#33b679', foreground: '#ffffff' },
  { background: '#8e24aa', foreground: '#ffffff' },
  { background: '#e67c73', foreground: '#ffffff' },
  { background: '#f6bf26', foreground: '#ffffff' },
  { background: '#f4511e', foreground: '#ffffff' },
  { background: '#039be5', foreground: '#ffffff' },
  { background: '#616161', foreground: '#ffffff' },
];

const NOISE_TOKENS = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'from',
  'in',
  'of',
  'on',
  'the',
  'to',
  'with',
]);

export function normalizeEventTitleForColor(title: string): string {
  const normalized = title
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (!normalized) return '';

  const tokens = normalized
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .filter((token) => !NOISE_TOKENS.has(token))
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !/^\d{1,2}(am|pm)?$/.test(token))
    .filter((token) => token !== 'am' && token !== 'pm');

  if (tokens.length === 0) return '';
  return tokens.slice(0, 2).join(' ');
}

export function resolveCalendarEventColors(
  title: string,
  googleColorId?: string,
  googlePalette: Record<string, CalendarColorDefinition> = {},
): CalendarEventColors {
  if (googleColorId && googlePalette[googleColorId]) {
    return {
      googleColorId,
      backgroundColor: googlePalette[googleColorId].background,
      foregroundColor: googlePalette[googleColorId].foreground,
      colorSource: 'google-event',
      familyKey: normalizeEventTitleForColor(title),
    };
  }

  const familyKey = normalizeEventTitleForColor(title);
  if (!familyKey) {
    return {
      googleColorId,
      backgroundColor: DEFAULT_EVENT_COLOR.background,
      foregroundColor: DEFAULT_EVENT_COLOR.foreground,
      colorSource: 'default',
      familyKey: '',
    };
  }

  const derived = DERIVED_EVENT_PALETTE[hashString(familyKey) % DERIVED_EVENT_PALETTE.length];
  return {
    googleColorId,
    backgroundColor: derived.background,
    foregroundColor: derived.foreground,
    colorSource: 'derived',
    familyKey,
  };
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
