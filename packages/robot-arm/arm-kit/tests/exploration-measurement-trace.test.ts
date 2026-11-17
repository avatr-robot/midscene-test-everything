// Speed work guard: the fast exploration path must keep the same measurement
// trace, and must not need more motion or phone observations than it does now.
//
// The trace below is produced through the production bridge (`AutomaticCapture`)
// with a deterministic phone and a tilted screen. The measurement fields (move
// geometry, samples, plane, phone results, timing buckets) must stay identical
// across A-class speed work. Speed ratios are motion policy: the fast travel
// legs are allowed to run faster (B2), and any change there must show up as a
// speedRatio-only diff when the golden is regenerated.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { afterEach, expect, it, rstest } from '@rstest/core';
import {
  type CalibrationPageUpdate,
  calibrationPageMarkers,
} from '../src/assisted-contracts.js';
import { AutomaticCapture } from '../src/calibration/exploration/capture.js';
import { fixture, pose } from './fixtures.js';

// The sampler and the phone observation wait with `node:timers/promises`, which
// fake timers do not intercept. Route it through the faked global timer instead.
rstest.mock('node:timers/promises', () => ({
  setTimeout: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
}));
afterEach(() => {
  rstest.useRealTimers();
});

const GOLDEN = new URL(
  './golden/exploration-measurement-trace.json',
  import.meta.url,
);
/** Work budget for the deterministic fast scenario; only allowed to go down. */
const MAX_MOVES = 121;
const MAX_PHONE_RESULTS = 109;

const round = (value: number, digits = 3) =>
  Number(value.toFixed(digits)) as number;

it('keeps the fast measurement trace and work budget stable', async () => {
  const f = await fixture();
  rstest.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'performance',
    ],
  });
  const abort = new AbortController();
  const layout = {
    revision: 1,
    width: 400,
    height: 800,
    screen: { width: 400, height: 800, devicePixelRatio: 1 },
    markers: calibrationPageMarkers(400, 800),
  };
  let current = pose(50, -50, 40);
  let sequence = 0;
  let touching = false;
  const moves: Array<{
    x: number;
    y: number;
    z: number;
    speedRatio: number;
  }> = [];
  const phoneResults: Array<{
    outcome: string;
    point?: { x: number; y: number };
  }> = [];
  const timing: Record<string, number> = {};
  const reads = { count: 0 };
  // Tilted screen in the mock world. The slope keeps the plane fit non-trivial
  // while staying inside the fast-mode tilt and height-range limits.
  const surfaceZ = (x: number, y: number) =>
    30 + 0.02 * (x - 50) + 0.015 * (y + 50);
  let collector: AutomaticCapture;
  const send = () => {
    const capture = collector.snapshot().capture;
    const point = {
      x: round(current.positionMm.x * 4),
      y: round(-current.positionMm.y * 8),
    };
    const step = capture?.step;
    const update: CalibrationPageUpdate = {
      pageId: 'page',
      sequence: ++sequence,
      visible: true,
      layout,
      contact: touching ? { id: 'pen', motionRevision: 0, point } : undefined,
      targetReady: capture?.target.id,
      stepFeedback: step
        ? {
            ...step,
            outcome: touching
              ? 'touched'
              : step.phase === 'prepare'
                ? 'ready'
                : 'no_touch',
            point: touching ? point : undefined,
          }
        : undefined,
    };
    if (update.stepFeedback?.phase === 'result')
      phoneResults.push({
        outcome: update.stepFeedback.outcome,
        ...(update.stepFeedback.point && { point: update.stepFeedback.point }),
      });
    collector.receive(update);
  };
  collector = new AutomaticCapture(
    layout,
    f.tool.offsetMm,
    () => queueMicrotask(send),
    'slide',
  );
  send();
  const timer = setInterval(send, 20);
  const job = collector.run(
    {
      signal: abort.signal,
      check: () => abort.signal.throwIfAborted(),
      read: async () => {
        reads.count++;
        return current;
      },
      move: async (target, options) => {
        current = structuredClone(target);
        if (options?.speed?.kind !== 'ratio')
          throw new Error('Expected a speed ratio');
        moves.push({
          x: round(target.positionMm.x),
          y: round(target.positionMm.y),
          z: round(target.positionMm.z),
          speedRatio: round(options.speed.value, 4),
        });
        // Light-contact hysteresis: a held pointer releases two millimetres high.
        touching =
          current.positionMm.z <=
          surfaceZ(current.positionMm.x, current.positionMm.y) +
            (touching ? 2 : 0);
        send();
        return current;
      },
    },
    current,
    {
      tool: f.tool,
      screen: {
        ...f.screen,
        pixelWidth: 400,
        pixelHeight: 800,
        actionSpeed: { kind: 'ratio', value: 0.8 },
      },
      webToImage: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      onTiming: (event: string) => {
        timing[event] = (timing[event] ?? 0) + 1;
      },
    },
  );
  let settled = false;
  const settle = () => {
    settled = true;
  };
  void job.then(settle, settle);
  try {
    for (let step = 0; step < 600 && !settled; step++)
      await rstest.advanceTimersByTimeAsync(1000);
    await job;
    const collected = collector.upstreamResult;
    expect(collected).toBeDefined();
    const fastPlane =
      collected && 'fastPlane' in collected ? collected.fastPlane : undefined;
    if (!collected || !fastPlane)
      throw new Error('Fast exploration returned no plane');
    const result = collected;
    const toSample = (point: {
      contact: { x: number; y: number; z: number };
      screen: { x: number; y: number };
    }) => ({
      x: round(point.contact.x),
      y: round(point.contact.y),
      z: round(point.contact.z),
      screenX: round(point.screen.x),
      screenY: round(point.screen.y),
    });
    const trace = {
      moves,
      phoneResults,
      samples: [
        ...result.probes.map((probe) => ({
          role: 'probe',
          ...toSample(probe),
        })),
        ...result.grid.map((sample) => ({
          role: sample.target.role,
          ...toSample(sample),
        })),
      ],
      plane: {
        tiltDeg: round(fastPlane.tiltDeg),
        heightRangeMm: round(fastPlane.heightRangeMm),
        holdoutHeightMm: round(fastPlane.holdoutHeightMm),
        rmseMm: round(fastPlane.quality.rmseMm),
      },
      calls: {
        moves: moves.length,
        reads: reads.count,
        phoneResults: phoneResults.length,
      },
      timing,
    };
    if (process.env.UPDATE_GOLDEN === '1') {
      await mkdir(new URL('./golden/', import.meta.url), { recursive: true });
      await writeFile(GOLDEN, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');
    }
    const golden = JSON.parse(await readFile(GOLDEN, 'utf8'));
    expect(trace).toEqual(golden);
    // Explicit budgets, so the work reduction is visible in the test itself.
    expect(moves.length).toBeLessThanOrEqual(MAX_MOVES);
    expect(phoneResults.length).toBeLessThanOrEqual(MAX_PHONE_RESULTS);
  } finally {
    clearInterval(timer);
    rstest.useRealTimers();
    await f.cleanup();
  }
});
