import { afterEach, beforeEach, expect, it, rstest } from '@rstest/core';
import {
  type CalibrationPageUpdate,
  calibrationPageMarkers,
} from '../src/assisted-contracts.js';
import { StationaryPhoneObservation } from '../src/calibration/exploration/phone-observation.js';
import type { ProbePurpose } from '../src/calibration/exploration/types.js';

rstest.mock('node:timers/promises', () => ({
  setTimeout: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
}));
beforeEach(() => {
  rstest.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'performance'],
  });
});
afterEach(() => rstest.useRealTimers());

const layout = {
  revision: 1,
  width: 400,
  height: 800,
  screen: { width: 400, height: 800, devicePixelRatio: 1 },
  markers: calibrationPageMarkers(400, 800),
};
const point = { x: 110, y: 250 };
type Feedback = NonNullable<CalibrationPageUpdate['stepFeedback']>;

function start(
  purpose: ProbePurpose = 'search',
  settleMs = 0,
  allowBriefContactGaps?: boolean,
) {
  let sequence = 4;
  const observation = new StationaryPhoneObservation(
    'sample',
    'target',
    purpose,
    30,
    sequence,
    performance.now(),
  );
  const abort = new AbortController();
  const publish = rstest.fn();
  const result = observation.measure(
    { signal: abort.signal, check: () => abort.signal.throwIfAborted() },
    publish,
    400,
    settleMs,
    allowBriefContactGaps,
  );
  void result.catch(() => {});
  const report = (
    outcome: Feedback['outcome'],
    fields: Partial<Feedback> = {},
    update: Partial<CalibrationPageUpdate> = {},
  ) => {
    const feedback: Feedback = {
      ...observation.step!,
      outcome,
      point: outcome === 'touched' ? point : undefined,
      ...fields,
    };
    observation.receive({
      pageId: 'page',
      sequence: ++sequence,
      visible: true,
      layout,
      targetReady: 'target',
      stepFeedback: feedback,
      ...update,
    });
  };
  return { observation, abort, publish, result, report };
}

it('waits at the same pose through a 3 s ACK delay and rejects stale and wrong-target replies', async () => {
  const f = start();
  f.report('ready', { id: 'previous-sample' });
  f.report('ready', {}, { targetReady: 'other' });
  f.report('ready', {}, { sequence: 3 });
  await rstest.advanceTimersByTimeAsync(3000);
  expect(f.publish).toHaveBeenCalledTimes(1);
  f.report('ready');
  await rstest.advanceTimersByTimeAsync(120);
  expect(f.observation.step?.phase).toBe('result');
  f.report('ready', { phase: 'prepare' });
  expect(f.observation.diagnostics().replies).toHaveLength(1);
  f.report('no_touch');
  await rstest.advanceTimersByTimeAsync(20);
  await expect(f.result).resolves.toBeUndefined();
  expect(f.observation.diagnostics()).toMatchObject({
    outcome: 'no_touch',
    purpose: 'search',
    requestedTipZMm: 30,
    replies: [
      { phase: 'prepare', roundTripMs: 3000 },
      { phase: 'result', outcome: 'no_touch' },
    ],
  });
  expect(f.observation.step).toBeUndefined();
});

it.each([
  ['coarse-search', 'ready', 50],
  ['coarse-search', 'touched', 100],
  ['search', 'ready', 100],
] as const)(
  'waits the expected interval for %s with first reply %s',
  async (purpose, firstReply, intervalMs) => {
    const f = start(purpose);
    f.report(firstReply);
    await rstest.advanceTimersByTimeAsync(intervalMs - 1);
    expect(f.observation.step?.phase).toBe('prepare');
    await rstest.advanceTimersByTimeAsync(1);
    expect(f.observation.step?.phase).toBe('result');
    f.report(firstReply === 'ready' ? 'no_touch' : 'touched');
    await expect(f.result).resolves.toEqual(
      firstReply === 'ready' ? undefined : point,
    );
  },
);

it('restores the full interval when coarse search detects a late contact', async () => {
  const f = start('coarse-search');
  f.report('ready');
  await rstest.advanceTimersByTimeAsync(70);
  expect(f.observation.step?.phase).toBe('result');
  f.report('touched');
  await rstest.advanceTimersByTimeAsync(99);
  expect(f.observation.step?.id).toBe('sample');
  await rstest.advanceTimersByTimeAsync(1);
  expect(f.observation.step?.id).toBe('sample-confirm');
  f.report('touched', { id: 'sample' });
  expect(f.observation.diagnostics().replies).toHaveLength(2);
  f.report('touched');
  await expect(f.result).resolves.toEqual(point);
});

it('aborts immediately while waiting for a phone reply', async () => {
  const f = start();
  f.abort.abort();
  await expect(f.result).rejects.toMatchObject({ name: 'AbortError' });
  expect(f.observation.step).toBeUndefined();
});

it('does not turn a short touch overwritten between server polls into a clear descent', async () => {
  const f = start('refine');
  f.report('ready');
  await rstest.advanceTimersByTimeAsync(120);
  // The prior prepare is still displayed while the result request is in flight.
  f.report('touched', { phase: 'prepare' });
  f.report('ready', { phase: 'prepare' });
  f.report('no_touch');
  await rstest.advanceTimersByTimeAsync(20);
  await expect(f.result).rejects.toMatchObject({
    code: 'PHONE_TOUCH_UNSTABLE',
  });
  expect(f.observation.diagnostics().changes).toBe(2);
});

it.each(['press', 'search-limit', 'slide'] as const)(
  'waits at a %s pose for a touch that arrives 465 ms after a clear reply',
  async (purpose) => {
    const f = start(purpose);
    f.report('ready');
    await rstest.advanceTimersByTimeAsync(465);
    expect(f.publish).toHaveBeenCalledTimes(1);
    f.report('touched');
    expect(f.observation.diagnostics().lastContactChange).toMatchObject({
      elapsedMs: 465,
      outcome: 'touched',
    });
    await rstest.advanceTimersByTimeAsync(305);
    expect(f.observation.step?.phase).toBe('result');
    f.report('touched');
    await rstest.advanceTimersByTimeAsync(120);
    expect(f.observation.step?.id).toBe('sample-confirm');
    f.report('touched');
    await rstest.advanceTimersByTimeAsync(20);
    await expect(f.result).resolves.toEqual(point);
  },
);

it('starts reading during the press dwell and waits for settling before confirmation', async () => {
  const f = start('press', 250);
  f.report('touched');
  await rstest.advanceTimersByTimeAsync(249);
  expect(f.observation.step?.phase).toBe('prepare');
  await rstest.advanceTimersByTimeAsync(1);
  expect(f.observation.step?.phase).toBe('result');
  f.report('touched');
  await rstest.advanceTimersByTimeAsync(20);
  await expect(f.result).resolves.toEqual(point);
});

it('keeps a release before the first browser paint from confirming a clear search pose', async () => {
  const f = start('search');
  f.report('ready', { releasedBeforeAck: true });
  f.report('ready', { releasedBeforeAck: true });
  await rstest.advanceTimersByTimeAsync(20);
  await expect(f.result).rejects.toMatchObject({
    code: 'PHONE_TOUCH_UNSTABLE',
  });
  expect(f.observation.diagnostics().changes).toBe(1);
  expect(f.observation.diagnostics().replies[0].releasedBeforeAck).toBe(true);
});

it.each(['search', 'press'] as const)(
  'requires two fresh touch readings after a brief %s contact gap',
  async (purpose) => {
    const f = start(purpose, 0, purpose === 'press' ? true : undefined);
    f.report('touched');
    await rstest.advanceTimersByTimeAsync(20);
    f.report('ready');
    await rstest.advanceTimersByTimeAsync(17);
    const recovered = { x: point.x + 0.5, y: point.y };
    f.report('touched', { point: recovered });
    await rstest.advanceTimersByTimeAsync(83);
    f.report('touched', { point: recovered });
    await rstest.advanceTimersByTimeAsync(120);
    expect(f.observation.step?.id).toBe('sample-confirm');
    f.report('touched', { point: recovered });
    await rstest.advanceTimersByTimeAsync(20);
    await expect(f.result).resolves.toEqual(recovered);
    expect(f.observation.diagnostics().recoveredContactGaps).toBe(1);
  },
);

it.each(['no return', 'distant return'] as const)(
  'rejects a search contact gap with %s',
  async (kind) => {
    const f = start();
    f.report('touched');
    await rstest.advanceTimersByTimeAsync(20);
    f.report('ready');
    await rstest.advanceTimersByTimeAsync(17);
    if (kind === 'distant return')
      f.report('touched', { point: { x: point.x + 5, y: point.y } });
    await rstest.advanceTimersByTimeAsync(83);
    if (kind === 'no return') f.report('no_touch');
    await rstest.advanceTimersByTimeAsync(80);
    await expect(f.result).rejects.toMatchObject({
      code: 'PHONE_TOUCH_UNSTABLE',
      details: { reason: 'intermittent_contact' },
    });
  },
);

it('confirms a delayed release on two independent clear reads', async () => {
  const f = start('release');
  f.report('touched');
  await rstest.advanceTimersByTimeAsync(120);
  f.report('no_touch');
  await rstest.advanceTimersByTimeAsync(120);
  f.report('no_touch');
  await rstest.advanceTimersByTimeAsync(20);
  await expect(f.result).resolves.toBeUndefined();
  expect(f.observation.diagnostics().replies).toHaveLength(3);
});

it('requires stable coordinates before pairing a moving pointer with a slide endpoint', async () => {
  const f = start('slide');
  f.report('touched', { point: { x: 10, y: 10 } });
  await rstest.advanceTimersByTimeAsync(120);
  f.report('touched', { point: { x: 40, y: 50 } });
  await rstest.advanceTimersByTimeAsync(120);
  f.report('touched');
  await rstest.advanceTimersByTimeAsync(20);
  await expect(f.result).rejects.toMatchObject({
    code: 'PHONE_TOUCH_UNSTABLE',
  });
});

it('times out with the phase and last update when heartbeats never confirm the result', async () => {
  const f = start();
  f.report('ready');
  await rstest.advanceTimersByTimeAsync(4800);
  f.report('no_touch', { id: 'superseded' });
  await rstest.advanceTimersByTimeAsync(220);
  await expect(f.result).rejects.toMatchObject({
    code: 'PHONE_STEP_TIMEOUT',
    details: {
      phase: 'result',
      stepId: 'sample',
      elapsedMs: 5000,
      lastUpdateAgeMs: 200,
      lastFeedbackId: 'superseded',
    },
  });
  expect(f.observation.diagnostics().replies).toHaveLength(1);
});

it('keeps cancellation and multiple pointers distinct from an explicit no-touch reading', async () => {
  for (const [reason, code] of [
    ['pointer_cancelled', 'PHONE_TOUCH_UNSTABLE'],
    ['multiple_contacts', 'TOUCH_AMBIGUOUS'],
  ] as const) {
    const f = start('press');
    f.report('unknown', { reason });
    f.report('ready');
    await rstest.advanceTimersByTimeAsync(20);
    await expect(f.result).rejects.toMatchObject({ code });
  }
});
