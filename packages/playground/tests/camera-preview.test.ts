import assert from 'node:assert/strict';
import { afterAll, afterEach, test } from '@rstest/core';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type CameraEntry, useCameras } from '../src/ui/cameras';
import { CameraRail } from '../src/ui/components/CameraRail';

const globals = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globals.React;
globals.React = React;
const originalFetch = globalThis.fetch;
afterAll(() => {
  globals.React = previousReact;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  useCameras.setState(useCameras.getInitialState());
});

const camera: CameraEntry = {
  id: 'usb/camera',
  name: 'USB Camera',
  stream: { state: 'running', width: 1920, height: 1080, hasFrame: true },
};

test('thumbnail uses the running camera preview and stops showing it when stopped', () => {
  const render = (entry: CameraEntry) =>
    renderToStaticMarkup(
      React.createElement(CameraRail, {
        entries: [entry],
        selectedId: entry.id,
        onSelect: () => {},
      }),
    );
  const running = render(camera);
  assert.ok(running.includes('/api/cameras/preview?id=usb%2Fcamera'));
  assert.ok(running.includes('运行中'));
  assert.ok(!running.includes('未启动'));
  const stopped = render({ ...camera, stream: undefined });
  assert.ok(!stopped.includes('<img'));
  assert.ok(stopped.includes('未启动'));
});

test('a failed list refresh preserves the selected stream and reports the error', async () => {
  useCameras.setState({
    cameras: [camera],
    selectedId: camera.id,
    status: 'ready',
  });
  globalThis.fetch = async () => {
    assert.equal(useCameras.getState().status, 'loading');
    assert.equal(useCameras.getState().cameras[0], camera);
    throw new Error('Refresh failed');
  };
  await useCameras.getState().refresh();
  assert.equal(useCameras.getState().selectedId, camera.id);
  assert.equal(useCameras.getState().cameras[0], camera);
  assert.equal(useCameras.getState().error, 'Refresh failed');

  globalThis.fetch = async () => new Response(JSON.stringify({ cameras: [] }));
  await useCameras.getState().refresh();
  assert.equal(useCameras.getState().selectedId, null);
  assert.deepEqual(useCameras.getState().cameras, []);
  assert.equal(useCameras.getState().error, undefined);
});
