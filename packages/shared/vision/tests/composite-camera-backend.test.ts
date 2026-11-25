import { expect, test } from '@rstest/core';
import { CompositeCameraBackend } from '../src/camera/composite-camera-backend.js';

test('keeps conventional cameras available when the RealSense backend fails', async () => {
  const camera = {
    id: 'dshow:USB Camera',
    name: 'USB Camera',
    backend: 'dshow' as const,
    kind: 'color' as const,
  };
  const backend = new CompositeCameraBackend([
    {
      listDevices: async () => {
        throw new Error('pyrealsense2 is unavailable');
      },
      openStream: async () => {
        throw new Error('unused');
      },
    },
    {
      listDevices: async () => [camera],
      openStream: async () => {
        throw new Error('unused');
      },
    },
  ]);

  await expect(backend.listDevices()).resolves.toEqual([camera]);
});
