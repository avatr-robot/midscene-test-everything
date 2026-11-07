import * as cli from '@clack/prompts';
import { startArmPlayground } from '@midscene/arm-kit-playground';
import { developmentBackendPort } from './backend-port.js';
import { startDevelopmentUI } from './frontend.js';
import { playgroundPort, registerShutdown, reportError } from './runtime.js';
import { setupMg400 } from './setup.js';

async function main() {
  const webPort = playgroundPort();
  const setup = await setupMg400();
  if (!setup) return;
  const playground = await startArmPlayground({
    ...setup,
    port: await developmentBackendPort(webPort),
    developmentOrigins: [
      `http://127.0.0.1:${webPort}`,
      `http://localhost:${webPort}`,
    ],
  });
  let frontend: { url: string; close(): Promise<void> } | undefined;
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      try {
        await frontend?.close();
      } finally {
        await playground.close();
      }
    })();
    return closing;
  };
  registerShutdown(close);
  try {
    frontend = await startDevelopmentUI({
      port: webPort,
      backendUrl: playground.url,
    });
    if (closing) {
      await frontend.close();
      return;
    }
    cli.outro(`打开 ${frontend?.url ?? playground.url}，点击「连接机械臂」。`);
  } catch (error) {
    await close();
    throw error;
  }
}

main().catch(reportError);
