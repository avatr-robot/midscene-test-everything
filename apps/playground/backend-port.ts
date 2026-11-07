import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/** Never silently move the phone endpoint to a new port after a restart. */
export async function developmentBackendPort(
  webPort: number,
  file = resolve('.midscene/arm-kit/playground-dev.json'),
) {
  let saved: { backendPort?: number } = {};
  try {
    saved = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const port = Number(
    process.env.ARM_PLAYGROUND_BACKEND_PORT ?? saved.backendPort ?? webPort + 1,
  );
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === webPort)
    throw new Error('手机服务端口必须是 1–65535，且不能与网页端口相同。');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify({ backendPort: port }), {
    mode: 0o600,
  });
  await rename(`${file}.tmp`, file);
  return port;
}
