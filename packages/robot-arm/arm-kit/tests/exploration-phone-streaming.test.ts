// The phone can stream an active step instead of answering each result read.
// The host still accepts only two agreeing frames at least 100 ms apart, and
// still refuses an ambiguous contact; these tests pin that path.
import { expect, it } from '@rstest/core';
import type { CalibrationPageUpdate } from '../src/assisted-contracts.js';
import { StationaryPhoneObservation } from '../src/calibration/exploration/phone-observation.js';

const layout = {
  width: 400,
  height: 800,
  screen: { width: 400, height: 800, devicePixelRatio: 1 },
  markers: [],
} as unknown as CalibrationPageUpdate['layout'];

function harness(targetId: string) {
  const observation = new StationaryPhoneObservation(
    'sample',
    targetId,
    'press',
    -1,
    0,
    performance.now(),
    undefined,
    undefined,
    true,
  );
  const abort = new AbortController();
  let sequence = 0;
  const reply = (
    outcome: 'ready' | 'touched' | 'no_touch' | 'unknown',
    point?: { x: number; y: number },
    reason?: 'multiple_contacts' | 'pointer_cancelled',
  ) => {
    const step = observation.step;
    if (!step) return;
    observation.receive({
      pageId: 'page',
      sequence: ++sequence,
      visible: true,
      layout,
      targetReady: targetId,
      contact: point ? { id: 'pen', motionRevision: 0, point } : undefined,
      stepFeedback: {
        ...step,
        contactMode: 'current',
        outcome,
        point,
        reason,
      },
    } as CalibrationPageUpdate);
  };
  return {
    observation,
    reply,
    host: {
      signal: abort.signal,
      check: () => abort.signal.throwIfAborted(),
    },
  };
}

it('confirms a streamed stationary result from two frames 100 ms apart', async () => {
  const { observation, reply, host } = harness('target');
  const timer = setInterval(() => {
    const step = observation.step;
    if (!step) return;
    if (step.phase === 'prepare') reply('ready');
    else reply('touched', { x: 12, y: 34 });
  }, 20);
  try {
    const started = performance.now();
    const point = await observation.measure(host, () => {}, 400, 100);
    const elapsed = performance.now() - started;
    expect(point).toEqual({ x: 12, y: 34 });
    // The settle window and the 100 ms confirmation spacing both still apply.
    expect(elapsed).toBeGreaterThanOrEqual(150);
  } finally {
    clearInterval(timer);
  }
});

it('accepts a streamed no-touch result only after two frames', async () => {
  const { observation, reply, host } = harness('target');
  const timer = setInterval(() => {
    const step = observation.step;
    if (!step) return;
    if (step.phase === 'prepare') reply('ready');
    else reply('no_touch');
  }, 20);
  try {
    await expect(observation.measure(host, () => {}, 400, 100)).resolves.toBe(
      undefined,
    );
  } finally {
    clearInterval(timer);
  }
});

it('still refuses an ambiguous streamed contact', async () => {
  const { observation, reply, host } = harness('target');
  const timer = setInterval(() => {
    const step = observation.step;
    if (!step) return;
    if (step.phase === 'prepare') reply('ready');
    else reply('unknown', undefined, 'multiple_contacts');
  }, 20);
  try {
    await expect(
      observation.measure(host, () => {}, 400, 100),
    ).rejects.toMatchObject({ code: 'TOUCH_AMBIGUOUS' });
  } finally {
    clearInterval(timer);
  }
});

it('stops waiting shortly when a streaming page sends no result frames', async () => {
  const { observation, reply, host } = harness('target');
  const timer = setInterval(() => {
    // Acknowledge the prepare request, then never stream a result frame.
    if (observation.step?.phase === 'prepare') reply('ready');
  }, 20);
  try {
    const started = performance.now();
    await expect(
      observation.measure(host, () => {}, 400, 100),
    ).rejects.toMatchObject({ code: 'PHONE_STEP_TIMEOUT' });
    // One settle window plus the confirm budget, not the 5 s request timeout.
    expect(performance.now() - started).toBeLessThan(1200);
  } finally {
    clearInterval(timer);
  }
});
