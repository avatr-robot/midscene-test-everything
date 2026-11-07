import type { ArmController } from '@midscene/arm-kit';
import type { PlaygroundTasks } from './tasks.js';

/** Global physical stop precedes any wait for planning or task cleanup. */
export class PlaygroundArmControls {
  private stopping?: Promise<void>;
  constructor(
    private arm: ArmController,
    private tasks: PlaygroundTasks,
  ) {}
  stop() {
    if (this.stopping) return this.stopping;
    this.tasks.abortPlanning();
    this.stopping = this.arm.stop().finally(() => {
      this.stopping = undefined;
    });
    return this.stopping;
  }
  interrupt(kind: 'pause' | 'emergencyStop') {
    if (!['pause', 'emergencyStop'].includes(kind))
      throw new Error('Unsupported interrupt');
    this.tasks.abortPlanning();
    return this.arm[kind]();
  }
  async resume() {
    this.assertIdle();
    await this.arm.resume();
  }
  assertIdle() {
    if (
      this.stopping ||
      this.tasks
        .list()
        .some((task) => task.phase === 'running' || task.phase === 'closing')
    )
      throw new Error('Wait for stopped tasks to finish before continuing');
  }
  async recover() {
    if (
      this.stopping ||
      this.tasks
        .list()
        .some((task) => task.phase === 'running' || task.phase === 'closing')
    ) {
      throw new Error(
        'Wait for stopped tasks to finish before checking recovery',
      );
    }
    await this.arm.recover();
  }
}
