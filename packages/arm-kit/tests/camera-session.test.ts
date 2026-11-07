import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, rstest } from '@rstest/core';
import { CameraSessionManager } from '../src/camera/session.js';
import type { CameraBackend, CameraSource } from '../src/camera/types.js';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'arm-camera-test-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const closes: ReturnType<typeof rstest.fn>[] = [];
  const backend: CameraBackend = {
    listDevices: async () => [
      { id: 'camera', name: 'Camera', backend: 'avfoundation' },
    ],
    openStream: rstest.fn(async () => {
      const source = new EventEmitter() as CameraSource;
      source.close = rstest.fn(async () => {});
      closes.push(source.close as ReturnType<typeof rstest.fn>);
      return source;
    }),
  };
  const manager = new CameraSessionManager(backend, directory);
  cleanup.push(() => manager.close());
  return { manager, backend, closes };
}
it('shares one source and keeps it alive until the last device releases it', async () => {
  const { manager, backend, closes } = await fixture();
  const [a, b] = await Promise.all([
    manager.acquire('camera', 'a'),
    manager.acquire('camera', 'b'),
  ]);
  expect(a).toBe(b);
  expect(backend.openStream).toHaveBeenCalledTimes(1);
  await manager.release('camera', 'a');
  expect(closes[0]).not.toHaveBeenCalled();
  await manager.release('camera', 'b');
  expect(closes[0]).toHaveBeenCalledTimes(1);
});
it('waits for the old source to stop before reopening the same camera', async () => {
  const { manager, backend, closes } = await fixture();
  await manager.acquire('camera', 'a');
  const stopping = gate();
  closes[0].mockImplementation(() => stopping.promise);
  const released = manager.release('camera', 'a');
  const reopened = manager.acquire('camera', 'b');
  await rstest.waitFor(() => expect(closes[0]).toHaveBeenCalled());
  expect(backend.openStream).toHaveBeenCalledTimes(1);
  stopping.resolve();
  await released;
  await reopened;
  expect(backend.openStream).toHaveBeenCalledTimes(2);
});
it('close during discovery rejects acquisition without leaking a source', async () => {
  const { manager, backend, closes } = await fixture();
  const discovery = gate();
  const started = gate();
  backend.listDevices = async () => {
    started.resolve();
    await discovery.promise;
    return [{ id: 'camera', name: 'Camera', backend: 'avfoundation' }];
  };
  const acquisition = manager.acquire('camera', 'a');
  const rejected = expect(acquisition).rejects.toThrow('closed');
  await started.promise;
  const closed = manager.close();
  discovery.resolve();
  await rejected;
  await closed;
  expect(closes[0]).toHaveBeenCalledTimes(1);
  await expect(manager.acquire('camera', 'b')).rejects.toThrow('closed');
});
it('persists correction by camera identity and invalidates the binding when geometry changes', async () => {
  const { manager } = await fixture();
  const session = await manager.acquire('camera', 'a');
  const options = { cameraId: 'camera', width: 400, height: 800 };
  await expect(session.binding(options)).rejects.toThrow('Correct the camera');
  const correction = {
    sourceWidth: 1920,
    sourceHeight: 1080,
    rotation: 0 as const,
    points: {
      topLeft: { x: 100, y: 100 },
      topRight: { x: 500, y: 100 },
      bottomRight: { x: 500, y: 900 },
      bottomLeft: { x: 100, y: 900 },
    },
  };
  await session.setCorrection(correction);
  const first = await session.binding(options);
  expect(
    (await session.binding({ ...options, width: 800 })).fingerprint,
  ).not.toBe(first.fingerprint);
  correction.points.topLeft.x = 101;
  expect((await session.binding(options)).fingerprint).toBe(first.fingerprint);
  await manager.release('camera', 'a');
  const restored = await manager.acquire('camera', 'b');
  expect((await restored.binding(options)).fingerprint).toBe(first.fingerprint);
  await restored.setCorrection(correction);
  expect((await restored.binding(options)).fingerprint).not.toBe(
    first.fingerprint,
  );
});
