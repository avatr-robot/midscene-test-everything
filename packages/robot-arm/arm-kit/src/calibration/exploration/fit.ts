import {
  type CalibrationProfile,
  type RobotArmCapabilities,
  RobotArmError,
  type ToolProfile,
} from '../../contracts.js';
import {
  type AutoCalibrationSample,
  autoCalibrationGeometry,
  maxSurfaceResidualMm,
  measuredScreenPixel,
  screenResidualMm,
} from './geometry.js';
import { surfaceDepthMm } from './plane.js';
import { explorationQualityWarnings } from './quality.js';
import type { runAutoExploration } from './sampler.js';
export function fitExploration(
  collection: Awaited<ReturnType<typeof runAutoExploration>>,
  tool: ToolProfile,
  capabilities: RobotArmCapabilities,
  binding: Pick<
    CalibrationProfile,
    | 'id'
    | 'robotProfileId'
    | 'toolProfileId'
    | 'screenProfileId'
    | 'robotGeometryRevision'
    | 'toolGeometryRevision'
    | 'screenGeometryRevision'
  >,
  fast: boolean,
) {
  const { probes, grid, start, screen } = collection;
  const validationGrid = grid.filter(
    (point) => point.target.role === 'validation',
  );
  if (validationGrid.length < 2)
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Fewer than two validation touches were collected',
      409,
    );
  const samples: AutoCalibrationSample[] = [
    ...probes,
    ...grid.filter((point) => point.target.role === 'fit'),
  ].map((point) => ({
    robot: { x: point.contact.x, y: point.contact.y, z: point.contact.z },
    screen: point.screen,
    weight: point.weight,
    zSource: point.zSource,
  }));
  const result = autoCalibrationGeometry({
    startPose: start,
    samples,
    screen,
    tool,
    capabilities: capabilities,
    binding,
  });
  const validationResiduals = validationGrid.map((point) => {
    const predicted = measuredScreenPixel(
      result.candidate,
      result.frame,
      point.contact,
    );
    const offset = {
      x: predicted.x - point.screen.x,
      y: predicted.y - point.screen.y,
    };
    return {
      px: Math.hypot(offset.x, offset.y),
      mm: screenResidualMm(result.frame, offset),
    };
  });
  // A predicted press or slide verifies XY only. Local recovery also measures Z.
  const measuredHeights = validationGrid.filter(
    (point) => !fast || point.heightIntervalMm !== undefined,
  );
  const validationHeightMaxMm = measuredHeights.length
    ? maxSurfaceResidualMm(
        result.candidate,
        measuredHeights.map((point) => point.contact),
      )
    : undefined;
  // Predicted heights never reach the plane fit; measure how far they sit from
  // the measured plane (after local compensation) so a wrong model is visible.
  const predictedPoints = [...probes, ...grid].filter(
    (point) => point.zSource === 'predicted',
  );
  const predictedHeightResidualMaxMm = predictedPoints.length
    ? Math.max(
        ...predictedPoints.map((point) =>
          Math.abs(surfaceDepthMm(result.candidate, point.contact)),
        ),
      )
    : undefined;
  // Spread of the heights that were actually measured: the only direct hint on
  // tilt that fast-horizontal still has, since most of its heights are model.
  const measuredPoints = [...probes, ...grid].filter(
    (point) => point.zSource === 'measured',
  );
  const measuredHeightRangeMm =
    measuredPoints.length > 1
      ? Math.max(...measuredPoints.map((point) => point.contact.z)) -
        Math.min(...measuredPoints.map((point) => point.contact.z))
      : undefined;

  // Validation targets were excluded from both plane and XY fitting above.
  const gridRmsPx = result.gridRmsPx;
  const validationRmsPx = Math.sqrt(
    validationResiduals.reduce((sum, value) => sum + value.px * value.px, 0) /
      validationResiduals.length,
  );
  const validationMaxPx = Math.max(...validationResiduals.map(({ px }) => px));
  const validationMaxMm = Math.max(...validationResiduals.map(({ mm }) => mm));
  if (
    ![
      result.gridRmsMm,
      result.coverage,
      validationMaxMm,
      validationRmsPx,
      validationHeightMaxMm ?? 0,
    ].every(Number.isFinite)
  )
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Touch measurements must produce finite residuals and coverage',
      409,
    );
  const evidence = {
    samplingMode: fast ? ('fast' as const) : ('standard' as const),
    planeSource:
      fast && result.planeSampleCount < 3 ? 'assumed-horizontal' : 'measured',
    planeRmseMm: result.quality.rmseMm,
    gridRmsPx,
    gridRmsMm: result.gridRmsMm,
    validationRmsPx,
    validationMaxPx,
    validationMaxMm,
    validationHeightMaxMm,
    axisSkewRatio: result.axisSkewRatio,
    coverage: result.coverage,
    surfaceMaxMm: result.surfaceMaxMm,
    measuredPlaneSamples: result.planeSampleCount,
    predictedSamples: result.predictedSampleCount,
    predictedFraction:
      samples.length > 0 ? result.predictedSampleCount / samples.length : 0,
    ...(predictedHeightResidualMaxMm !== undefined
      ? { predictedHeightResidualMaxMm }
      : {}),
    ...(measuredHeightRangeMm !== undefined ? { measuredHeightRangeMm } : {}),
    samples: [...probes, ...grid].map((point) => ({
      screen: point.screen,
      planeMm: { x: point.contact.x, y: point.contact.y },
      zMm: point.contact.z,
      zSource: point.zSource,
    })),
  };
  return {
    ...result,
    evidence,
    warnings: explorationQualityWarnings(
      result.measuredSize,
      result.quality,
      evidence,
    ),
  };
}
