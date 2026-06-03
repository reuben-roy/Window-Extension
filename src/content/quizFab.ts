import { QUIZ_FAB_SESSION_KEY, QUIZ_PANEL_WIDTH_PX } from '../shared/constants';
import type { QuizFabSession } from '../shared/types';

const FAB_HOST_ID = 'window-quiz-fab-host';

function isInjectablePage(): boolean {
  const { protocol } = window.location;
  return protocol === 'http:' || protocol === 'https:';
}

function fabLabel(session: QuizFabSession): string {
  const topic = session.topicLabel?.trim();
  if (!topic) return 'Quiz';
  const firstWord = topic.split(/\s+/)[0] ?? 'Quiz';
  return firstWord.length > 12 ? `${firstWord.slice(0, 11)}…` : firstWord;
}

function renderFab(session: QuizFabSession): void {
  removeFab();
  if (!session.visible || !isInjectablePage()) {
    return;
  }

  const panelOpen = session.panelVisible === true;
  const fabRight = panelOpen ? QUIZ_PANEL_WIDTH_PX : 0;

  const host = document.createElement('div');
  host.id = FAB_HOST_ID;
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
    }
    .fab {
      position: fixed;
      right: ${fabRight}px;
      top: 15%;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      padding: 13px 18px 13px 20px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-right: none;
      border-radius: 999px 0 0 999px;
      background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
      box-shadow: -6px 10px 32px rgba(29, 78, 216, 0.45);
      color: #ffffff;
      font: 700 14px/1.2 system-ui, -apple-system, sans-serif;
      cursor: pointer;
      letter-spacing: 0.01em;
      transition: right 220ms cubic-bezier(0.22, 1, 0.36, 1), transform 120ms ease, box-shadow 120ms ease;
    }
    .fab:hover {
      transform: translateX(-3px);
      box-shadow: -8px 12px 36px rgba(29, 78, 216, 0.55);
    }
    .fab:focus-visible {
      outline: 2px solid #ffffff;
      outline-offset: 2px;
    }
    .fab.quiet {
      opacity: 0.92;
      background: linear-gradient(135deg, #f8fafc 0%, #ffffff 88%);
      color: #334155;
      border-color: rgba(148, 163, 184, 0.45);
    }
    .dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #facc15;
      flex-shrink: 0;
      box-shadow: 0 0 0 3px rgba(250, 204, 21, 0.35);
    }
    .fab.quiet .dot {
      background: #64748b;
      box-shadow: 0 0 0 3px rgba(100, 116, 139, 0.18);
    }
  `;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = `fab${session.intensity === 'quiet' ? ' quiet' : ''}`;
  const actionLabel = panelOpen ? 'Close quiz panel' : 'Open quiz panel';
  button.setAttribute('aria-label', actionLabel);
  button.title = panelOpen
    ? 'Close quiz panel'
    : session.topicLabel
      ? `Open quiz: ${session.topicLabel}`
      : 'Open quiz panel';

  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.textContent = fabLabel(session);

  button.append(dot, label);
  button.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_QUIZ_SURFACE' });
  });

  shadow.append(style, button);
  document.documentElement.append(host);
}

function removeFab(): void {
  document.getElementById(FAB_HOST_ID)?.remove();
}

function applySession(session: QuizFabSession | null | undefined): void {
  if (!session?.visible) {
    removeFab();
    return;
  }
  renderFab(session);
}

chrome.storage.local.get(QUIZ_FAB_SESSION_KEY, (stored) => {
  applySession(stored[QUIZ_FAB_SESSION_KEY] as QuizFabSession | undefined);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[QUIZ_FAB_SESSION_KEY]) {
    return;
  }
  applySession(changes[QUIZ_FAB_SESSION_KEY].newValue as QuizFabSession | undefined);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'QUIZ_FAB_SYNC') {
    applySession(message.payload as QuizFabSession);
  }
});
