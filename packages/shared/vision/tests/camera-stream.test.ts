import { EventEmitter } from 'node:events';
import { expect, it } from '@rstest/core';
import { CameraStream } from '../src/camera/camera-stream.js';

it('waits for the failed capture to close before releasing the stream', async () => {
  const source = new EventEmitter();
  let finishClose!: () => void;
  const closed = new Promise<void>((resolve) => {
    finishClose = resolve;
  });
  const stream = new CameraStream(
    'test-stream',
    {
      listDevices: async () => [],
      openStream: async () => Object.assign(source, { close: () => closed }),
    },
    {
      deviceId: 'test-camera',
      width: 640,
      height: 480,
      fps: 30,
      verticalFlip: false,
      horizontalFlip: false,
    },
  );
  await stream.start();
  source.emit('error', new Error('capture failed'));

  let stopped = false;
  const stopping = stream.stop().then(() => {
    stopped = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(stopped).toBe(false);
  finishClose();
  await stopping;
  expect(stopped).toBe(true);
});

it('exposes the latest aligned depth frame and stream metadata', async () => {
  const source = new EventEmitter();
  const stream = new CameraStream(
    'depth-stream',
    {
      listDevices: async () => [],
      openStream: async () => Object.assign(source, { close: async () => {} }),
    },
    {
      deviceId: 'realsense:serial',
      width: 2,
      height: 1,
      fps: 30,
      kind: 'depth',
      verticalFlip: false,
      horizontalFlip: false,
    },
  );
  await stream.start();
  const color = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const data = Buffer.alloc(4);
  data.writeUInt16LE(1000, 0);
  source.emit('frame', {
    jpeg: Buffer.from([1, 2]),
    alignedColorJpeg: color,
    depth: {
      width: 2,
      height: 1,
      depthScaleMeters: 0.001,
      data,
      alignedTo: 'color',
    },
  });

  expect(stream.getInfo()).toMatchObject({
    kind: 'depth',
    state: 'running',
    depth: {
      width: 2,
      height: 1,
      scaleMeters: 0.001,
      alignedTo: 'color',
    },
  });
  expect(stream.getDepthFrame().data).toEqual(data);
  expect(stream.currentFrame?.alignedColorJpeg).toEqual(color);
  await stream.stop();
});
