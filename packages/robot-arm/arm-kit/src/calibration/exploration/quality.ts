import {
  type CalibrationQualityReading,
  needsQualityReview,
} from '../../assisted-contracts.js';
import type {
  AutoCalibrationEvidence,
  PlaneQuality,
  ScreenProfile,
} from '../../contracts.js';
import { SAMPLED_SURFACE_LIMIT_MM } from '../surface.js';

/** Fast mode assumes a horizontal screen; this is the tilt budget it may keep. */
const FAST_MEASURED_HEIGHT_RANGE_MM = 6;

/** XY errors use the measured short edge. Z errors use the supported surface compensation range. */
export function explorationQualityWarnings(
  screen: Pick<ScreenProfile, 'physicalWidthMm' | 'physicalHeightMm'>,
  plane: PlaneQuality,
  evidence: AutoCalibrationEvidence,
): CalibrationQualityReading[] {
  const short = Math.min(screen.physicalWidthMm, screen.physicalHeightMm);
  const long = Math.max(screen.physicalWidthMm, screen.physicalHeightMm);
  const readings: CalibrationQualityReading[] = [
    {
      label: 'Grid RMS',
      percent: (evidence.gridRmsMm / short) * 100,
      targetPercent: 1.5,
    },
    {
      label: 'Holdout maximum',
      percent: (evidence.validationMaxMm / short) * 100,
      targetPercent: 2,
    },
    {
      label: 'Touch coverage',
      percent: evidence.coverage * 100,
      targetPercent: 60,
      minimum: true,
    },
    {
      label: 'Plane RMS',
      percent:
        (Math.max(plane.rmseMm, evidence.planeRmseMm) /
          SAMPLED_SURFACE_LIMIT_MM) *
        100,
      targetPercent: 25,
    },
    {
      label: 'Plane inliers',
      percent: (plane.inliers / plane.total) * 100,
      targetPercent: 80,
      minimum: true,
    },
    {
      label: 'Plane sample span',
      percent:
        Math.min(plane.minorSpanMm / short, plane.majorSpanMm / long) * 100,
      targetPercent: 25,
      minimum: true,
    },
  ];
  // Older recordings predate these diagnostics and enforced their nominal targets when fitted.
  if (evidence.validationHeightMaxMm !== undefined)
    readings.push({
      label: 'Holdout height error',
      percent:
        (evidence.validationHeightMaxMm / SAMPLED_SURFACE_LIMIT_MM) * 100,
      targetPercent: 50,
    });
  // Predicted heights are kept out of the plane; their residual against the
  // measured plane is the signal that the height model no longer fits.
  if (evidence.predictedHeightResidualMaxMm !== undefined)
    readings.push({
      label: 'Predicted height error',
      percent:
        (evidence.predictedHeightResidualMaxMm / SAMPLED_SURFACE_LIMIT_MM) *
        100,
      targetPercent: 100,
    });
  // The measured heights are the only direct evidence of tilt in fast mode.
  if (evidence.measuredHeightRangeMm !== undefined)
    readings.push({
      label: 'Measured height range',
      percent:
        (evidence.measuredHeightRangeMm / FAST_MEASURED_HEIGHT_RANGE_MM) * 100,
      targetPercent: 100,
    });
  if (evidence.axisSkewRatio !== undefined)
    readings.push({
      label: 'Screen axis skew',
      percent: evidence.axisSkewRatio * 100,
      targetPercent: 3,
    });
  return readings.filter(needsQualityReview);
}
