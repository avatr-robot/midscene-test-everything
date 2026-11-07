import { Mg400Adapter } from '@midscene/arm-adapter-mg400';
import { ArmController, RobotArmDevice, listCameras } from '@midscene/arm-kit';
import { Agent } from '@midscene/core/agent';

const cameras = await listCameras();
if (process.argv.includes('--list-cameras')) {
  console.log(cameras.map(({ id, name }) => ({ id, name })));
  process.exit(0);
}
const camera =
  process.env.CAMERA_ID || (cameras.length === 1 ? cameras[0].id : undefined);
if (!camera)
  throw new Error('Set CAMERA_ID to one of the IDs shown by --list-cameras.');
if (!process.env.ARM_HOST)
  throw new Error('Set ARM_HOST to the controller IP address.');
const arm = new ArmController({
  adapter: new Mg400Adapter({ host: process.env.ARM_HOST }),
});
const device = new RobotArmDevice({ arm, camera });
const abort = new AbortController();
const interrupt = () => abort.abort(new Error('Interrupted by user'));
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
let agent;
try {
  await device.connect();
  if (process.argv.includes('--calibrate'))
    await device.calibrate({ signal: abort.signal });
  console.log('Calibrated screen:', await device.size());
  if (process.env.TASK) {
    if (!(await arm.getState()).enabled) {
      if (!process.argv.includes('--confirm-enable'))
        throw new Error(
          'Arm is disabled. Verify the saved tool and clear workspace, then pass --confirm-enable.',
        );
      await device.enable({ confirmed: true, signal: abort.signal });
    }
    agent = new Agent(device);
    await agent.aiAct(process.env.TASK, { abortSignal: abort.signal });
    console.log('Task completed');
  }
} finally {
  // Cancel physical work before Agent.destroy waits for resource idle.
  try {
    await device.destroy();
  } finally {
    try {
      await agent?.destroy();
    } finally {
      await arm.close();
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
    }
  }
}
