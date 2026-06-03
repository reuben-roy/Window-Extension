import { QUIZ_FAB_SESSION_KEY, QUIZ_PANEL_WIDTH_PX, SIDE_PANEL_EXTENSION_PATH } from '../shared/constants';
import type { QuizFabSession } from '../shared/types';

const PANEL_HOST_ID = 'window-quiz-panel-host';
const PANEL_SLIDE_MS = 220;

let panelHost: HTMLElement | null = null;
let panelContainer: HTMLDivElement | null = null;

function isInjectablePage(): boolean {
  const { protocol } = window.location;
  return protocol === 'http:' || protocol === 'https:';
}

function isPanelMounted(): boolean {
  return panelHost !== null || !!document.getElementById(PANEL_HOST_ID);
}

function mountPanel(): void {
  if (isPanelMounted() || !isInjectablePage()) return;

  const host = document.createElement('div');
  host.id = PANEL_HOST_ID;
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .panel {
      position: fixed;
      top: 0;
      right: 0;
      width: ${QUIZ_PANEL_WIDTH_PX}px;
      height: 100vh;
      z-index: 2147483647;
      box-shadow: -4px 0 32px rgba(0, 0, 0, 0.18);
      border-left: 1px solid rgba(0, 0, 0, 0.08);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: slideIn ${PANEL_SLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
      background: #ffffff;
    }
    .panel.closing {
      animation: none;
      transition: transform ${PANEL_SLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${PANEL_SLIDE_MS}ms ease;
      transform: translateX(100%);
      opacity: 0;
    }
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to   { transform: translateX(0);    opacity: 1; }
    }
    iframe {
      width: 100%;
      flex: 1;
      border: none;
      display: block;
    }
  `;

  const container = document.createElement('div');
  container.className = 'panel';

  const iframe = document.createElement('iframe');
  iframe.src = `${chrome.runtime.getURL(SIDE_PANEL_EXTENSION_PATH)}?embedded=1`;
  iframe.allow = 'clipboard-read; clipboard-write';
  iframe.setAttribute('aria-label', 'Window quiz panel');

  container.appendChild(iframe);
  shadow.append(style, container);
  document.documentElement.appendChild(host);
  panelHost = host;
  panelContainer = container;
}

function unmountPanel(): void {
  const host = panelHost ?? document.getElementById(PANEL_HOST_ID);
  if (!host) {
    panelHost = null;
    panelContainer = null;
    return;
  }

  const finish = () => {
    host.remove();
    panelHost = null;
    panelContainer = null;
  };

  if (panelContainer) {
    panelContainer.classList.add('closing');
    panelContainer.addEventListener('transitionend', finish, { once: true });
    window.setTimeout(finish, PANEL_SLIDE_MS + 50);
    return;
  }

  finish();
}

function applySession(session: QuizFabSession | null | undefined): void {
  if (session?.panelVisible) {
    if (!document.hidden) {
      mountPanel();
    }
  } else {
    unmountPanel();
  }
}

chrome.storage.local.get(QUIZ_FAB_SESSION_KEY, (stored) => {
  applySession(stored[QUIZ_FAB_SESSION_KEY] as QuizFabSession | undefined);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[QUIZ_FAB_SESSION_KEY]) return;
  applySession(changes[QUIZ_FAB_SESSION_KEY].newValue as QuizFabSession | undefined);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'QUIZ_FAB_SYNC') {
    applySession(message.payload as QuizFabSession);
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    unmountPanel();
    return;
  }
  chrome.storage.local.get(QUIZ_FAB_SESSION_KEY, (stored) => {
    applySession(stored[QUIZ_FAB_SESSION_KEY] as QuizFabSession | undefined);
  });
});
