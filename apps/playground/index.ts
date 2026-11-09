import * as cli from '@clack/prompts';
import { startArmPlayground } from '@midscene/arm-kit-playground';
import { playgroundPort, registerShutdown, reportError } from './runtime.js';
import { setupMg400 } from './setup.js';

async function main() {
  const port = playgroundPort();
  const setup = await setupMg400();
  if (!setup) return;
  const playground = await startArmPlayground({ ...setup, port });
  let closing: Promise<void> | undefined;
  registerShutdown(() => {
    closing ??= playground.close();
    return closing;
  });
  cli.outro(`打开 ${playground.url} 查看 Playground。`);
}

main().catch(reportError);
