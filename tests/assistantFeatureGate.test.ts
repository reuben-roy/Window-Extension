import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ASSISTANT_OPTIONS } from '../src/shared/constants';
import { setAssistantOptions } from '../src/shared/storage';

describe('assistant feature gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chrome.storage.sync.clear();
    chrome.storage.local.clear();
  });

  it('syncIdeaOutbox does not call fetch when Assistant is disabled', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await setAssistantOptions({
      ...DEFAULT_ASSISTANT_OPTIONS,
      assistantFeatureEnabled: false,
    });
    const { syncIdeaOutbox } = await import('../src/background/backend');
    await syncIdeaOutbox();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('submitIdea throws when Assistant is disabled', async () => {
    await setAssistantOptions({
      ...DEFAULT_ASSISTANT_OPTIONS,
      assistantFeatureEnabled: false,
    });
    const { submitIdea } = await import('../src/background/backend');
    await expect(submitIdea('hello')).rejects.toThrow(/Turn on Assistant/);
  });
});
