#!/usr/bin/env node
/**
 * Hardware smoke test for the RealSense backend.
 *
 * Run after `pnpm --filter @midscene/robotics-vision build` and after installing
 * native/realsense-depth/requirements.txt with the service Python interpreter:
 *
 *   pnpm --filter @midscene/robotics-vision realsense:smoke
 */
import { setTimeout as delay } from 'node:timers/promises';
import { RealsenseCameraBackend } from '../dist/index.js';

const backend = new RealsenseCameraBackend();
let source;
let control;
try {
  const devices = await backend.listDevices();
  const depth = devices.find((device) => device.kind === 'depth');
  const color = devices.find((device) => device.kind === 'color');
  if (!depth || !color)
    throw new Error('No paired RealSense RGB and depth endpoints found');
  if (depth.pairedDeviceId !== color.id || color.pairedDeviceId !== depth.id)
    throw new Error('RealSense RGB and depth endpoints are not paired');

  control = await backend.openHardwareControl(color.id);
  if (!control) throw new Error('RealSense RGB control bridge did not open');
  const controls = await control.read();
  for (const property of [
    'exposure',
    'gain',
    'whiteBalance',
    'brightness',
    'contrast',
  ]) {
    if (!controls[property]?.supportsManual)
      throw new Error(`RealSense RGB ${property} control is unavailable`);
  }
  await control.set(
    'exposure',
    controls.exposure.value,
    controls.exposure.mode,
  );
  const written = await control.read();
  if (written.exposure?.mode !== controls.exposure.mode)
    throw new Error('RealSense RGB exposure mode did not persist');

  const mode = depth.captureModes?.[0] ?? {
    width: 1280,
    height: 720,
    fps: 30,
  };
  source = await backend.openStream({
    deviceId: depth.id,
    width: mode.width,
    height: mode.height,
    fps: mode.fps,
    kind: 'depth',
    verticalFlip: false,
    horizontalFlip: false,
  });
  const frame = await Promise.race([
    new Promise((resolve) => source.once('frame', resolve)),
    delay(15_000).then(() => {
      throw new Error('Timed out waiting for a RealSense frame');
    }),
  ]);
  if (
    !frame.depth?.data?.length ||
    frame.depth.data.length !== frame.depth.width * frame.depth.height * 2
  )
    throw new Error('RealSense frame did not contain a complete Z16 depth map');
  if (!frame.alignedColorJpeg?.length)
    throw new Error('RealSense depth frame did not include aligned RGB');

  const nonzeroUnits = [];
  const samples = Math.min(frame.depth.data.length / 2, 100_000);
  for (let index = 0; index < samples; index += 1)
    if (frame.depth.data.readUInt16LE(index * 2) > 0) nonzeroUnits.push(index);
  if (nonzeroUnits.length === 0)
    throw new Error('RealSense depth frame contained no measurements');

  process.stdout.write(
    `PASS ${depth.name} ${mode.width}x${mode.height}@${mode.fps}, ${frame.depth.data.length} depth bytes, ${frame.alignedColorJpeg.length} RGB bytes\n`,
  );
} finally {
  await control?.close();
  await source?.close();
}
