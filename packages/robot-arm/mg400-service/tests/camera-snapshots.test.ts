import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CameraCorrection } from '@midscene/robotics-shared/contracts';
import { afterEach, expect, it } from '@rstest/core';
import { CameraSnapshots } from '../src/server/camera-snapshots';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it('stores one raw frame and one selected-screen correction separately', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'camera-snapshots-'));
  directories.push(directory);
  const correction: CameraCorrection = {
    points: {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 190, y: 10 },
      bottomLeft: { x: 10, y: 90 },
      bottomRight: { x: 190, y: 90 },
    },
    sourceWidth: 200,
    sourceHeight: 100,
    rotation: 0,
  };
  const raw = Buffer.from('raw-jpeg');
  const corrected = Buffer.from('corrected-jpeg');
  const snapshots = new CameraSnapshots(directory);
  const calls: string[] = [];

  const snapshot = await snapshots.capture({
    camera: {
      prepareCaptureExposure: async () => {
        calls.push('exposure');
      },
      rawFrame: async () => {
        calls.push('raw');
        return raw;
      },
      rectifiedFrame: async (source) => {
        calls.push('corrected');
        expect(source).toBe(raw);
        return corrected;
      },
      getCorrection: () => correction,
      getRectifiedPreviewTarget: () => ({
        width: 180,
        height: 320,
        rotation: 0,
      }),
    },
    cameraId: 'camera-a',
    screenId: 'screen-a',
    screenName: 'Bench screen',
  });

  expect(calls).toEqual(['exposure', 'raw', 'corrected']);
  expect(snapshot.raw).toMatchObject({
    width: 200,
    height: 100,
    bytes: raw.length,
  });
  expect(snapshot.corrected).toMatchObject({
    width: 180,
    height: 320,
    bytes: corrected.length,
  });
  expect(snapshot.raw.path).not.toBe(snapshot.corrected.path);
  expect(await readFile(snapshot.raw.path)).toEqual(raw);
  expect(await readFile(snapshot.corrected.path)).toEqual(corrected);
  expect(await snapshots.latest('camera-a', 'screen-a')).toEqual(snapshot);
  expect(await snapshots.image(snapshot.id, 'raw')).toEqual(raw);
  expect(await snapshots.image(snapshot.id, 'corrected')).toEqual(corrected);
});

it('refuses a snapshot when the selected screen has no correction', async () => {
  const snapshots = new CameraSnapshots(join(tmpdir(), 'unused-snapshots'));
  await expect(
    snapshots.capture({
      camera: {
        prepareCaptureExposure: async () => {},
        rawFrame: async () => Buffer.from('raw'),
        rectifiedFrame: async () => Buffer.from('corrected'),
        getCorrection: () => undefined,
        getRectifiedPreviewTarget: () => undefined,
      },
      cameraId: 'camera-a',
      screenId: 'screen-a',
      screenName: 'Bench screen',
    }),
  ).rejects.toMatchObject({ status: 409 });
});
