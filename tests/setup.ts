import { vi } from 'vitest';

function createStorageArea() {
  let state: Record<string, unknown> = {};

  return {
    get: vi.fn(
      (
        key: string | string[] | null,
        callback: (result: Record<string, unknown>) => void,
      ) => {
        if (key === null) {
          callback({ ...state });
          return;
        }

        if (Array.isArray(key)) {
          callback(
            key.reduce<Record<string, unknown>>((acc, item) => {
              if (item in state) {
                acc[item] = state[item];
              }
              return acc;
            }, {}),
          );
          return;
        }

        callback(key in state ? { [key]: state[key] } : {});
      },
    ),
    set: vi.fn((items: Record<string, unknown>, callback?: () => void) => {
      state = { ...state, ...items };
      callback?.();
    }),
    clear: vi.fn(() => {
      state = {};
    }),
  };
}

// Mock chrome.* APIs for unit tests
const chromeMock = {
  storage: {
    sync: createStorageArea(),
    local: createStorageArea(),
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  runtime: {
    lastError: null as chrome.runtime.LastError | null,
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn() },
    onInstalled: { addListener: vi.fn() },
    getManifest: vi.fn(() => ({ version: '0.1.0' })),
    getURL: vi.fn((path: string) => `chrome-extension://fake-id/${path}`),
  },
  alarms: {
    create: vi.fn(),
    get: vi.fn((_name: string, callback: (alarm: chrome.alarms.Alarm | undefined) => void) => {
      callback(undefined);
    }),
    onAlarm: { addListener: vi.fn() },
  },
  declarativeNetRequest: {
    getDynamicRules: vi.fn(() => Promise.resolve([])),
    getSessionRules: vi.fn(() => Promise.resolve([])),
    updateDynamicRules: vi.fn(() => Promise.resolve()),
    updateSessionRules: vi.fn(() => Promise.resolve()),
    RuleActionType: {
      BLOCK: 'block',
      ALLOW: 'allow',
      REDIRECT: 'redirect',
    } as typeof chrome.declarativeNetRequest.RuleActionType,
    ResourceType: {
      MAIN_FRAME: 'main_frame',
    } as typeof chrome.declarativeNetRequest.ResourceType,
  },
  identity: {
    getAuthToken: vi.fn(),
    getRedirectURL: vi.fn((path?: string) =>
      `https://fake-extension.chromiumapp.org/${path ?? ''}`.replace(/\/$/, ''),
    ),
    launchWebAuthFlow: vi.fn(),
    removeCachedAuthToken: vi.fn(),
  },
  idle: {
    queryState: vi.fn((_thresholdSeconds: number, callback: (state: 'active' | 'idle' | 'locked') => void) => {
      callback('active');
    }),
  },
  notifications: {
    create: vi.fn(),
  },
  downloads: {
    download: vi.fn(() => Promise.resolve(1)),
    search: vi.fn(() => Promise.resolve([])),
    onCreated: { addListener: vi.fn() },
    onChanged: { addListener: vi.fn() },
  },
  tabs: {
    get: vi.fn((tabId: number) =>
      Promise.resolve({
        id: tabId,
        url: 'https://example.com',
        windowId: 1,
      }),
    ),
    query: vi.fn(() => Promise.resolve([])),
    create: vi.fn((properties: chrome.tabs.CreateProperties) =>
      Promise.resolve({
        id: 99,
        url: properties.url,
        active: properties.active,
        windowId: 1,
      }),
    ),
    getCurrent: vi.fn((callback: (tab?: chrome.tabs.Tab) => void) => {
      callback({
        id: 7,
        url: 'chrome-extension://fake-id/src/blocked/index.html',
        windowId: 1,
      });
    }),
    update: vi.fn((_tabId: number, _properties: chrome.tabs.UpdateProperties) => Promise.resolve()),
    reload: vi.fn((_tabId?: number) => Promise.resolve()),
    onUpdated: { addListener: vi.fn() },
    onActivated: { addListener: vi.fn() },
    onRemoved: { addListener: vi.fn() },
  },
  action: {
    setPopup: vi.fn(() => Promise.resolve()),
  },
  sidePanel: {
    setOptions: vi.fn(() => Promise.resolve()),
    setPanelBehavior: vi.fn(() => Promise.resolve()),
    open: vi.fn(() => Promise.resolve()),
  },
  windows: {
    update: vi.fn(() => Promise.resolve()),
  },
  webNavigation: {
    onBeforeNavigate: { addListener: vi.fn() },
    onCommitted: { addListener: vi.fn() },
    onCreatedNavigationTarget: { addListener: vi.fn() },
  },
};

Object.defineProperty(globalThis, 'chrome', {
  value: chromeMock,
  writable: true,
});

export default chromeMock;
