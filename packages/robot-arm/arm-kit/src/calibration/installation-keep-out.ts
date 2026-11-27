import type { CameraKeepOut, ScreenPoint } from '../contracts.js';
import type { ScreenQuad } from './screen-position.js';

/** Extra distance outside the screen group on each camera side. */
export const INSTALLATION_KEEP_OUT_MARGIN_MM = 15;
/** Extra line length beyond the screen group at both ends. */
export const INSTALLATION_KEEP_OUT_EXTENSION_MM = 20;

export interface InstallationKeepOutDerivation {
  /** Primary (overhead) camera side first, front camera side second. */
  keepOuts: CameraKeepOut[];
  primary: CameraKeepOut & {
    /** Taught-position endpoints along the primary boundary line. */
    start: ScreenPoint;
    end: ScreenPoint;
  };
}

/**
 * Turn the calibrated screen group into the two camera-side half-planes.
 *
 * The screen's page-left edge faces the overhead camera (the page is captured
 * from that side), so `axis` is the calibrated `xAxis`: the negative end is the
 * overhead camera and the positive end is the eye-level camera. This is the
 * geometry the old A/B line encoded by hand.
 */
export function deriveInstallationKeepOuts(input: {
  quads: readonly ScreenQuad[];
  axis: ScreenPoint;
  primaryCameraId?: string;
  sideCameraId?: string;
}): InstallationKeepOutDerivation | undefined {
  const length = Math.hypot(input.axis.x, input.axis.y);
  if (!input.quads.length || !Number.isFinite(length) || length < 1e-9)
    return undefined;
  const axis = { x: input.axis.x / length, y: input.axis.y / length };
  const perpendicular = { x: -axis.y, y: axis.x };
  const projected = input.quads.flatMap((quad) =>
    quad.map((point) => ({
      point,
      along: point.x * axis.x + point.y * axis.y,
      across: point.x * perpendicular.x + point.y * perpendicular.y,
    })),
  );
  const min = projected.reduce((a, b) => (b.along < a.along ? b : a));
  const max = projected.reduce((a, b) => (b.along > a.along ? b : a));
  const acrossMin = Math.min(...projected.map((entry) => entry.across));
  const acrossMax = Math.max(...projected.map((entry) => entry.across));
  const at = (along: number, across: number): ScreenPoint => ({
    x: axis.x * along + perpendicular.x * across + 0,
    y: axis.y * along + perpendicular.y * across + 0,
  });
  const negate = (value: number) => (value === 0 ? 0 : -value);
  const primaryAlong = min.along - INSTALLATION_KEEP_OUT_MARGIN_MM;
  const sideAlong = max.along + INSTALLATION_KEEP_OUT_MARGIN_MM;
  const primary: InstallationKeepOutDerivation['primary'] = {
    cameraId: input.primaryCameraId,
    point: at(primaryAlong, 0),
    normal: { x: negate(axis.x), y: negate(axis.y) },
    source: 'derived-screen-group',
    start: at(primaryAlong, acrossMin - INSTALLATION_KEEP_OUT_EXTENSION_MM),
    end: at(primaryAlong, acrossMax + INSTALLATION_KEEP_OUT_EXTENSION_MM),
  };
  const keepOuts: CameraKeepOut[] = [primary];
  if (input.sideCameraId) {
    keepOuts.push({
      cameraId: input.sideCameraId,
      point: at(sideAlong, 0),
      normal: { x: axis.x, y: axis.y },
      source: 'derived-screen-group',
    });
  }
  return { keepOuts, primary };
}
