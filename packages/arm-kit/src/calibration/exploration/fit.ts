// Fitting and quality gates from midscene-private dev
// 710f60809eac3dbe824f91a5cf8b3b0e72386282 calibration/auto-exploration.ts.
import {
  type CalibrationProfile,
  type RobotArmCapabilities,
  RobotArmError,
  type ToolProfile,
} from '../../contracts.js';
import {
  type AutoCalibrationSample,
  autoCalibrationGeometry,
  measuredScreenPixel,
  screenResidualMm,
  validateSurfaceHeights,
} from './geometry.js';
import {
  MAX_GRID_RMS_MM,
  MAX_VALIDATION_MM,
  MIN_COVERAGE,
  MIN_PLANE_RMSE_MM,
  type runAutoExploration,
} from './sampler.js';
const CONTACT_HEIGHT_TOLERANCE_MM = 1;
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
  type GridTouch = (typeof grid)[number];
  const validationGrid = grid.filter(
    (point) => point.target.role === 'validation',
  );
  const samples: AutoCalibrationSample[] = [
    ...probes,
    ...grid.filter((point) => point.target.role === 'fit'),
  ].map((point) => ({
    robot: { x: point.contact.x, y: point.contact.y, z: point.contact.z },
    screen: point.screen,
    weight: point.weight,
  }));
  const result = autoCalibrationGeometry({
    startPose: start,
    samples,
    screen,
    tool,
    capabilities: capabilities,
    binding,
  });
  const residual = (points: GridTouch[]) =>
    points.map((point) => {
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
  const validationResiduals = residual(validationGrid);
  // Held-out height must agree with the local surface within the acquisition's
  // 1 mm resolution. Validation points never train the compensation model.
  validateSurfaceHeights(
    result.candidate,
    validationGrid.map((point) => point.contact),
    CONTACT_HEIGHT_TOLERANCE_MM,
  );

  // Validation targets were excluded from both plane and XY fitting above.
  const gridRmsPx = result.gridRmsPx;
  const validationRmsPx = Math.sqrt(
    validationResiduals.reduce((sum, value) => sum + value.px * value.px, 0) /
      Math.max(1, validationResiduals.length),
  );
  const validationMaxPx = Math.max(...validationResiduals.map(({ px }) => px));
  const validationMaxMm = Math.max(...validationResiduals.map(({ mm }) => mm));
  if (result.quality.rmseMm > MIN_PLANE_RMSE_MM)
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      `Screen plane RMSE ${result.quality.rmseMm.toFixed(2)} mm exceeds the ${MIN_PLANE_RMSE_MM} mm limit`,
      409,
    );
  if (validationMaxMm > MAX_VALIDATION_MM)
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      `Validation residual ${validationMaxPx.toFixed(1)} px (${validationMaxMm.toFixed(2)} mm) exceeds ${MAX_VALIDATION_MM} mm`,
      409,
    );
  if (result.coverage < MIN_COVERAGE)
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      `Touch coverage ${(result.coverage * 100).toFixed(0)}% is below ${MIN_COVERAGE * 100}%`,
      409,
    );
  if (result.gridRmsMm > MAX_GRID_RMS_MM)
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      `Grid RMS ${gridRmsPx.toFixed(1)} px (${result.gridRmsMm.toFixed(2)} mm) exceeds ${MAX_GRID_RMS_MM} mm`,
      409,
    );
  const evidence = {
    planeSource: fast ? 'assumed-horizontal' : 'measured',
    planeRmseMm: result.quality.rmseMm,
    gridRmsPx,
    gridRmsMm: result.gridRmsMm,
    validationRmsPx,
    validationMaxPx,
    validationMaxMm,
    coverage: result.coverage,
    surfaceMaxMm: result.surfaceMaxMm,
    samples: [...probes, ...grid].map((point) => ({
      screen: point.screen,
      planeMm: { x: point.contact.x, y: point.contact.y },
      zMm: point.contact.z,
    })),
  };
  return { ...result, evidence };
}
