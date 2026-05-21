import {
  QUIZ_FAB_SESSION_KEY,
  QUIZ_FAB_SURFACE_COOLDOWN_MS,
  SIDE_PANEL_EXTENSION_PATH,
} from '../shared/constants';
import type { QuizFabSession } from '../shared/types';
import { normalizeSettingsStored } from '../shared/storage';
import { setActiveQuizVisibility } from './backend';

export async function getQuizFabSession(): Promise<QuizFabSession | null> {
  const stored = await chrome.storage.local.get(QUIZ_FAB_SESSION_KEY);
  const session = stored[QUIZ_FAB_SESSION_KEY] as QuizFabSession | undefined;
  if (!session || typeof session.visible !== 'boolean') {
    return null;
  }
  return session;
}

export async function setQuizFabSession(session: QuizFabSession | null): Promise<void> {
  if (session === null) {
    await chrome.storage.local.remove(QUIZ_FAB_SESSION_KEY);
    return;
  }
  await chrome.storage.local.set({ [QUIZ_FAB_SESSION_KEY]: session });
}

export async function hideQuizFab(): Promise<void> {
  const current = await getQuizFabSession();
  if (!current?.visible) {
    return;
  }
  await setQuizFabSession({ ...current, visible: false });
}

export function shouldDebounceQuizFabSurface(
  session: QuizFabSession | null,
  questionId: string,
): boolean {
  if (!session?.visible || session.questionId !== questionId || !session.lastSurfacedAt) {
    return false;
  }
  const elapsed = Date.now() - new Date(session.lastSurfacedAt).getTime();
  return elapsed < QUIZ_FAB_SURFACE_COOLDOWN_MS;
}

export async function syncQuizFabToTabs(input: {
  visible: boolean;
  topicLabel: string | null;
  questionId: string | null;
  intensity: QuizFabSession['intensity'];
}): Promise<void> {
  const session: QuizFabSession = {
    visible: input.visible,
    topicLabel: input.topicLabel,
    questionId: input.questionId,
    intensity: input.intensity,
    lastSurfacedAt: input.visible ? new Date().toISOString() : null,
  };
  await setQuizFabSession(session);

  if (!input.visible) {
    return;
  }

  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  for (const tab of tabs) {
    if (typeof tab.id !== 'number' || !isInjectableTabUrl(tab.url)) {
      continue;
    }
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'QUIZ_FAB_SYNC',
        payload: session,
      });
    } catch {
      // Content script may not be loaded yet; storage listener will apply on inject.
    }
  }
}

export function isInjectableTabUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
    return false;
  }
  return url.startsWith('http://') || url.startsWith('https://');
}

export function registerQuizFabTabListeners(): void {
  chrome.tabs.onActivated.addListener(() => {
    void reapplyQuizFabToFocusedTab();
  });

  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || typeof tab.id !== 'number') {
      return;
    }
    void reapplyQuizFabToTab(tab.id, tab.url);
  });
}

async function reapplyQuizFabToFocusedTab(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs[0];
  if (!tab || typeof tab.id !== 'number') {
    return;
  }
  await reapplyQuizFabToTab(tab.id, tab.url);
}

async function reapplyQuizFabToTab(tabId: number, url: string | undefined): Promise<void> {
  const session = await getQuizFabSession();
  if (!session?.visible || !isInjectableTabUrl(url)) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'QUIZ_FAB_SYNC',
      payload: session,
    });
  } catch {
    // Content script not ready.
  }
}

function openQuizSurfaceForTab(tabId: number, persistentPanelEnabled: boolean): void {
  if (persistentPanelEnabled) {
    chrome.sidePanel.open({ tabId });
  } else {
    const actionWithPopup = chrome.action as typeof chrome.action & {
      openPopup?: (options?: { tabId?: number }) => Promise<void>;
    };
    if (typeof actionWithPopup.openPopup === 'function') {
      void actionWithPopup.openPopup({ tabId }).catch(() => {
        void chrome.windows.create({
          url: chrome.runtime.getURL(SIDE_PANEL_EXTENSION_PATH),
          type: 'popup',
          width: 480,
          height: 720,
          focused: true,
        });
      });
    } else {
      void chrome.windows.create({
        url: chrome.runtime.getURL(SIDE_PANEL_EXTENSION_PATH),
        type: 'popup',
        width: 480,
        height: 720,
        focused: true,
      });
    }
  }

  void setActiveQuizVisibility(true);
  void hideQuizFab();
}

/** Opens quiz UI from a user gesture (FAB click, notification). */
export function openQuizSurfaceFromUserGesture(sender: chrome.runtime.MessageSender): void {
  const openForTabId = (tabId: number) => {
    chrome.storage.sync.get(['settings'], (stored) => {
      const settings = normalizeSettingsStored(stored.settings);
      openQuizSurfaceForTab(tabId, settings.persistentPanelEnabled);
    });
  };

  if (typeof sender.tab?.id === 'number') {
    openForTabId(sender.tab.id);
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (typeof tabId === 'number') {
      openForTabId(tabId);
    }
  });
}
