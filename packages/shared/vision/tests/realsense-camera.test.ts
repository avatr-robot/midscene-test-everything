import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@rstest/core';
import { RealsenseCameraBackend } from '../src/camera/realsense-camera-backend.js';
import { RealsenseFrameParser } from '../src/camera/realsense-process-camera-source.js';

const HEADER_BYTES = 28;
const helperPath = fileURLToPath(
  new URL('../native/realsense-depth/helper.py', import.meta.url),
);

function record(
  type: number,
  frameId: number,
  width: number,
  height: number,
  payload: Buffer,
): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  Buffer.from('RSP1').copy(header, 0);
  header.writeUInt32LE(type, 4);
  header.writeUInt32LE(frameId, 8);
  header.writeUInt32LE(width, 12);
  header.writeUInt32LE(height, 16);
  header.writeFloatLE(0.001, 20);
  header.writeUInt32LE(payload.length, 24);
  return Buffer.concat([header, payload]);
}

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: () => true,
  });
}

test('pairs RealSense color, depth and preview records across chunks', () => {
  const depth = Buffer.alloc(4);
  depth.writeUInt16LE(700, 0);
  const depthJpeg = Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
  const colorJpeg = Buffer.from([0xff, 0xd8, 3, 4, 0xff, 0xd9]);
  const wire = Buffer.concat([
    record(1, 17, 2, 1, depth),
    record(2, 17, 2, 1, depthJpeg),
    record(3, 17, 2, 1, colorJpeg),
  ]);
  const parser = new RealsenseFrameParser();
  const frames = [
    ...parser.push(wire.subarray(0, 11)),
    ...parser.push(wire.subarray(11, 37)),
    ...parser.push(wire.subarray(37)),
  ];

  expect(frames).toHaveLength(1);
  expect(frames[0]!.colorJpeg).toEqual(colorJpeg);
  expect(frames[0]!.depthJpeg).toEqual(depthJpeg);
  expect(frames[0]!.depth.data).toEqual(depth);
  expect(frames[0]!.depth.depthScaleMeters).toBeCloseTo(0.001, 6);
});

test('lists paired RealSense RGB and depth endpoints with capture modes', async () => {
  const child = fakeChild();
  const spawnProcess = ((_command: string, args: string[]) => {
    expect(args).toEqual([helperPath, 'list']);
    process.nextTick(() => {
      child.stdout.emit(
        'data',
        Buffer.from(
          '{"devices":[{"serial":"263122073827","name":"RealSense D435I","captureModes":{"color":[{"width":1280,"height":720,"fps":30,"intrinsics":{"fx":910,"fy":910,"cx":640,"cy":360}}],"depth":[{"width":1280,"height":720,"fps":30,"intrinsics":{"fx":900,"fy":900,"cx":640,"cy":360}}]},"depthControls":[{"key":"laser_power","label":"Laser Power","type":"number","min":0,"max":360,"step":30,"default":150,"value":120}]}]}\n',
        ),
      );
      child.emit('close', 0);
    });
    return child;
  }) as unknown as typeof spawn;
  const backend = new RealsenseCameraBackend({
    helperPath,
    pythonPath: 'python',
    spawnProcess,
  });

  const devices = await backend.listDevices();
  expect(devices).toHaveLength(2);
  expect(devices[0]).toMatchObject({
    id: 'realsense:263122073827:color',
    kind: 'color',
    pairedDeviceId: 'realsense:263122073827',
    captureModes: [
      {
        width: 1280,
        height: 720,
        fps: 30,
        intrinsics: { fx: 910, fy: 910, cx: 640, cy: 360 },
      },
    ],
  });
  expect(devices[1]).toMatchObject({
    id: 'realsense:263122073827',
    kind: 'depth',
    pairedDeviceId: 'realsense:263122073827:color',
    controls: [
      {
        key: 'laser_power',
        value: 120,
        min: 0,
        max: 360,
      },
    ],
  });
});
