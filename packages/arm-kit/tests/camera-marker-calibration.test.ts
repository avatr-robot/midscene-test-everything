import { expect, test } from '@rstest/core';
import sharp from 'sharp';
import { calibrationPageMarkers } from '../src/assisted-contracts.js';
import {
  detectCalibrationMarkers,
  detectScreenFromMarkers,
  markerSvg,
} from '../src/camera/calibration-markers.js';

const layout = {
  revision: 1,
  width: 400,
  height: 800,
  screen: { width: 400, height: 800, devicePixelRatio: 2 },
  markers: calibrationPageMarkers(400, 800),
};

async function photograph(shiftCheck = false, visible = layout.markers) {
  const markers = visible
    .map((m) =>
      markerSvg(m.code).replace(
        '<svg ',
        `<svg x="${m.x - m.size / 2 + (shiftCheck && m.purpose === 'check' ? 10 : 0)}" y="${m.y - m.size / 2}" width="${m.size}" height="${m.size}" `,
      ),
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="580" height="800"><rect width="100%" height="100%" fill="#ccc"/><g transform="matrix(1,-.12,-.08,.84,95,70)"><rect width="400" height="800" fill="white"/>${markers}</g></svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

test('requires every fitting and independent check marker to be visible', async () => {
  for (const code of [10, 14]) {
    const visible = layout.markers.filter((marker) => marker.code !== code);
    const frame = await photograph(false, visible);
    await expect(
      detectCalibrationMarkers(frame, layout.markers),
    ).rejects.toThrow(
      `Calibration marker ${code} could not be decoded uniquely (0 matches)`,
    );
  }
});

test('rejects a duplicate marker even when another one is missing', async () => {
  const visible = layout.markers.map((marker) =>
    marker.code === 15 ? { ...marker, code: 10 } : marker,
  );
  const frame = await photograph(false, visible);
  await expect(detectCalibrationMarkers(frame, layout.markers)).rejects.toThrow(
    'Calibration marker 10 could not be decoded uniquely (2 matches)',
  );
});

test('recovers dim markers and still checks the independent marker positions', async () => {
  const dim = async (shiftCheck: boolean) =>
    sharp(await photograph(shiftCheck))
      .linear(0.12, 90)
      .jpeg({ quality: 90 })
      .toBuffer();
  const { accuracy } = await detectCalibrationMarkers(
    await dim(false),
    layout.markers,
  );
  expect(accuracy.fit.count).toBe(4);
  expect(accuracy.validation.count).toBe(2);
  expect(accuracy.validation.maxErrorCssPx).toBeLessThanOrEqual(3);
  await expect(
    detectCalibrationMarkers(await dim(true), layout.markers),
  ).rejects.toThrow('Independent check');
});
test('recovers the outer screen from a slanted six-marker phone over eight frames', async () => {
  const frame = await photograph();
  let captures = 0;
  const correction = await detectScreenFromMarkers(async () => {
    captures++;
    return frame;
  }, layout);
  expect(captures).toBe(8);
  expect(
    Math.hypot(
      correction.points.topLeft.x - 95,
      correction.points.topLeft.y - 70,
    ),
  ).toBeLessThan(3);
  expect(
    Math.hypot(
      correction.points.bottomRight.x - 431,
      correction.points.bottomRight.y - 694,
    ),
  ).toBeLessThan(3);
});
test('independently displaced markers prevent a correction', async () => {
  const frame = await photograph(true);
  await expect(
    detectScreenFromMarkers(async () => frame, layout),
  ).rejects.toThrow('Independent check');
});

test('locates one trial disk without a target coordinate and rejects ambiguous frames', async () => {
  const { findTrialTarget } = await import('../src/camera/trial-target.js');
  const render = (xs: number[]) =>
    sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><rect width="400" height="800" fill="white"/>${xs.map((x) => `<circle cx="${x}" cy="180" r="13" fill="#cf29b6"/>`).join('')}</svg>`,
      ),
    )
      .jpeg()
      .toBuffer();
  const point = await findTrialTarget(await render([92]));
  expect(Math.hypot(point.x - 92, point.y - 180)).toBeLessThan(1.5);
  await expect(findTrialTarget(await render([92, 155]))).rejects.toThrow(
    'exactly one',
  );
  await expect(findTrialTarget(await render([]))).rejects.toThrow(
    'exactly one',
  );
});

// Same observed markers, but browser chrome occupies both ends of the display.
// The complete screen must extend above AND below the page, not shift upward.
test('extrapolates split browser chrome to both physical screen edges', async () => {
  const frame = await sharp(await photograph())
    .extend({ top: 100, bottom: 100, left: 0, right: 0, background: '#ccc' })
    .jpeg()
    .toBuffer();
  const correction = await detectScreenFromMarkers(async () => frame, {
    ...layout,
    screen: { ...layout.screen, height: 900 },
    topInset: 30,
  });
  expect(
    Math.hypot(
      correction.points.topLeft.x - 97.4,
      correction.points.topLeft.y - 144.8,
    ),
  ).toBeLessThan(3);
  expect(
    Math.hypot(
      correction.points.bottomRight.x - 425.4,
      correction.points.bottomRight.y - 852.8,
    ),
  ).toBeLessThan(3);
});

test('does not extrapolate the observed iPhone chrome gap without an origin', async () => {
  let captures = 0;
  await expect(
    detectScreenFromMarkers(
      async () => {
        captures++;
        return Buffer.alloc(0);
      },
      {
        ...layout,
        width: 390,
        height: 699,
        screen: { width: 390, height: 844, devicePixelRatio: 3 },
        markers: calibrationPageMarkers(390, 699),
      },
    ),
  ).rejects.toThrow('Automatic screen boundary detection is unavailable');
  expect(captures).toBe(0);
});
