import type { CalibrationImagingStatus } from '@midscene/robotics-shared/assisted-contracts';

const CALIBRATING_IMAGING_STATES = new Set<CalibrationImagingStatus['state']>([
  'exposure',
  'white-balance',
  'tone',
  'focus',
]);

export function shouldShowScreenOutlines(
  imaging: CalibrationImagingStatus | undefined,
  applying: boolean,
) {
  return !applying && !CALIBRATING_IMAGING_STATES.has(imaging?.state ?? 'idle');
}
