import { expect, it, rstest } from '@rstest/core';
import {
  ScreenCalibClient,
  markerRequest,
} from '../../src/ui/calibration/marker-client';

it('lets perspective clearing bypass a blocked screen request', async () => {
  const blocked = new AbortController();
  const fetchMock = rstest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input, init) => {
      if (String(input).endsWith('/hold')) {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal!.reason),
            { once: true },
          );
        });
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
  const held = markerRequest('/hold', undefined, blocked.signal);
  await new Promise((resolve) => setImmediate(resolve));

  try {
    await expect(
      new ScreenCalibClient('camera').clearCameraPerspectives('camera'),
    ).resolves.toEqual({ ok: true });
    const clear = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith('/api/screen-pages'),
    );
    expect(JSON.parse(String(clear?.[1]?.body))).toEqual({
      cameraId: 'camera',
      action: 'clear-perspectives',
    });
  } finally {
    blocked.abort();
    await expect(held).rejects.toMatchObject({ name: 'AbortError' });
    fetchMock.mockRestore();
  }
});
