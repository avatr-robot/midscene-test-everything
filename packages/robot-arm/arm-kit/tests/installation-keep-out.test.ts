import { expect, it } from '@rstest/core';
import { cameraBoundaryExcessMm } from '../src/application/teaching-constraints.js';
import { deriveInstallationKeepOuts } from '../src/calibration/installation-keep-out.js';
import type { CartesianPose, InstallationTeaching } from '../src/contracts.js';

const quads = [
  [
    { x: 200, y: -50 },
    { x: 360, y: -50 },
    { x: 360, y: 50 },
    { x: 200, y: 50 },
  ],
  [
    { x: 200, y: 100 },
    { x: 360, y: 100 },
    { x: 360, y: 200 },
    { x: 200, y: 200 },
  ],
];
const teaching = (keepOuts: InstallationTeaching['cameraKeepOuts']) =>
  ({
    cameraBoundary: keepOuts![0],
    cameraKeepOuts: keepOuts,
  }) as InstallationTeaching;
const pose = (x: number, y: number): CartesianPose => ({
  frame: 'base',
  positionMm: { x, y, z: 0 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
});

it('derives the two camera sides from the calibrated screen group', () => {
  const derived = deriveInstallationKeepOuts({
    quads,
    axis: { x: 0, y: 1 },
    primaryCameraId: 'top',
    sideCameraId: 'front',
  });
  expect(derived).toBeDefined();
  expect(derived!.keepOuts).toHaveLength(2);
  // Screen group spans Y -50..200; 15 mm margins sit outside both edges.
  expect(derived!.primary.point).toEqual({ x: 0, y: -65 });
  expect(derived!.primary.normal).toEqual({ x: 0, y: -1 });
  expect(derived!.keepOuts[1]!.point).toEqual({ x: 0, y: 215 });
  expect(derived!.keepOuts[1]!.normal).toEqual({ x: 0, y: 1 });
  // The legacy A/B endpoints extend the primary line along the screen width.
  expect(derived!.primary.start).toEqual({ x: 380, y: -65 });
  expect(derived!.primary.end).toEqual({ x: 180, y: -65 });
});

it('uses both camera sides as one keep-out region', () => {
  const derived = deriveInstallationKeepOuts({
    quads,
    axis: { x: 0, y: 1 },
    primaryCameraId: 'top',
    sideCameraId: 'front',
  })!;
  const sides = teaching(derived.keepOuts);
  // Over the screens: both half-planes are negative, so the tip is allowed.
  expect(cameraBoundaryExcessMm(pose(0, 0).positionMm, sides)).toBeLessThan(0);
  // Beyond the front camera side: the old single-sided boundary would allow
  // this, the derived two-sided region must not.
  expect(
    cameraBoundaryExcessMm(pose(0, 260).positionMm, sides),
  ).toBeGreaterThan(0);
});
