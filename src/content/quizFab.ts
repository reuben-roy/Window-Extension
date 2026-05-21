import { QUIZ_FAB_SESSION_KEY } from '../shared/constants';
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
      right: 0;
      bottom: 88px;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      padding: 10px 12px 10px 14px;
      border: 1px solid rgba(37, 99, 235, 0.35);
      border-right: none;
      border-radius: 999px 0 0 999px;
      background: linear-gradient(135deg, #eff6ff 0%, #ffffff 72%);
      box-shadow: -4px 8px 24px rgba(15, 23, 42, 0.14);
      color: #1e3a8a;
      font: 600 12px/1.2 system-ui, -apple-system, sans-serif;
      cursor: pointer;
      letter-spacing: 0.01em;
      transition: transform 120ms ease, box-shadow 120ms ease;
    }
    .fab:hover {
      transform: translateX(-2px);
      box-shadow: -6px 10px 28px rgba(15, 23, 42, 0.18);
    }
    .fab:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }
    .fab.quiet {
      opacity: 0.92;
      background: linear-gradient(135deg, #f8fafc 0%, #ffffff 88%);
      color: #334155;
      border-color: rgba(148, 163, 184, 0.45);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #2563eb;
      flex-shrink: 0;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
    }
    .fab.quiet .dot {
      background: #64748b;
      box-shadow: 0 0 0 3px rgba(100, 116, 139, 0.18);
    }
  `;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = `fab${session.intensity === 'quiet' ? ' quiet' : ''}`;
  button.setAttribute('aria-label', `Open Window quiz: ${session.topicLabel ?? 'review'}`);
  button.title = session.topicLabel ? `Quick review: ${session.topicLabel}` : 'Open Window quiz';

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
