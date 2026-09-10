import {
  QUIZ_FAB_SESSION_KEY,
  QUIZ_FAB_SURFACE_COOLDOWN_MS,
  SIDE_PANEL_EXTENSION_PATH,
} from '../shared/constants';
import type { LearningIntensity, QuizFabSession, Settings } from '../shared/types';
import { setActiveQuizVisibility } from './backend';
import { getLearningState, getSettings } from '../shared/storage';

function normalizeQuizFabSession(session: QuizFabSession): QuizFabSession {
  return {
    ...session,
    panelVisible: session.panelVisible === true,
  };
}

export async function getQuizFabSession(): Promise<QuizFabSession | null> {
  const stored = await chrome.storage.local.get(QUIZ_FAB_SESSION_KEY);
  const session = stored[QUIZ_FAB_SESSION_KEY] as QuizFabSession | undefined;
  if (!session || typeof session.visible !== 'boolean') {
    return null;
  }
  const raw = session as QuizFabSession & { panelClosedAt?: string | null };
  return normalizeQuizFabSession({
    ...session,
    panelVisible: raw.panelVisible === true,
    panelClosedAt:
      typeof raw.panelClosedAt === 'string' ? raw.panelClosedAt : null,
  });
}

export async function setQuizFabSession(session: QuizFabSession | null): Promise<void> {
  if (session === null) {
    await chrome.storage.local.remove(QUIZ_FAB_SESSION_KEY);
    return;
  }
  await chrome.storage.local.set({ [QUIZ_FAB_SESSION_KEY]: session });
}

export async function hideQuizPanel(): Promise<void> {
  const current = await getQuizFabSession();
  if (!current?.panelVisible) {
    return;
  }
  await syncQuizFabToTabs({
    ...current,
    panelVisible: false,
    visible: false,
    panelClosedAt: new Date().toISOString(),
  });
}

export async function hideQuizFab(): Promise<void> {
  const current = await getQuizFabSession();
  if (current?.visible || current?.panelVisible) {
    await setQuizFabSession({
      ...current,
      visible: false,
      panelVisible: false,
      panelClosedAt: new Date().toISOString(),
    });
  }
  await hideQuizPanel();
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

/** Re-surface the in-page panel for the same unanswered question after a cooldown. */
export function shouldReopenAutoQuizPanel(
  settings: Pick<Settings, 'learningSettings'>,
  session: QuizFabSession | null,
  questionId: string,
): boolean {
  if (!settings.learningSettings.autoOpen) {
    return false;
  }
  if (!session || session.questionId !== questionId || session.panelVisible) {
    return false;
  }
  if (!session.panelClosedAt) {
    return false;
  }
  const elapsed = Date.now() - new Date(session.panelClosedAt).getTime();
  const cooldownMs = settings.learningSettings.panelReopenCooldownMinutes * 60_000;
  return elapsed >= cooldownMs;
}

function getQuizSurfaceContentScriptFiles(): string[] {
  const entries = chrome.runtime.getManifest().content_scripts ?? [];
  const files = new Set<string>();
  for (const entry of entries) {
    const js = entry.js ?? [];
    if (js.some((file) => file.includes('quizFab') || file.includes('quizPanel'))) {
      for (const file of js) {
        files.add(file);
      }
    }
  }
  return [...files];
}

/** Inject quiz surface content scripts into tabs that were open before install/update. */
export async function ensureQuizFabContentScript(tabId: number): Promise<void> {
  const files = getQuizSurfaceContentScriptFiles();
  if (files.length === 0 || !chrome.scripting?.executeScript) {
    return;
  }

  for (const file of files) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [file],
      });
    } catch {
      // Tab may not allow injection (chrome://, PDF viewer, etc.).
    }
  }
}

/** Resolve injectable tab ids for quiz surface sync (FAB or in-page panel). */
async function getTabIdsForQuizSessionPush(panelVisible: boolean): Promise<number[]> {
  const ids = new Set<number>();

  const addInjectable = (tabs: chrome.tabs.Tab[]) => {
    for (const tab of tabs) {
      if (typeof tab.id === 'number' && isInjectableTabUrl(tab.url)) {
        ids.add(tab.id);
      }
    }
  };

  const normalWindows = await chrome.windows.getAll({ windowTypes: ['normal'], populate: true });

  // Active tab in each normal window (works even when DevTools / extension UI has OS focus).
  for (const win of normalWindows) {
    for (const tab of win.tabs ?? []) {
      if (tab.active) {
        addInjectable([tab]);
      }
    }
  }

  // Panel: sync every injectable tab in the focused normal window (tab switch handled in content script).
  if (panelVisible) {
    const lastFocusedNormal = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    const panelWindow =
      normalWindows.find((win) => win.focused) ??
      normalWindows.find((win) => win.id === lastFocusedNormal.id);
    if (panelWindow?.tabs) {
      addInjectable(panelWindow.tabs);
    }
  }

  // Fallback: most recently used http(s) tab (covers chrome://newtab active + site open in background).
  if (ids.size === 0) {
    const recentInjectable = (await chrome.tabs.query({}))
      .filter((tab) => typeof tab.id === 'number' && isInjectableTabUrl(tab.url))
      .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));

    const anchor = recentInjectable[0];
    if (anchor?.id !== undefined) {
      ids.add(anchor.id);
      if (panelVisible && anchor.windowId !== undefined) {
        addInjectable(await chrome.tabs.query({ windowId: anchor.windowId }));
      }
    }
  }

  return [...ids];
}

async function pushQuizFabSessionToTab(tabId: number, session: QuizFabSession): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'QUIZ_FAB_SYNC',
      payload: session,
    });
    return;
  } catch {
    // Manifest content scripts are not present on tabs that were already open.
  }

  await ensureQuizFabContentScript(tabId);
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'QUIZ_FAB_SYNC',
      payload: session,
    });
  } catch {
    // storage.onChanged in the content script applies once it starts.
  }
}

export async function updateSurfacedQuizFabPrompt(input: {
  topicLabel: string | null;
  questionId: string | null;
}): Promise<void> {
  const current = await getQuizFabSession();
  if (!current || (!current.visible && !current.panelVisible)) {
    return;
  }

  if (current.topicLabel === input.topicLabel && current.questionId === input.questionId) {
    return;
  }

  const next: QuizFabSession = {
    ...current,
    topicLabel: input.topicLabel,
    questionId: input.questionId,
  };
  await setQuizFabSession(next);

  const tabIds = await getTabIdsForQuizSessionPush(next.panelVisible);
  for (const tabId of tabIds) {
    await pushQuizFabSessionToTab(tabId, next);
  }
}

export async function syncQuizFabToTabs(input: {
  visible: boolean;
  panelVisible: boolean;
  topicLabel: string | null;
  questionId: string | null;
  intensity: QuizFabSession['intensity'];
  panelClosedAt?: string | null;
}): Promise<void> {
  const panelVisible = input.panelVisible === true;
  const visible = input.visible === true;
  const surfaced = visible || panelVisible;
  const panelClosedAt = panelVisible
    ? null
    : input.panelClosedAt !== undefined
      ? input.panelClosedAt
      : null;

  const session: QuizFabSession = {
    visible,
    panelVisible,
    topicLabel: input.topicLabel,
    questionId: input.questionId,
    intensity: input.intensity,
    lastSurfacedAt: surfaced ? new Date().toISOString() : null,
    panelClosedAt,
  };
  await setQuizFabSession(session);

  if (!visible && !panelVisible) {
    return;
  }

  const tabIds = await getTabIdsForQuizSessionPush(panelVisible);
  if (tabIds.length === 0) {
    const activeUrls = (await chrome.tabs.query({ active: true, windowType: 'normal' }))
      .map((tab) => tab.url ?? '(no url)')
      .join(', ');
    console.warn(
      '[Window] Quiz surface sync: no injectable http(s) tab found.',
      'Active normal-window tab URLs:',
      activeUrls || '(none)',
      '— open or switch to a regular website tab (not chrome://newtab or extension pages).',
    );
    return;
  }

  for (const tabId of tabIds) {
    await pushQuizFabSessionToTab(tabId, session);
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
  const session = await getQuizFabSession();
  if (!session?.visible && !session?.panelVisible) {
    return;
  }
  const tabIds = await getTabIdsForQuizSessionPush(session.panelVisible);
  for (const tabId of tabIds) {
    const tab = await chrome.tabs.get(tabId);
    await reapplyQuizFabToTab(tabId, tab.url);
  }
}

async function reapplyQuizFabToTab(tabId: number, url: string | undefined): Promise<void> {
  const session = await getQuizFabSession();
  if ((!session?.visible && !session?.panelVisible) || !isInjectableTabUrl(url)) {
    return;
  }
  await pushQuizFabSessionToTab(tabId, session);
}

/** Opens in-page quiz panel from a background context (alarm, idle trigger). */
export async function autoOpenQuizSurface(session: {
  topicLabel: string | null;
  questionId: string;
  intensity: LearningIntensity;
}): Promise<void> {
  // Mark the quiz as visible before mounting the embedded iframe. The panel
  // refreshes learning state on mount and should preserve the current prompt
  // instead of taking the scheduled/random selection path.
  await setActiveQuizVisibility(true);
  await syncQuizFabToTabs({
    visible: true,
    panelVisible: true,
    topicLabel: session.topicLabel,
    questionId: session.questionId,
    intensity: session.intensity,
    panelClosedAt: null,
  });
}

/** Toggle in-page quiz panel from the FAB on an http(s) tab. */
export async function toggleInPageQuizPanel(sender: chrome.runtime.MessageSender): Promise<void> {
  if (!isInjectableTabUrl(sender.tab?.url)) {
    return;
  }

  const [learningState, settings, current] = await Promise.all([
    getLearningState(),
    getSettings(),
    getQuizFabSession(),
  ]);
  const prompt = learningState.activeQuizPrompt;
  if (!prompt) {
    return;
  }

  const nextPanelVisible = current?.panelVisible !== true;
  if (nextPanelVisible) {
    // Preserve the current quiz prompt before the embedded panel mounts. The
    // panel loads the shared Popup app, which refreshes learning state on
    // mount and depends on activeQuizVisible already being true.
    await setActiveQuizVisibility(true);
  }
  await syncQuizFabToTabs({
    visible: true,
    panelVisible: nextPanelVisible,
    topicLabel: prompt.topicLabel,
    questionId: prompt.questionId,
    intensity: settings.learningSettings.intensity,
    panelClosedAt: nextPanelVisible ? null : new Date().toISOString(),
  });
  if (!nextPanelVisible) {
    await setActiveQuizVisibility(true);
  }
}

/** FAB / notification: in-page toggle on http(s) tabs, else in-page panel on the best available tab. */
export function handleOpenQuizSurface(sender: chrome.runtime.MessageSender): void {
  if (isInjectableTabUrl(sender.tab?.url)) {
    void toggleInPageQuizPanel(sender);
    return;
  }
  void openQuizSurfaceFromUserGesture(sender);
}

/**
 * Opens quiz UI from a user gesture (notification, non-page context). The
 * in-page panel is the default quiz surface; a standalone quiz window is the
 * fallback when no regular website tab exists to host the panel.
 */
export async function openQuizSurfaceFromUserGesture(
  _sender: chrome.runtime.MessageSender,
): Promise<void> {
  const [learningState, settings, tabs] = await Promise.all([
    getLearningState(),
    getSettings(),
    chrome.tabs.query({}),
  ]);
  const prompt = learningState.activeQuizPrompt;
  const hasInjectableTab = tabs.some((tab) => isInjectableTabUrl(tab.url));

  if (prompt && hasInjectableTab) {
    await autoOpenQuizSurface({
      topicLabel: prompt.topicLabel,
      questionId: prompt.questionId,
      intensity: settings.learningSettings.intensity,
    });
    return;
  }

  await setActiveQuizVisibility(true);
  void chrome.windows.create({
    url: `${chrome.runtime.getURL(SIDE_PANEL_EXTENSION_PATH)}?embedded=1`,
    type: 'popup',
    width: 520,
    height: 720,
    focused: true,
  });
}
