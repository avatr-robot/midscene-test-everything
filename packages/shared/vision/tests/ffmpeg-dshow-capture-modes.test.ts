import { expect, test } from '@rstest/core';
import {
  dshowCaptureMetadata,
  parseDshowCaptureModes,
} from '../src/camera/ffmpeg-camera-backend.js';

test('parses C922 DirectShow ranges into legal resolution and FPS pairs', () => {
  expect(
    parseDshowCaptureModes(`
      [dshow @ 0]  pixel_format=yuyv422  min s=1920x1080 fps=5 max s=1920x1080 fps=5
      [dshow @ 0]  vcodec=mjpeg  min s=1920x1080 fps=5 max s=1920x1080 fps=30
      [dshow @ 0]  vcodec=mjpeg  min s=1280x720 fps=5 max s=1280x720 fps=60.0002
      [dshow @ 0]  vcodec=mjpeg  min s=2304x1536 fps=2 max s=2304x1536 fps=2
      [dshow @ 0]  vcodec=mjpeg  min s=1600x896 fps=5 max s=1600x896 fps=7.5
    `),
  ).toEqual([
    { width: 2304, height: 1536, fps: 2 },
    { width: 1920, height: 1080, fps: 30 },
    { width: 1920, height: 1080, fps: 25 },
    { width: 1920, height: 1080, fps: 24 },
    { width: 1920, height: 1080, fps: 20 },
    { width: 1920, height: 1080, fps: 15 },
    { width: 1920, height: 1080, fps: 10 },
    { width: 1920, height: 1080, fps: 5 },
    { width: 1600, height: 896, fps: 5 },
    { width: 1280, height: 720, fps: 60 },
    { width: 1280, height: 720, fps: 50 },
    { width: 1280, height: 720, fps: 30 },
    { width: 1280, height: 720, fps: 25 },
    { width: 1280, height: 720, fps: 24 },
    { width: 1280, height: 720, fps: 20 },
    { width: 1280, height: 720, fps: 15 },
    { width: 1280, height: 720, fps: 10 },
    { width: 1280, height: 720, fps: 5 },
  ]);
});

test('publishes DirectShow modes without changing startup defaults', () => {
  expect(
    dshowCaptureMetadata([
      { width: 1920, height: 1080, fps: 30 },
      { width: 1280, height: 720, fps: 30 },
    ]),
  ).toEqual({
    captureModes: [
      { width: 1920, height: 1080, fps: 30 },
      { width: 1280, height: 720, fps: 30 },
    ],
  });
});
