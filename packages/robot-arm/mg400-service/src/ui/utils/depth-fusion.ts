import type { CameraEntry } from '../cameras';

export interface CameraCaptureResolution {
  width: number;
  height: number;
}

type CameraResolutionSource = {
  captureSettings?: CameraEntry['captureSettings'];
  stream?: Pick<NonNullable<CameraEntry['stream']>, 'width' | 'height'>;
};

export function cameraCaptureResolution(
  camera: CameraResolutionSource | undefined,
): CameraCaptureResolution | undefined {
  if (camera?.stream?.width && camera.stream.height)
    return {
      width: camera.stream.width,
      height: camera.stream.height,
    };
  if (camera?.captureSettings?.width && camera.captureSettings.height)
    return {
      width: camera.captureSettings.width,
      height: camera.captureSettings.height,
    };
  return undefined;
}

export function depthFusionResolutionMismatch(
  depth: CameraResolutionSource | undefined,
  color: CameraResolutionSource | undefined,
):
  | { color: CameraCaptureResolution; depth: CameraCaptureResolution }
  | undefined {
  const depthResolution = cameraCaptureResolution(depth);
  const colorResolution = cameraCaptureResolution(color);
  if (
    !depthResolution ||
    !colorResolution ||
    (depthResolution.width === colorResolution.width &&
      depthResolution.height === colorResolution.height)
  )
    return undefined;
  return { color: colorResolution, depth: depthResolution };
}
