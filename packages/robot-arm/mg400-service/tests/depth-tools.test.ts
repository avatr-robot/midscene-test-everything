import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import { depthFusionResolutionMismatch } from '../src/ui/utils/depth-fusion';
import {
  buildDepthPointCloud,
  depthClipZ,
} from '../src/ui/utils/depth-point-cloud';
import { placeDepthProbe } from '../src/ui/utils/depth-probe';

test('back-projects aligned depth and samples matching RGB colors', () => {
  const depth = new Uint16Array([0, 1000, 2000, 0]);
  const colors = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  const cloud = buildDepthPointCloud({
    color: { data: colors, width: 2, height: 2 },
    depth: depth.buffer,
    depthWidth: 2,
    depthHeight: 2,
    scaleMeters: 0.001,
    intrinsics: { fx: 100, fy: 100, cx: 1, cy: 1 },
    maxPoints: 4,
  });

  assert.equal(cloud.pointCount, 2);
  assert.deepEqual(
    Array.from(cloud.positions).map((value) => value.toFixed(3)),
    ['0.010', '0.005', '-0.500', '-0.010', '-0.005', '0.500'],
  );
  assert.deepEqual(Array.from(cloud.colors), [0, 1, 0, 0, 0, 1]);
  assert.equal(depthClipZ(1, 1, 5), -1);
  assert.equal(depthClipZ(5, 1, 5), 1);
});

test('keeps the depth probe inside the preview near an edge', () => {
  assert.deepEqual(
    placeDepthProbe({
      pointerX: 620,
      pointerY: 340,
      containerWidth: 640,
      containerHeight: 360,
      probeWidth: 120,
      probeHeight: 48,
    }),
    { left: 488, top: 280 },
  );
});

test('ignores sparse far-range readings when framing a nearby work surface', () => {
  const depth = new Uint16Array([500, 510, 520, 530, 30_000]);
  const cloud = buildDepthPointCloud({
    color: {
      data: new Uint8ClampedArray(5 * 4).fill(255),
      width: 5,
      height: 1,
    },
    depth: depth.buffer,
    depthWidth: 5,
    depthHeight: 1,
    scaleMeters: 0.001,
    intrinsics: { fx: 100, fy: 100, cx: 2, cy: 0 },
    maxPoints: 10,
  });

  assert.equal(cloud.pointCount, 4);
  assert.ok(cloud.radius < 2);
});

test('only allows RGB and depth fusion for equal native capture resolutions', () => {
  assert.deepEqual(
    depthFusionResolutionMismatch(
      { stream: { width: 1280, height: 720 } },
      { stream: { width: 1920, height: 1080 } },
    ),
    {
      depth: { width: 1280, height: 720 },
      color: { width: 1920, height: 1080 },
    },
  );
  assert.equal(
    depthFusionResolutionMismatch(
      { stream: { width: 1280, height: 720 } },
      { stream: { width: 1280, height: 720 } },
    ),
    undefined,
  );
});
