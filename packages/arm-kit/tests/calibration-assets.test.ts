import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from '@rstest/core';
import { resolveCalibrationDirectory } from '../src/calibration-server/standalone.js';

it('normalizes the asset root so trailing separators do not reject the index page', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'arm-assets-'));
  try {
    await writeFile(path.join(directory, 'index.html'), '<html></html>');
    expect(await resolveCalibrationDirectory(`${directory}/`)).toBe(
      path.resolve(directory),
    );
    const missing = path.join(directory, 'missing');
    await mkdir(missing);
    await expect(resolveCalibrationDirectory(missing)).rejects.toThrow(
      'Calibration page not found',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
