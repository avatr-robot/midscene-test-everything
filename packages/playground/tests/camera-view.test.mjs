import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from '@rstest/core';
import { streamCameraPreview } from '../src/server/camera-preview.ts';

function fixture() {
  const stream = new EventEmitter();
  const res = Object.assign(new EventEmitter(), {
    frames: [],
    destroyed: false,
    writableEnded: false,
    writable: true,
    writeHead() {
      this.headersSent = true;
    },
    write(data) {
      this.frames.push(data.toString());
      return this.writable;
    },
    end() {
      this.writableEnded = true;
      this.emit('close');
    },
    destroy() {
      this.destroyed = true;
      this.emit('close');
    },
  });
  let calls = 0;
  const entry = {
    camera: { stream },
    device: {
      configuration: async () => ({}),
      screenshotBase64: async () => {
        calls++;
        return Buffer.from('corrected').toString('base64');
      },
    },
  };
  return { stream, res, entry, calls: () => calls };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('raw preview keeps camera pixels and respects response backpressure', async () => {
  const f = fixture();
  await streamCameraPreview(f.res, f.entry);
  f.res.writable = false;
  f.stream.emit('frame', { jpeg: Buffer.from('raw') });
  f.stream.emit('frame', { jpeg: Buffer.from('dropped') });
  assert.equal(f.res.frames.length, 1);
  assert.ok(f.res.frames[0].includes('raw'));
  assert.equal(f.calls(), 0);
  f.res.emit('drain');
  f.stream.emit('frame', { jpeg: Buffer.from('next') });
  assert.equal(f.res.frames.length, 2);
  f.res.destroy();
  assert.equal(f.stream.listenerCount('frame'), 0);
});

test('corrected preview uses accepted device mapping and never queues parallel transforms', async () => {
  const f = fixture();
  let finish;
  let calls = 0;
  f.entry.device.screenshotBase64 = () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  await streamCameraPreview(f.res, f.entry, true);
  f.stream.emit('frame', { jpeg: Buffer.from('raw') });
  f.stream.emit('frame', { jpeg: Buffer.from('raw') });
  assert.equal(calls, 1);
  finish(Buffer.from('corrected').toString('base64'));
  await tick();
  assert.ok(f.res.frames[0].includes('corrected'));
  assert.ok(!f.res.frames[0].includes('raw'));
  f.stream.emit('stopped');
  assert.equal(f.stream.listenerCount('frame'), 0);
  assert.equal(f.res.writableEnded, true);
});

test('invalid calibration rejects corrected view before streaming; transform failure never falls back to raw', async () => {
  const f = fixture();
  f.entry.device.configuration = async () => {
    throw new Error('Calibration required');
  };
  await assert.rejects(
    streamCameraPreview(f.res, f.entry, true),
    /Calibration required/,
  );
  assert.equal(f.res.headersSent, undefined);
  f.entry.device.configuration = async () => ({});
  f.entry.device.screenshotBase64 = async () => {
    throw new Error('Mapping changed');
  };
  await streamCameraPreview(f.res, f.entry, true);
  f.stream.emit('frame', { jpeg: Buffer.from('raw') });
  await tick();
  assert.equal(f.res.destroyed, true);
  assert.equal(f.res.frames.length, 0);
  assert.equal(f.stream.listenerCount('frame'), 0);
});

test('closing a preview during correction discards the pending frame', async () => {
  const f = fixture();
  let finish;
  f.entry.device.screenshotBase64 = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  await streamCameraPreview(f.res, f.entry, true);
  f.stream.emit('frame', { jpeg: Buffer.from('raw') });
  f.res.destroy();
  finish(Buffer.from('corrected').toString('base64'));
  await tick();
  assert.equal(f.res.frames.length, 0);
});
