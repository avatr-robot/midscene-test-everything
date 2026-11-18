import { expect, it } from '@rstest/core';
import { shouldShowScreenOutlines } from '../../src/ui/calibration/screen-outline-visibility';

it('shows every screen outline only after camera calibration finishes', () => {
  expect(shouldShowScreenOutlines(undefined, false)).toBe(true);
  expect(shouldShowScreenOutlines({ state: 'ready' }, false)).toBe(true);
  expect(shouldShowScreenOutlines({ state: 'exposure' }, false)).toBe(false);
  expect(shouldShowScreenOutlines({ state: 'focus' }, false)).toBe(false);
  expect(shouldShowScreenOutlines({ state: 'ready' }, true)).toBe(false);
});
