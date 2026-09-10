import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncQuizFabToTabs } from '../src/background/quizFab';

describe('quiz FAB content-script synchronization', () => {
  beforeEach(() => {
    Object.assign(chrome.windows, {
      getAll: vi.fn(() =>
        Promise.resolve([
          {
            id: 1,
            focused: true,
            tabs: [{ id: 7, active: true, url: 'https://example.com' }],
          },
        ]),
      ),
      getLastFocused: vi.fn(() => Promise.resolve({ id: 1 })),
    });
    vi.mocked(chrome.runtime.getManifest).mockReturnValue({
      content_scripts: [
        { matches: ['<all_urls>'], js: ['quizFab.js'] },
        { matches: ['<all_urls>'], js: ['quizPanel.js'] },
      ],
    } as chrome.runtime.Manifest);
    vi.mocked(chrome.tabs.sendMessage).mockResolvedValue(undefined);
    vi.mocked(chrome.scripting.executeScript).mockClear();
  });

  it('does not reinject listeners when the existing content scripts answer', async () => {
    await syncQuizFabToTabs({
      visible: true,
      panelVisible: true,
      topicLabel: 'Distributed Systems',
      questionId: 'question-1',
      intensity: 'balanced',
    });

    expect(chrome.tabs.sendMessage).toHaveBeenCalled();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});
