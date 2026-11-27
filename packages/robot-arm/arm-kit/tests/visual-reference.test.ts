import { expect, it } from '@rstest/core';
import {
  type VisualReferenceStep,
  findVisualReference,
} from '../src/calibration/visual-reference.js';
import type { CartesianPose } from '../src/contracts.js';

const pose = (x: number, y: number): CartesianPose => ({
  frame: 'base',
  positionMm: { x, y, z: 50 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
});
const outline = [
  { x: 0, y: 0 },
  { x: 1000, y: 0 },
  { x: 1000, y: 1000 },
  { x: 0, y: 1000 },
];
/** 2 normalized units per mm, with the image axes aligned to robot X/Y. */
const tipFor = (value: CartesianPose) => ({
  x: 500 + value.positionMm.x * 2,
  y: 500 + value.positionMm.y * 2,
});

it('servos the stylus from an off-centre visible start into the screen inset', async () => {
  let current = pose(80, -40);
  const moves: CartesianPose[] = [];
  const result = await findVisualReference({
    start: current,
    outline,
    observe: async () => {
      const tip = tipFor(current);
      return {
        tip,
        hovering: Math.hypot(tip.x - 500, tip.y - 500) <= 10,
      };
    },
    canMove: () => true,
    move: async (target) => {
      current = target;
      moves.push(target);
      return target;
    },
  });
  expect(moves.length).toBeGreaterThan(0);
  // The servo stops once the tip is inside the screen inset and confirmed
  // hovering; it does not need to land on the exact centre.
  expect(
    Math.hypot(result.positionMm.x, result.positionMm.y),
  ).toBeLessThanOrEqual(5);
  const tip = tipFor(result);
  expect(Math.hypot(tip.x - 500, tip.y - 500)).toBeLessThanOrEqual(10);
  expect(result.positionMm.z).toBe(50);
});

it('returns the start unchanged when the tip is already inset', async () => {
  const start = pose(5, -5);
  let moves = 0;
  const result = await findVisualReference({
    start,
    outline,
    observe: async () => {
      const tip = tipFor(start);
      return { tip, hovering: true };
    },
    canMove: () => true,
    move: async (target) => {
      moves += 1;
      return target;
    },
  });
  expect(result).toEqual(start);
  expect(moves).toBe(0);
});

it('reports one timing record per measured search step', async () => {
  let current = pose(80, -40);
  const steps: VisualReferenceStep[] = [];
  await findVisualReference({
    start: current,
    outline,
    observe: async () => {
      const tip = tipFor(current);
      return {
        tip,
        hovering: Math.hypot(tip.x - 500, tip.y - 500) <= 10,
      };
    },
    canMove: () => true,
    move: async (target) => {
      current = target;
      return target;
    },
    onStep: (step) => steps.push(step),
  });
  // Two axis probes establish the scale, then the servo converges.
  expect(steps.slice(0, 2).map((step) => step.kind)).toEqual([
    'probe-x',
    'probe-y',
  ]);
  expect(
    steps
      .map((step) => step.kind)
      .slice(2)
      .every((kind) => kind === 'servo'),
  ).toBe(true);
  expect(steps.map((step) => step.index)).toEqual(
    steps.map((_step, index) => index + 1),
  );
  for (const step of steps) {
    expect(step.moveMs).toBeGreaterThanOrEqual(0);
    expect(step.observeMs).toBeGreaterThanOrEqual(0);
  }
  // The last observation is the closest to the centre of the reported ones.
  const errors = steps.map((step) => step.error);
  expect(errors.at(-1)).toBe(Math.min(...errors));
});

it('takes a coarse step while the tip is still far from the screen', async () => {
  let current = pose(100, 0);
  const moves: CartesianPose[] = [];
  await findVisualReference({
    start: current,
    outline,
    observe: async () => {
      const tip = tipFor(current);
      return {
        tip,
        hovering: Math.hypot(tip.x - 500, tip.y - 500) <= 10,
      };
    },
    canMove: () => true,
    move: async (target) => {
      current = target;
      moves.push(target);
      return target;
    },
  });
  // Two 12 mm axis probes, then a long leg at travel height; the old 12 mm cap
  // needed the same approach split into many more model round trips.
  const leg = Math.hypot(
    moves[2]!.positionMm.x - moves[1]!.positionMm.x,
    moves[2]!.positionMm.y - moves[1]!.positionMm.y,
  );
  expect(leg).toBeGreaterThan(35);
  expect(leg).toBeLessThanOrEqual(60.01);
});

it('travels on tip-only readings until a step would barely move', async () => {
  let current = pose(170, 0);
  let fullReads = 0;
  let tipReads = 0;
  await findVisualReference({
    start: current,
    outline,
    observe: async () => {
      fullReads += 1;
      const tip = tipFor(current);
      return {
        tip,
        hovering: Math.hypot(tip.x - 500, tip.y - 500) <= 10,
      };
    },
    observeTip: async () => {
      tipReads += 1;
      return { tip: tipFor(current), hovering: false };
    },
    canMove: () => true,
    move: async (target) => {
      current = target;
      return target;
    },
  });
  // The eye-level reading is paid once, when the search has nearly arrived.
  expect(fullReads).toBeLessThanOrEqual(2);
  expect(tipReads).toBeGreaterThanOrEqual(4);
});

it('starts from a tip the caller already read', async () => {
  const events: string[] = [];
  let current = pose(200, 0);
  await findVisualReference({
    start: current,
    outline,
    initialTip: tipFor(current),
    observe: async () => {
      events.push('read');
      const tip = tipFor(current);
      return {
        tip,
        hovering: Math.hypot(tip.x - 500, tip.y - 500) <= 10,
      };
    },
    canMove: () => true,
    move: async (target) => {
      events.push('move');
      current = target;
      return target;
    },
  });
  // The start pose was observed while lifting, so the first action is a move.
  expect(events[0]).toBe('move');
});

it('fails instead of guessing when the camera cannot measure tip motion', async () => {
  await expect(
    findVisualReference({
      start: pose(80, -40),
      outline,
      observe: async () => ({ tip: { x: 660, y: 420 }, hovering: false }),
      canMove: () => true,
      move: async (target) => target,
    }),
  ).rejects.toMatchObject({ code: 'VISION_UNAVAILABLE' });
});
