import { describe, expect, it } from 'vitest';
import { isLearningIdleWindow } from '../src/shared/learning';
import { DEFAULT_SETTINGS } from '../src/shared/constants';

const baseSettings = DEFAULT_SETTINGS;

describe('isLearningIdleWindow', () => {
  it('allows surfacing during a calendar gap for quiet intensity', () => {
    expect(
      isLearningIdleWindow({
        calendarState: { currentEvent: null },
        snoozeState: { active: false },
        settings: { learningSettings: { ...baseSettings.learningSettings, intensity: 'quiet' } },
        userIdle: false,
      }),
    ).toBe(true);
  });

  it('allows surfacing during an active break for all intensities', () => {
    expect(
      isLearningIdleWindow({
        calendarState: { currentEvent: { id: 'evt-1' } as never },
        snoozeState: { active: true },
        settings: { learningSettings: { ...baseSettings.learningSettings, intensity: 'quiet' } },
        userIdle: false,
      }),
    ).toBe(true);
  });

  it('requires user idle during unscheduled time for balanced intensity', () => {
    expect(
      isLearningIdleWindow({
        calendarState: { currentEvent: null },
        snoozeState: { active: false },
        settings: { learningSettings: { ...baseSettings.learningSettings, intensity: 'balanced' } },
        userIdle: false,
      }),
    ).toBe(false);

    expect(
      isLearningIdleWindow({
        calendarState: { currentEvent: null },
        snoozeState: { active: false },
        settings: { learningSettings: { ...baseSettings.learningSettings, intensity: 'balanced' } },
        userIdle: true,
      }),
    ).toBe(true);
  });

  it('blocks surfacing during an active focus block unless aggressive and user is idle', () => {
    const focusBlock = { currentEvent: { id: 'evt-1' } as never };

    expect(
      isLearningIdleWindow({
        calendarState: focusBlock,
        snoozeState: { active: false },
        settings: { learningSettings: { ...baseSettings.learningSettings, intensity: 'quiet' } },
        userIdle: true,
      }),
    ).toBe(false);

    expect(
      isLearningIdleWindow({
        calendarState: focusBlock,
        snoozeState: { active: false },
        settings: { learningSettings: { ...baseSettings.learningSettings, intensity: 'balanced' } },
        userIdle: true,
      }),
    ).toBe(false);

    expect(
      isLearningIdleWindow({
        calendarState: focusBlock,
        snoozeState: { active: false },
        settings: { learningSettings: { ...baseSettings.learningSettings, intensity: 'aggressive' } },
        userIdle: true,
      }),
    ).toBe(true);
  });
});
