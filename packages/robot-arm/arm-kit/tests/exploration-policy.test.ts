import { expect, it } from '@rstest/core';
import { auditTargets } from '../src/calibration/exploration/sampler.js';
import {
  explorationTargets,
  mappedExplorationTargets,
} from '../src/calibration/exploration/targets.js';

const corner = (id: string, x: number, y: number) => ({
  id,
  role: 'fit' as const,
  css: { x, y },
  screen: { x, y },
});

it('picks audit corners that keep the measured plane non-collinear', () => {
  const pair = auditTargets([
    corner('a', 0, 0),
    corner('b', 100, 0),
    corner('c', 100, 100),
    corner('d', 0, 100),
  ]);
  expect(pair).toHaveLength(2);
  // A centred first touch makes a diagonal pair collinear; the audit must
  // choose corners that leave a real triangle.
  expect(new Set(pair.map((target) => target.id))).not.toEqual(
    new Set(['a', 'c']),
  );
  const [left, right] = pair.map((target) => [
    (target.css.x - 50) / 100,
    (target.css.y - 50) / 100,
  ]);
  expect(Math.abs(left[0] * right[1] - left[1] * right[0])).toBeGreaterThan(
    0.2,
  );
});

it('selects interior audits from both halves using the real first contact', () => {
  const pair = auditTargets(
    [
      corner('a', 0, 0),
      corner('b', 100, 0),
      corner('c', 100, 100),
      corner('d', 0, 100),
    ],
    {
      firstContact: { x: 25, y: 55 },
      auditPosition: ({ css }) => ({
        x: 10 + css.x * 0.8,
        y: 10 + css.y * 0.8,
      }),
    },
  );
  expect(pair.map(({ id }) => id)).toEqual(['b', 'c']);
});

it('keeps dev standard holdouts out of the six fitting targets', () => {
  const targets = explorationTargets({ width: 400, height: 800 });
  expect(targets.filter((t) => t.purpose === 'fit')).toHaveLength(6);
  expect(
    targets.filter((t) => t.purpose === 'check').map((t) => t.point),
  ).toEqual([
    { x: 40, y: 400 },
    { x: 360, y: 400 },
    { x: 200, y: 720 },
  ]);
});
it('selects four distributed corners and two independent edge checks in serpentine order', () => {
  const targets = explorationTargets({ width: 400, height: 800 }, true);
  expect(targets.map((t) => [t.point.x, t.point.y, t.purpose])).toEqual([
    [40, 80, 'fit'],
    [360, 80, 'fit'],
    [360, 400, 'check'],
    [40, 400, 'check'],
    [40, 720, 'fit'],
    [360, 720, 'fit'],
  ]);
});
it('accepts the real iPhone viewport without an extra preflight coverage gate', () => {
  const m = [
    0.9797428925542602, -0.007008650339437902, 10.56938608385807,
    0.04488652529770618, 0.9970842759321542, 81.32758940111954,
    3.5805979938451246e-5, -2.663432205301461e-5, 1,
  ];
  const project = (p: { x: number; y: number }) => {
    const d = m[6] * p.x + m[7] * p.y + 1;
    return {
      x: (m[0] * p.x + m[1] * p.y + m[2]) / d,
      y: (m[3] * p.x + m[4] * p.y + m[5]) / d,
    };
  };
  const result = mappedExplorationTargets(
    { width: 390, height: 667 },
    project,
    { width: 390, height: 844 },
  );
  expect(result.inset).toBe(0.1);
  expect(result.targets[0].point).toEqual({ x: 39, y: 66.7 });
  expect(() =>
    mappedExplorationTargets({ width: 390, height: 300 }, (p) => p, {
      width: 390,
      height: 844,
    }),
  ).not.toThrow();
});

it.each([false, true])(
  'keeps fixed 10% targets with sufficient coverage (fast=%s)',
  (fast) => {
    const result = mappedExplorationTargets(
      { width: 400, height: 800 },
      (p) => p,
      { width: 400, height: 800 },
      fast,
    );
    expect(result.inset).toBe(0.1);
    expect(result.targets).toHaveLength(fast ? 6 : 9);
    expect(
      result.targets.every(
        ({ point }) =>
          point.x >= 40 && point.x <= 360 && point.y >= 80 && point.y <= 720,
      ),
    ).toBe(true);
  },
);
it('rejects mapped targets outside the screen', () => {
  expect(() =>
    mappedExplorationTargets(
      { width: 400, height: 800 },
      (p) => ({ x: p.x + 400, y: p.y }),
      { width: 400, height: 800 },
    ),
  ).toThrow('outside the screen');
});
