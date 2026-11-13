import {
  type CartesianPose,
  type InstallationTeaching,
  RobotArmError,
  type ToolProfile,
  type Vector3,
} from '../contracts.js';
import { contactPoint, distance, rotate, unit } from '../domain.js';
import type { ApplicationContext } from './context.js';

export const CAMERA_BOUNDARY_EPSILON_MM = 1e-6;

export function taughtCameraBoundary(
  reference: CartesianPose,
  start: CartesianPose,
  end: CartesianPose,
  tool: Pick<ToolProfile, 'offsetMm' | 'contactDirection'>,
): InstallationTeaching['cameraBoundary'] {
  const r = contactPoint(reference, tool.offsetMm);
  const a = contactPoint(start, tool.offsetMm);
  const b = contactPoint(end, tool.offsetMm);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const separation = Math.hypot(dx, dy);
  if (separation < 20)
    throw new RobotArmError(
      'INVALID_ARGUMENT',
      'Record boundary points A and B at least 20 mm apart in XY',
      409,
    );
  const direction = unit(rotate(reference.orientation, tool.contactDirection));
  if (
    [start, end].some(
      (pose) =>
        distance(
          direction,
          unit(rotate(pose.orientation, tool.contactDirection)),
        ) > 0.005,
    )
  )
    throw new RobotArmError(
      'INVALID_ARGUMENT',
      'Keep the stylus contact direction unchanged',
      409,
    );
  const nx = -dy / separation;
  const ny = dx / separation;
  const referenceSide = (r.x - a.x) * nx + (r.y - a.y) * ny;
  if (Math.abs(referenceSide) < 20)
    throw new RobotArmError(
      'INVALID_ARGUMENT',
      'Keep the reference at least 20 mm from the camera-side boundary line',
      409,
    );
  const sign = referenceSide < 0 ? 1 : -1;
  return {
    point: { x: a.x, y: a.y },
    normal: { x: sign * nx || 0, y: sign * ny || 0 },
  };
}

export function cameraBoundaryExcessMm(
  tip: Vector3,
  teaching: InstallationTeaching,
) {
  const { point, normal } = teaching.cameraBoundary;
  return (tip.x - point.x) * normal.x + (tip.y - point.y) * normal.y;
}
/** The reference side of the taught vertical plane is allowed. */
export function assertCameraBoundary(
  pose: CartesianPose,
  teaching: InstallationTeaching,
  ctx: Pick<ApplicationContext, 'tool'>,
) {
  const tip = contactPoint(pose, ctx.tool.offsetMm);
  const excess = cameraBoundaryExcessMm(tip, teaching);
  if (!Number.isFinite(excess) || excess > CAMERA_BOUNDARY_EPSILON_MM)
    throw new RobotArmError(
      'CAMERA_BOUNDARY_EXCEEDED',
      Number.isFinite(excess)
        ? `Target crosses the taught camera-side boundary by ${excess.toFixed(excess < 0.01 ? 6 : 2)} mm`
        : 'Target crosses the taught camera-side boundary',
      409,
      {
        ...(Number.isFinite(excess) && { boundaryExcessMm: excess }),
        targetTipMm: tip,
        cameraBoundary: teaching.cameraBoundary,
      },
    );
}
