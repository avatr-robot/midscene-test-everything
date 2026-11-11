// Copy this fixture into a separate project with only the packed arm-kit installed.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArmController, RobotArmDevice } from '@midscene/arm-kit';
import { ProfileStore } from '@midscene/arm-kit/internal/runtime';
import { TestRobotAdapter } from '@midscene/arm-kit/internal/testkit/test-adapter';

assert.equal(typeof RobotArmDevice, 'function');
const directory = await mkdtemp(join(tmpdir(), 'arm-sdk-smoke-'));
const adapter = new TestRobotAdapter();
const arm = new ArmController({
  adapter,
  profileStore: new ProfileStore(join(directory, 'profiles.json')),
});
const stream = new EventEmitter();
stream.getInfo = () => ({ state: 'running' });
const camera = {
  camera: { id: 'test-camera', name: 'Package test camera' },
  stream,
  getCorrection: () => undefined,
  getPerspectiveValidity: () => undefined,
};
const owners = new Set();
const cameraManager = {
  async acquire(_camera, owner) {
    owners.add(owner);
    return camera;
  },
  async release(_camera, owner) {
    owners.delete(owner);
  },
};
const device = new RobotArmDevice({
  arm,
  camera: camera.camera.id,
  id: 'package-test',
  cameraManager,
});
const abort = new AbortController();
let finishListening;
const listening = new Promise((resolve) => {
  finishListening = resolve;
});
let operation;
try {
  await arm.connect();
  operation = device.calibrate({
    open: false,
    signal: abort.signal,
    phoneHost: '127.0.0.1',
    onListening: finishListening,
  });
  // Keep a rejection observed while requests are in flight.
  const completed = operation.then(
    () => undefined,
    (error) => error,
  );
  const url = await Promise.race([listening, operation]);
  const html = await fetch(url).then((response) => response.text());
  assert.match(html, /<!doctype html>/i);
  const assets = [...html.matchAll(/(?:src|href)="([^\"]+\.(?:js|css))"/g)].map(
    (match) => new URL(match[1], url),
  );
  assert.ok(assets.length > 0);
  for (const asset of assets) assert.equal((await fetch(asset)).status, 200);
  const config = await fetch(
    new URL('/api/calibration/configuration', url),
  ).then((response) => response.json());
  assert.equal(config.deviceId, 'package-test');
  assert.equal(config.ready, false);
  assert.equal(config.input, undefined);
  assert.equal((await fetch(new URL('/phone-calibration', url))).status, 403);
  const phone = await fetch(
    new URL('/api/calibration/assisted-calibration/phone', url),
  ).then((response) => response.json());
  assert.equal((await fetch(phone.links[0].url)).status, 200);
  assert.equal(
    (
      await fetch(new URL('/api/calibration/configuration', url), {
        headers: { Origin: 'https://untrusted.example' },
      })
    ).status,
    403,
  );
  abort.abort(new Error('Package smoke finished'));
  assert.match((await completed).message, /Package smoke finished/);
  await assert.rejects(fetch(url));
  assert.equal(adapter.movements.length, 0);
  console.log(
    'PASS: installed SDK device.calibrate(), bundled HTML/assets, setup API, phone token, origin checks and abort cleanup',
  );
} finally {
  abort.abort();
  await operation?.catch(() => undefined);
  await device.destroy();
  assert.equal(owners.size, 0);
  await arm.close();
  await rm(directory, { recursive: true, force: true });
}
