import { readFile } from 'node:fs/promises';
import { Mg400Adapter } from '@midscene/arm-adapter-mg400';
import { ArmController, RobotArmDevice } from '@midscene/arm-kit';
import { Agent } from '@midscene/core/agent';

const { ARM_HOST, CAMERA_A, CAMERA_B, TRANSFER_ROUTES, TASK_A, TASK_B } =
  process.env;
if (!ARM_HOST || !CAMERA_A || !CAMERA_B || CAMERA_A === CAMERA_B)
  throw new Error(
    'Set ARM_HOST and two different camera IDs: CAMERA_A and CAMERA_B.',
  );
if (!TRANSFER_ROUTES || !process.argv.includes('--confirm-transfer'))
  throw new Error(
    'Provide a measured TRANSFER_ROUTES JSON file and --confirm-transfer after checking both physical corridors.',
  );
// Each array contains measured Base-frame flange poses, not image coordinates.
// Saved observation poses are added by the SDK. Empty arrays mean a confirmed direct corridor.
const routes = JSON.parse(await readFile(TRANSFER_ROUTES, 'utf8'));
if (!Array.isArray(routes.aToB) || !Array.isArray(routes.bToA))
  throw new Error(
    'TRANSFER_ROUTES must contain aToB and bToA waypoint arrays.',
  );
const arm = new ArmController({
  adapter: new Mg400Adapter({ host: ARM_HOST }),
});
const a = new RobotArmDevice({ arm, camera: CAMERA_A });
const b = new RobotArmDevice({ arm, camera: CAMERA_B });
const abort = new AbortController();
const interrupt = () => abort.abort(new Error('Interrupted by user'));
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
const agents = [];
const errors = [];
try {
  await Promise.all([a.connect(), b.connect()]);
  if (process.argv.includes('--calibrate')) {
    await a.calibrate({ signal: abort.signal });
    await b.calibrate({ signal: abort.signal });
  }
  if (!(await arm.getState()).enabled) {
    if (!process.argv.includes('--confirm-enable'))
      throw new Error(
        'Arm is disabled. Verify the saved tool and clear workspace, then pass --confirm-enable.',
      );
    await a.enable({ confirmed: true, signal: abort.signal });
  }
  // Validation never moves. Routes belong to this Controller instance and are directional.
  await a.configureTransferTo(b, {
    confirmed: true,
    waypoints: routes.aToB,
    signal: abort.signal,
  });
  await b.configureTransferTo(a, {
    confirmed: true,
    waypoints: routes.bToA,
    signal: abort.signal,
  });
  console.log(
    'Both transfer directions verified for the current device configurations.',
  );
  const tasks = [];
  for (const [device, task] of [
    [a, TASK_A],
    [b, TASK_B],
  ]) {
    if (!task) continue;
    const agent = new Agent(device);
    agents.push(agent);
    tasks.push(agent.aiAct(task, { abortSignal: abort.signal }));
  }
  // Agents plan independently. Their physical gestures and transfers share one queue.
  const results = await Promise.allSettled(tasks);
  const failures = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length)
    throw new AggregateError(failures, 'One or more device tasks failed');
} catch (error) {
  errors.push(error);
} finally {
  const devicesClosed = await Promise.allSettled([a.destroy(), b.destroy()]);
  const agentsClosed = await Promise.allSettled(
    agents.map((agent) => agent.destroy()),
  );
  const armClosed = await Promise.allSettled([arm.close()]);
  errors.push(
    ...[...devicesClosed, ...agentsClosed, ...armClosed]
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason),
  );
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
}
if (errors.length)
  throw new AggregateError(errors, 'Multi-device execution or cleanup failed');
