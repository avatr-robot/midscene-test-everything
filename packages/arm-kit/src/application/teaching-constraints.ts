import {
  type CartesianPose,
  type InstallationTeaching,
  RobotArmError,
} from '../contracts.js';
import { contactPoint } from '../domain.js';
import type { ApplicationContext } from './context.js';
/** The reference side of the taught vertical plane is allowed. */
export function assertCameraBoundary(
  pose: CartesianPose,
  teaching: InstallationTeaching,
  ctx: Pick<ApplicationContext, 'tool'>,
) {
  const { point, normal } = teaching.cameraBoundary;
  const tip = contactPoint(pose, ctx.tool.offsetMm);
  const excess = (tip.x - point.x) * normal.x + (tip.y - point.y) * normal.y;
  if (!Number.isFinite(excess) || excess > 1e-6)
    throw new RobotArmError(
      'CAMERA_BOUNDARY_EXCEEDED',
      'Target crosses the taught camera-side boundary',
      409,
    );
}
