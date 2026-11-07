import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from '@rstest/core';
import { startDevelopmentUI } from '../frontend.ts';

// Exercise the actual development proxy without cameras or an arm connection.
test('development server serves HMR and proxies JSON and unbuffered streams', async () => {
  const backend = createServer(async (req, res) => {
    if (req.url === '/api/echo') {
      let body = '';
      for await (const part of req) body += part;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ body, origin: req.headers.origin }));
      return;
    }
    res.setHeader(
      'Content-Type',
      req.url === '/api/events'
        ? 'text/event-stream'
        : 'multipart/x-mixed-replace; boundary=frame',
    );
    res.write('first chunk\n');
    const timer = setInterval(() => res.write('next chunk\n'), 50);
    res.once('close', () => clearInterval(timer));
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const backendUrl = `http://127.0.0.1:${backend.address().port}`;
  // Reserve a free port; strictPort prevents silently switching ports later.
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  let frontend;
  let socket;
  try {
    frontend = await startDevelopmentUI({ port, backendUrl });
    const html = await fetch(frontend.url, {
      signal: AbortSignal.timeout(60000),
    }).then((r) => r.text());
    assert.match(html, /<script/);
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)];
    let token;
    for (const [, path] of scripts) {
      const source = await fetch(new URL(path, frontend.url)).then((r) =>
        r.text(),
      );
      token ??= source.match(/init[^\n]*\(\s*['"]([a-f0-9]+)['"]/)?.[1];
    }
    assert.ok(token, 'compiled page includes the HMR client token');
    socket = new WebSocket(
      `${frontend.url.replace('http:', 'ws:')}/rsbuild-hmr?token=${token}`,
    );
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('HMR connection timed out')),
        10000,
      );
      socket.addEventListener(
        'message',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error('HMR connection failed'));
        },
        { once: true },
      );
    });
    const echo = await fetch(`${frontend.url}/api/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: frontend.url },
      body: '{"value":1}',
    }).then((r) => r.json());
    assert.deepEqual(echo, { body: '{"value":1}', origin: frontend.url });
    for (const path of ['/api/events', '/api/preview']) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(`${frontend.url}${path}`, {
          signal: controller.signal,
        });
        const reader = response.body.getReader();
        const first = await reader.read();
        assert.match(new TextDecoder().decode(first.value), /first chunk/);
        assert.equal(first.done, false);
        const second = await reader.read();
        assert.match(new TextDecoder().decode(second.value), /next chunk/);
        await reader.cancel();
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    }
  } finally {
    socket?.close();
    await frontend?.close();
    backend.closeAllConnections();
    await new Promise((resolve) => backend.close(resolve));
  }
}, 90000);
