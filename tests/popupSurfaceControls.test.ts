import { describe, expect, it } from 'vitest';
import { getPersistentPanelControl } from '../src/popup/Popup';

describe('persistent panel control visibility', () => {
  it('keeps an undock control visible when the popup opens with the panel preference enabled', () => {
    expect(getPersistentPanelControl('popup', true, false)).toBe('undock');
  });

  it('shows the action that changes the current persistent-panel preference', () => {
    expect(getPersistentPanelControl('popup', false, false)).toBe('dock');
    expect(getPersistentPanelControl('panel', true, false)).toBe('undock');
    expect(getPersistentPanelControl('panel', false, false)).toBe('dock');
  });

  it('does not show a surface control inside the embedded quiz panel', () => {
    expect(getPersistentPanelControl('popup', false, true)).toBeNull();
    expect(getPersistentPanelControl('panel', true, true)).toBeNull();
  });
});
