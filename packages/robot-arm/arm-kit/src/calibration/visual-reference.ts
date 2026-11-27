import type { WebPoint } from '../assisted-contracts.js';
import { type CartesianPose, RobotArmError } from '../contracts.js';
import { insideQuad, quadCenter } from './screen-position.js';

export interface VisualTipObservation {
  /** Tip location in the overhead image, normalized to 0–1000 on both axes. */
  tip: WebPoint;
  hovering: boolean;
}

const AXIS_PROBE_MM = 12;
// Long legs at travel height only need to land near the screen; refine close in.
const COARSE_STEP_MM = 60;
const COARSE_FROM_MM = 40;
const MAX_STEP_MM = 12;
const MAX_STEPS = 30;
const MAX_TRAVEL_MM = 300;
/**
 * An eye-level confirmation costs more than a tip-only step, so it waits until
 * another step would barely move. Before the scale is known the search still
 * confirms as soon as the tip is inside the inset (a start that already hovers).
 */
const CONFIRM_FROM_MM = 4;

function failed(message: string) {
  return new RobotArmError('VISION_UNAVAILABLE', message, 409);
}

/** One measured search iteration; the model observation dominates `observeMs`. */
export interface VisualReferenceStep {
  /** 1-based across the whole search; the two axis probes come first. */
  index: number;
  kind: 'probe-x' | 'probe-y' | 'servo';
  /** Pose-to-pose motion, excluding the observation that follows it. */
  moveMs: number;
  /** The observation after the move, which is one model round trip. */
  observeMs: number;
  /** Remaining distance to the screen centre in normalized image units. */
  error: number;
}

/** Estimate only the local direction and scale of XY motion at the safe height. */
export async function findVisualReference({
  start,
  outline,
  observe,
  observeTip,
  initialTip,
  canMove,
  move,
  onStep,
}: {
  start: CartesianPose;
  outline: readonly WebPoint[];
  observe(): Promise<VisualTipObservation>;
  /**
   * Overhead-only observation for travel steps. It is cheaper per call and
   * cannot confirm a hover, so `observe` still decides the stop.
   */
  observeTip?(): Promise<VisualTipObservation>;
  /** A tip already read at the start pose; spare the model a duplicate read. */
  initialTip?: WebPoint;
  canMove(pose: CartesianPose): boolean;
  move(pose: CartesianPose, from: CartesianPose): Promise<CartesianPose>;
  /** Called once per iteration so a slow search can be read off one run. */
  onStep?(step: VisualReferenceStep): void;
}) {
  const center = quadCenter(outline);
  // Prefer the middle of the screen to leave room for the first touch.
  const inset = outline.map((p) => ({
    x: center.x + (p.x - center.x) * 0.65,
    y: center.y + (p.y - center.y) * 0.65,
  }));
  const isHover = (view: VisualTipObservation) =>
    view.hovering && insideQuad(view.tip, inset);
  const errorFromCenter = (view: VisualTipObservation) =>
    Math.hypot(center.x - view.tip.x, center.y - view.tip.y);
  const look = observeTip ?? observe;
  let pose = start;
  let view: VisualTipObservation = initialTip
    ? { tip: initialTip, hovering: false }
    : await observe();
  let travel = 0;
  let stepIndex = 0;
  const destination = (x: number, y: number): CartesianPose => ({
    ...start,
    positionMm: {
      ...start.positionMm,
      x: pose.positionMm.x + x,
      y: pose.positionMm.y + y,
    },
  });
  const advance = async (
    target: CartesianPose,
    kind: VisualReferenceStep['kind'],
  ) => {
    travel += Math.hypot(
      target.positionMm.x - pose.positionMm.x,
      target.positionMm.y - pose.positionMm.y,
    );
    if (travel > MAX_TRAVEL_MM || !canMove(target))
      throw failed(
        'Visual reference search reached the installation travel limit.',
      );
    const moveStarted = performance.now();
    pose = await move(target, pose);
    const moveMs = performance.now() - moveStarted;
    const observeStarted = performance.now();
    view = await look();
    onStep?.({
      index: ++stepIndex,
      kind,
      moveMs: Math.round(moveMs),
      observeMs: Math.round(performance.now() - observeStarted),
      error: Math.round(errorFromCenter(view) * 10) / 10,
    });
  };
  const confirm = async () => {
    // Travel steps read only the tip, so the eye-level view has the final say.
    if (!insideQuad(view.tip, inset)) return false;
    view = await observe();
    return isHover(view);
  };
  if (await confirm()) return pose;

  const measureAxis = async (axis: 'x' | 'y') => {
    const before = { pose, tip: view.tip };
    const candidate = [AXIS_PROBE_MM, -AXIS_PROBE_MM]
      .map((step) =>
        destination(axis === 'x' ? step : 0, axis === 'y' ? step : 0),
      )
      .find(canMove);
    if (!candidate)
      throw failed(
        'There is no room for the reference search at the safe start.',
      );
    await advance(candidate, axis === 'x' ? 'probe-x' : 'probe-y');
    const shiftMm = pose.positionMm[axis] - before.pose.positionMm[axis];
    const dx = view.tip.x - before.tip.x;
    const dy = view.tip.y - before.tip.y;
    if (Math.abs(shiftMm) < AXIS_PROBE_MM / 2 || Math.hypot(dx, dy) < 4)
      throw failed('The cameras could not measure how the stylus moved.');
    return { x: dx / shiftMm, y: dy / shiftMm };
  };
  const alongX = await measureAxis('x');
  if (await confirm()) return pose;
  const alongY = await measureAxis('y');
  if (await confirm()) return pose;
  const determinant = alongX.x * alongY.y - alongX.y * alongY.x;
  const scale = Math.hypot(alongX.x, alongX.y) * Math.hypot(alongY.x, alongY.y);
  if (Math.abs(determinant) < scale * 0.3)
    throw failed(
      'The cameras could not distinguish the robot X and Y directions.',
    );

  let best = errorFromCenter(view);
  let withoutProgress = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    const u = center.x - view.tip.x;
    const v = center.y - view.tip.y;
    const x = (u * alongY.y - v * alongY.x) / determinant;
    const y = (v * alongX.x - u * alongX.y) / determinant;
    const length = Math.hypot(x, y);
    if (!Number.isFinite(length) || length < 1)
      throw failed(
        'The cameras could not confirm a hover over the selected screen.',
      );
    const factor =
      length > COARSE_FROM_MM
        ? Math.min(0.9, COARSE_STEP_MM / length)
        : Math.min(0.65, MAX_STEP_MM / length);
    await advance(destination(x * factor, y * factor), 'servo');
    /*
     * An eye-level confirmation costs more than a tip-only step, so it waits
     * until another step would barely move; before that the loop would spend a
     * full reading on every step once the tip enters the screen inset.
     */
    if (length * (1 - factor) <= CONFIRM_FROM_MM && (await confirm()))
      return pose;
    const remaining = errorFromCenter(view);
    if (remaining < best - 3) {
      best = remaining;
      withoutProgress = 0;
    } else if (++withoutProgress >= 3)
      throw failed('The stylus did not move closer to the selected screen.');
  }
  throw failed(
    'The cameras could not confirm a hover over the selected screen.',
  );
}
