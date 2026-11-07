import { fileURLToPath } from 'node:url';
import { createRsbuild, loadConfig, mergeRsbuildConfig } from '@rsbuild/core';

/** Workspace-only frontend development server. Phone sessions stay on the backend. */
export async function startDevelopmentUI({
  port,
  backendUrl,
}: {
  port: number;
  backendUrl: string;
}) {
  const cwd = fileURLToPath(
    new URL('../../packages/playground/', import.meta.url),
  );
  const { content, filePath } = await loadConfig({
    cwd,
    envMode: 'development',
  });
  if (!filePath)
    throw new Error(
      'Playground development requires the workspace Rsbuild config.',
    );
  const rsbuild = await createRsbuild({
    cwd,
    rsbuildConfig: mergeRsbuildConfig(content, {
      mode: 'development',
      dev: { hmr: true, liveReload: true, cliShortcuts: false },
      server: {
        host: '127.0.0.1',
        port,
        strictPort: true,
        printUrls: false,
        open: false,
        // Do not buffer long-lived camera and event streams with compression.
        compress: false,
        proxy: {
          '/api': { target: backendUrl, changeOrigin: false },
        },
      },
    }),
  });
  const server = await rsbuild.createDevServer();
  try {
    await server.listen();
  } catch (error) {
    await server.close();
    throw error;
  }
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${server.port}`,
    close() {
      closing ??= server.close();
      return closing;
    },
  };
}
