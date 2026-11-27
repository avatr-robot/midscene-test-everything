import { expect, it } from '@rstest/core';
import { eyeLevelFocusOrder } from '../src/server/dual-camera-screens';

const screens = [
  { id: 'screen', name: 'Screen · BAA6CB' },
  { id: 'pja', name: 'PJA110 · 242567' },
];

it('uses the calibration order first and falls back to screen name order', () => {
  expect(
    eyeLevelFocusOrder(screens, ['pja', 'screen']).map(({ id }) => id),
  ).toEqual(['pja', 'screen']);
  expect(eyeLevelFocusOrder(screens).map(({ id }) => id)).toEqual([
    'pja',
    'screen',
  ]);
});
