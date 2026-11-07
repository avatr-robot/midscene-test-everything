import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from '@rstest/core';
import { developmentBackendPort } from '../backend-port.ts';
test('phone endpoint port survives a restart and a changed frontend port', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'phone-port-'));
  try {
    const file = join(dir, 'dev.json');
    assert.equal(await developmentBackendPort(5173, file), 5174);
    assert.equal(await developmentBackendPort(6000, file), 5174);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
