// The calibration move path must collect each piece of motion evidence once.
// These tests pin the two reductions: the driver's own two-sample arrival
// replaces the application-level dwell, and a target that was just preflighted
// is not queried for reachability a second time before submission.
import { expect, it, rstest } from '@rstest/core';
import { fixture, pose } from './fixtures.js';

const speed = { kind: 'ratio', value: 0.25 } as const;
const acceleration = { kind: 'ratio', value: 0.25 } as const;

it('skips the application dwell when the driver confirmed a two-sample arrival', async () => {
  const f = await fixture();
  try {
    const readPose = rstest.spyOn(f.adapter.driver, 'readPose');
    await f.runtime.collectAutomaticPoints(f.binding, (host) =>
      host.move(pose(100, -50, 101), {
        speed,
        acceleration,
        timeoutMs: 10000,
      }),
    );
    expect(readPose).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});

it('preflights a target once and re-preflights the next target', async () => {
  const f = await fixture();
  try {
    const reachability = rstest.spyOn(f.adapter.driver, 'checkReachability');
    await f.runtime.collectAutomaticPoints(f.binding, async (host) => {
      await host.move(pose(100, -50, 101), {
        speed,
        acceleration,
        timeoutMs: 10000,
      });
      await host.move(pose(100, -50, 102), {
        speed,
        acceleration,
        timeoutMs: 10000,
      });
    });
    // One preflight per target: the second target must not reuse the first
    // target's ticket, and neither move repeats its own preflight.
    expect(reachability).toHaveBeenCalledTimes(2);
  } finally {
    await f.cleanup();
  }
});
