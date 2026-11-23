import assert from 'node:assert/strict';
import { afterAll, test } from '@rstest/core';
import sharp from 'sharp';
import { rectifiedPreviewPool } from '../dist/camera/rectified-preview-pool.js';
import { transformRectifiedPreview } from '../dist/camera/rectified-preview-transform.js';

afterAll(() => rectifiedPreviewPool.close());

test('preview workers preserve the main-thread rectification result', async () => {
  const jpeg = await sharp({
    create: {
      width: 120,
      height: 90,
      channels: 3,
      background: { r: 30, g: 120, b: 210 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  const request = {
    correction: {
      sourceWidth: 120,
      sourceHeight: 90,
      rotation: 0,
      points: {
        topLeft: { x: 10, y: 10 },
        topRight: { x: 110, y: 10 },
        bottomRight: { x: 110, y: 80 },
        bottomLeft: { x: 10, y: 80 },
      },
    },
    target: { width: 120, height: 90, rotation: 0 },
    options: { maxSide: 80, sampling: 'bilinear' },
  };
  const expected = await transformRectifiedPreview(jpeg, request);
  const actual = await rectifiedPreviewPool.transform(jpeg, request);
  assert.deepEqual(actual, expected);
  const metadata = await sharp(actual).metadata();
  assert.deepEqual([metadata.width, metadata.height], [80, 60]);
});
