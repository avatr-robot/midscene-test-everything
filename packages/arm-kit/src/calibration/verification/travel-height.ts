import type { ApplicationContext } from '../../application/context.js';
import type { CartesianPose } from '../../contracts.js';
import { contactPoint, flangePose } from '../../domain.js';
// Same upstream projection; Arm Kit normally has no batch-transfer travel floor.
export function atTravelHeight(
  pose: CartesianPose,
  ctx: ApplicationContext & {
    minimumTravelTipZMm?: number;
    batchTransfer?: { travelTipZMm: number };
  },
): CartesianPose {
  const minimum = Math.max(
    ctx.minimumTravelTipZMm ?? Number.NEGATIVE_INFINITY,
    ctx.batchTransfer?.travelTipZMm ?? Number.NEGATIVE_INFINITY,
  );
  if (!Number.isFinite(minimum)) return pose;
  const tip = contactPoint(pose, ctx.tool.offsetMm);
  return flangePose(
    { ...tip, z: Math.max(tip.z, minimum) },
    pose.orientation,
    ctx.tool.offsetMm,
  );
}
