import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDownloadAllowances } from '../src/shared/storage';

let background: typeof import('../src/background/index');

describe('download redirect allowances', () => {
  beforeAll(async () => {
    background = await import('../src/background/index');
    await Promise.resolve();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    chrome.storage.sync.clear();
    chrome.storage.local.clear();
  });

  it('creates a download allowance for a real download from an allowed source page using the download referrer', async () => {
    chrome.storage.sync.set({
      calendarState: {
        currentEvent: null,
        allActiveEvents: [],
        todaysEvents: [],
        activeProfile: 'Deep Work',
        activeRuleSource: 'event',
        activeRuleName: 'Deep Work',
        allowedDomains: ['github.com'],
        recentEventTitles: [],
        isRestricted: true,
        lastSyncedAt: '2026-04-15T20:00:00.000Z',
        authError: null,
      },
    });

    background.recordCommittedDocumentUrl(4, 'https://github.com/reubenroy/window-extension');

    await background.handleDownloadCreated({
      id: 11,
      url: 'https://redirect.example.com/file.zip',
      finalUrl: 'https://downloads.example.com/file.zip',
      referrer: 'https://github.com/reubenroy/window-extension',
    } as chrome.downloads.DownloadItem);

    const allowances = await getDownloadAllowances();
    const allowance = Object.values(allowances)[0];

    expect(allowance?.allowanceType).toBe('download');
    expect(allowance?.downloadId).toBe(11);
    expect(allowance?.tabId).toBe(4);
    expect(allowance?.targetHost).toBe('downloads.example.com');

    const sessionRuleCall = (chrome.declarativeNetRequest.updateSessionRules as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(sessionRuleCall?.addRules?.[0]?.condition?.urlFilter).toBe('||downloads.example.com');
  });

  it('starts a direct Chrome download for blocked file URLs before retrying the blocked navigation', async () => {
    chrome.storage.sync.set({
      settings: {
        downloadRedirectProgrammaticDownloadEnabled: true,
      },
      calendarState: {
        currentEvent: null,
        allActiveEvents: [],
        todaysEvents: [],
        activeProfile: 'Study',
        activeRuleSource: 'event',
        activeRuleName: 'Study',
        allowedDomains: ['canvas.instructure.com'],
        recentEventTitles: [],
        isRestricted: true,
        lastSyncedAt: '2026-04-15T20:00:00.000Z',
        authError: null,
      },
    });

    await background.handleBlockedDownloadRedirect(
      14,
      'https://canvas.instructure.com/courses/42/files/9001',
      'https://canvas.instructure.com/files/9001/download?download_frd=1&verifier=abc123',
    );

    expect(chrome.downloads.download).toHaveBeenCalledWith({
      url: 'https://canvas.instructure.com/files/9001/download?download_frd=1&verifier=abc123',
      saveAs: false,
    });
    expect(chrome.tabs.update).toHaveBeenCalledWith(14, {
      url: 'https://canvas.instructure.com/courses/42/files/9001',
    });
  });

  it('falls back to the temporary allowance path when direct download handoff fails', async () => {
    (chrome.downloads.download as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network failed'),
    );
    chrome.storage.sync.set({
      settings: {
        downloadRedirectProgrammaticDownloadEnabled: true,
      },
      calendarState: {
        currentEvent: null,
        allActiveEvents: [],
        todaysEvents: [],
        activeProfile: 'Study',
        activeRuleSource: 'event',
        activeRuleName: 'Study',
        allowedDomains: ['canvas.instructure.com'],
        recentEventTitles: [],
        isRestricted: true,
        lastSyncedAt: '2026-04-15T20:00:00.000Z',
        authError: null,
      },
    });

    await background.handleBlockedDownloadRedirect(
      15,
      'https://canvas.instructure.com/courses/42/files/9001',
      'https://canvas.instructure.com/files/9001/download?download_frd=1&verifier=abc123',
    );

    const allowances = await getDownloadAllowances();
    const allowance = Object.values(allowances)[0];
    expect(allowance?.allowanceType).toBe('fallback');
    expect(chrome.tabs.update).toHaveBeenCalledWith(15, {
      url: 'https://canvas.instructure.com/files/9001/download?download_frd=1&verifier=abc123',
    });
  });

  it('hydrates a source tab from stored URLs when the downloads API fires after worker sleep', async () => {
    chrome.storage.sync.set({
      calendarState: {
        currentEvent: null,
        allActiveEvents: [],
        todaysEvents: [],
        activeProfile: 'Deep Work',
        activeRuleSource: 'event',
        activeRuleName: 'Deep Work',
        allowedDomains: ['canvas.instructure.com'],
        recentEventTitles: [],
        isRestricted: true,
        lastSyncedAt: '2026-04-15T20:00:00.000Z',
        authError: null,
      },
    });
    chrome.storage.local.set({
      tabDocumentUrls: {
        '8': 'https://canvas.instructure.com/courses/42/files/9001',
      },
    });

    await background.handleDownloadCreated({
      id: 18,
      url: 'https://files.examplecdn.com/token/abc123/document.pdf',
      referrer: 'https://canvas.instructure.com/courses/42/files/9001',
    } as chrome.downloads.DownloadItem);

    const allowances = await getDownloadAllowances();
    const allowance = Object.values(allowances)[0];

    expect(allowance?.allowanceType).toBe('download');
    expect(allowance?.tabId).toBe(8);
  });

  it('respects the downloads API rescue toggle', async () => {
    chrome.storage.sync.set({
      settings: {
        downloadRedirectUseDownloadsApi: false,
      },
      calendarState: {
        currentEvent: null,
        allActiveEvents: [],
        todaysEvents: [],
        activeProfile: 'Deep Work',
        activeRuleSource: 'event',
        activeRuleName: 'Deep Work',
        allowedDomains: ['github.com'],
        recentEventTitles: [],
        isRestricted: true,
        lastSyncedAt: '2026-04-15T20:00:00.000Z',
        authError: null,
      },
    });

    background.recordCommittedDocumentUrl(4, 'https://github.com/reubenroy/window-extension');

    await background.handleDownloadCreated({
      id: 12,
      url: 'https://downloads.example.com/file.zip',
      referrer: 'https://github.com/reubenroy/window-extension',
    } as chrome.downloads.DownloadItem);

    expect(await getDownloadAllowances()).toEqual({});
  });

  it('treats Canvas-style file download URLs as fallback-eligible redirects', async () => {
    chrome.storage.sync.set({
      settings: {
        enableBlocking: true,
        blockPage: 'custom',
        carryoverMode: 'union',
        taskTTLDays: 7,
        monthlyResetEnabled: true,
        lastMonthlyReset: '2026-04-01T00:00:00.000Z',
        minBlockDurationMinutes: 15,
        breakDurationMinutes: 5,
        keywordAutoMatchEnabled: false,
        breakTelemetryEnabled: false,
        persistentPanelEnabled: false,
        dailyBlockingPauseEnabled: false,
        dailyBlockingPauseStartTime: '22:00',
        downloadRedirectFallbackSeconds: 2,
      },
      calendarState: {
        currentEvent: null,
        allActiveEvents: [],
        todaysEvents: [],
        activeProfile: 'Study',
        activeRuleSource: 'event',
        activeRuleName: 'Study',
        allowedDomains: ['canvas.instructure.com'],
        recentEventTitles: [],
        isRestricted: true,
        lastSyncedAt: '2026-04-15T20:00:00.000Z',
        authError: null,
      },
    });

    await background.maybeStartDownloadRedirectFallback(
      9,
      'https://canvas.instructure.com/courses/42/files/9001',
      'https://canvas.instructure.com/files/9001/download?download_frd=1&verifier=abc123',
    );

    const allowances = await getDownloadAllowances();
    const allowance = Object.values(allowances)[0];

    expect(allowance?.allowanceType).toBe('fallback');
    expect(allowance?.targetUrl).toContain('/files/9001/download');
  });

  it('can fall back on same-site redirects even when URL pattern matching is off', async () => {
    chrome.storage.sync.set({
      settings: {
        downloadRedirectFallbackPatternMatchEnabled: false,
        downloadRedirectFallbackSameHostEnabled: false,
        downloadRedirectFallbackSameSiteEnabled: true,
        downloadRedirectFallbackAnyAllowedRedirectEnabled: false,
      },
      calendarState: {
        currentEvent: null,
        allActiveEvents: [],
        todaysEvents: [],
        activeProfile: 'Study',
        activeRuleSource: 'event',
        activeRuleName: 'Study',
        allowedDomains: ['canvas.instructure.com'],
        recentEventTitles: [],
        isRestricted: true,
        lastSyncedAt: '2026-04-15T20:00:00.000Z',
        authError: null,
      },
    });

    await background.maybeStartDownloadRedirectFallback(
      9,
      'https://canvas.instructure.com/courses/42/files/9001',
      'https://files.instructure.com/token/abc123',
    );

    const allowances = await getDownloadAllowances();
    const allowance = Object.values(allowances)[0];
    expect(allowance?.allowanceType).toBe('fallback');
    expect(allowance?.targetHost).toBe('files.instructure.com');
  });

  it('can fall back for non-download-looking cross-site redirects when aggressive mode is enabled', async () => {
    chrome.storage.sync.set({
      settings: {
        downloadRedirectFallbackPatternMatchEnabled: false,
        downloadRedirectFallbackSameHostEnabled: false,
        downloadRedirectFallbackSameSiteEnabled: false,
        downloadRedirectFallbackAnyAllowedRedirectEnabled: true,
      },
      calendarState: {
        currentEvent: null,
        allActiveEvents: [],
        todaysEvents: [],
        activeProfile: 'Study',
        activeRuleSource: 'event',
        activeRuleName: 'Study',
        allowedDomains: ['canvas.instructure.com'],
        recentEventTitles: [],
        isRestricted: true,
        lastSyncedAt: '2026-04-15T20:00:00.000Z',
        authError: null,
      },
    });

    await background.maybeStartDownloadRedirectFallback(
      9,
      'https://canvas.instructure.com/courses/42/files/9001',
      'https://signed.cloudfront.net/tokens/abc123',
    );

    const allowances = await getDownloadAllowances();
    const allowance = Object.values(allowances)[0];
    expect(allowance?.allowanceType).toBe('fallback');
    expect(allowance?.targetHost).toBe('signed.cloudfront.net');
  });

  it('uses the configured fallback delay for blocked download redirects', async () => {
    chrome.storage.sync.set({
      settings: {
        enableBlocking: true,
        blockPage: 'custom',
        carryoverMode: 'union',
        taskTTLDays: 7,
        monthlyResetEnabled: true,
        lastMonthlyReset: '2026-04-01T00:00:00.000Z',
        minBlockDurationMinutes: 15,
        breakDurationMinutes: 5,
        keywordAutoMatchEnabled: false,
        breakTelemetryEnabled: false,
        persistentPanelEnabled: false,
        dailyBlockingPauseEnabled: false,
        dailyBlockingPauseStartTime: '22:00',
        downloadRedirectFallbackSeconds: 4,
      },
      calendarState: {
        currentEvent: null,
        allActiveEvents: [],
        todaysEvents: [],
        activeProfile: 'Deep Work',
        activeRuleSource: 'event',
        activeRuleName: 'Deep Work',
        allowedDomains: ['github.com'],
        recentEventTitles: [],
        isRestricted: true,
        lastSyncedAt: '2026-04-15T20:00:00.000Z',
        authError: null,
      },
    });

    const before = Date.now();
    await background.maybeStartDownloadRedirectFallback(
      7,
      'https://github.com/reubenroy/window-extension',
      'https://files.example.com/release.zip?download=1',
    );

    const allowances = await getDownloadAllowances();
    const allowance = Object.values(allowances)[0];

    expect(allowance?.allowanceType).toBe('fallback');
    expect(allowance?.tabId).toBe(7);
    expect(allowance?.targetHost).toBe('files.example.com');
    expect(new Date(allowance!.expiresAt).getTime() - before).toBeGreaterThanOrEqual(3_500);
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { url: 'https://files.example.com/release.zip?download=1' });
  });

  it('uses the stored tab document URL when the worker memory lost the source page', async () => {
    chrome.storage.sync.set({
      settings: {
        enableBlocking: true,
        blockPage: 'custom',
        carryoverMode: 'union',
        taskTTLDays: 7,
        monthlyResetEnabled: true,
        lastMonthlyReset: '2026-04-01T00:00:00.000Z',
        minBlockDurationMinutes: 15,
        breakDurationMinutes: 5,
        keywordAutoMatchEnabled: false,
        breakTelemetryEnabled: false,
        persistentPanelEnabled: false,
        dailyBlockingPauseEnabled: false,
        dailyBlockingPauseStartTime: '22:00',
        downloadRedirectFallbackSeconds: 2,
      },
      calendarState: {
        currentEvent: null,
        allActiveEvents: [],
        todaysEvents: [],
        activeProfile: 'Study',
        activeRuleSource: 'event',
        activeRuleName: 'Study',
        allowedDomains: ['canvas.instructure.com'],
        recentEventTitles: [],
        isRestricted: true,
        lastSyncedAt: '2026-04-15T20:00:00.000Z',
        authError: null,
      },
    });
    chrome.storage.local.set({
      tabDocumentUrls: {
        '12': 'https://canvas.instructure.com/courses/42/files/9001',
      },
    });

    await background.maybeStartDownloadRedirectFallback(
      12,
      null,
      'https://canvas.instructure.com/files/9001/download?download_frd=1&verifier=abc123',
    );

    const allowances = await getDownloadAllowances();
    const allowance = Object.values(allowances)[0];

    expect(allowance?.allowanceType).toBe('fallback');
    expect(allowance?.sourceUrl).toBe('https://canvas.instructure.com/courses/42/files/9001');
    expect(chrome.tabs.update).toHaveBeenCalledWith(12, {
      url: 'https://canvas.instructure.com/files/9001/download?download_frd=1&verifier=abc123',
    });
  });

  it('uses the opener tab as the likely source for new-tab download redirects', async () => {
    chrome.storage.sync.set({
      settings: {
        downloadRedirectFallbackPatternMatchEnabled: false,
        downloadRedirectFallbackSameHostEnabled: false,
        downloadRedirectFallbackSameSiteEnabled: false,
        downloadRedirectFallbackAnyAllowedRedirectEnabled: true,
      },
      calendarState: {
        currentEvent: null,
        allActiveEvents: [],
        todaysEvents: [],
        activeProfile: 'Study',
        activeRuleSource: 'event',
        activeRuleName: 'Study',
        allowedDomains: ['canvas.instructure.com'],
        recentEventTitles: [],
        isRestricted: true,
        lastSyncedAt: '2026-04-15T20:00:00.000Z',
        authError: null,
      },
    });

    background.recordCommittedDocumentUrl(4, 'https://canvas.instructure.com/courses/42/files/9001');

    const createdNavigationListener = (
      chrome.webNavigation.onCreatedNavigationTarget.addListener as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1)?.[0] as ((details: { tabId: number; sourceTabId: number }) => void) | undefined;
    createdNavigationListener?.({ tabId: 12, sourceTabId: 4 });

    await background.maybeStartDownloadRedirectFallback(
      12,
      null,
      'https://signed.cloudfront.net/tokens/abc123',
    );

    const allowances = await getDownloadAllowances();
    const allowance = Object.values(allowances)[0];
    expect(allowance?.sourceUrl).toBe('https://canvas.instructure.com/courses/42/files/9001');
  });

  it('can create host-wide fallback allowances when cross-tab rescue is enabled', async () => {
    chrome.storage.sync.set({
      settings: {
        downloadRedirectFallbackPatternMatchEnabled: false,
        downloadRedirectFallbackSameHostEnabled: false,
        downloadRedirectFallbackSameSiteEnabled: false,
        downloadRedirectFallbackAnyAllowedRedirectEnabled: true,
        downloadRedirectAllowAcrossTabsEnabled: true,
      },
      calendarState: {
        currentEvent: null,
        allActiveEvents: [],
        todaysEvents: [],
        activeProfile: 'Study',
        activeRuleSource: 'event',
        activeRuleName: 'Study',
        allowedDomains: ['canvas.instructure.com'],
        recentEventTitles: [],
        isRestricted: true,
        lastSyncedAt: '2026-04-15T20:00:00.000Z',
        authError: null,
      },
    });

    await background.maybeStartDownloadRedirectFallback(
      12,
      'https://canvas.instructure.com/courses/42/files/9001',
      'https://signed.cloudfront.net/tokens/abc123',
    );

    const allowances = await getDownloadAllowances();
    const allowance = Object.values(allowances)[0];
    expect(allowance?.tabId).toBeNull();

    const sessionRuleCall = (
      chrome.declarativeNetRequest.updateSessionRules as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1)?.[0];
    expect(sessionRuleCall?.addRules?.[0]?.condition?.tabIds).toBeUndefined();
  });

  it('removes completed download allowances and reloads matching tabs', async () => {
    chrome.storage.sync.set({
      calendarState: {
        currentEvent: null,
        allActiveEvents: [],
        todaysEvents: [],
        activeProfile: 'Deep Work',
        activeRuleSource: 'event',
        activeRuleName: 'Deep Work',
        allowedDomains: [],
        recentEventTitles: [],
        isRestricted: true,
        lastSyncedAt: '2026-04-15T20:00:00.000Z',
        authError: null,
      },
    });
    chrome.storage.local.set({
      downloadAllowances: {
        'download:11:5:downloads.example.com': {
          key: 'download:11:5:downloads.example.com',
          allowanceType: 'download',
          downloadId: 11,
          tabId: 5,
          sourceUrl: 'https://github.com/reubenroy/window-extension',
          sourceHost: 'github.com',
          targetUrl: 'https://downloads.example.com/file.zip',
          targetHost: 'downloads.example.com',
          ruleId: 210001,
          expiresAt: '2099-04-15T20:00:30.000Z',
        },
      },
    });
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 5, url: 'https://downloads.example.com/file.zip' },
    ]);

    await background.handleDownloadChanged({
      id: 11,
      state: { current: 'complete' },
    } as chrome.downloads.DownloadDelta);

    const allowances = await getDownloadAllowances();
    expect(allowances).toEqual({});
    expect(chrome.tabs.reload).toHaveBeenCalledWith(5);
  });
});
