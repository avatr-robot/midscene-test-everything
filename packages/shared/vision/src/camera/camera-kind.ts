import type { CameraDevice, CameraKind } from './types.js';

/**
 * DirectShow exposes the D400 depth sensor as a video source, but FFmpeg does
 * not implement its Z16 media type. The RealSense SDK backend owns it instead.
 */
export function isRealsenseDepthEndpointName(name: string): boolean {
  const normalized = name.trim().replace(/\s+/gu, ' ');
  return (
    /\bRealSense\b/iu.test(normalized) &&
    /\bDepth Camera\b/iu.test(normalized) &&
    /\bDepth$/iu.test(normalized) &&
    !/\bRGB$/iu.test(normalized)
  );
}

export function isRealsenseColorEndpointName(name: string): boolean {
  const normalized = name.trim().replace(/\s+/gu, ' ');
  return (
    /\bRealSense\b/iu.test(normalized) &&
    /\bDepth Camera\b/iu.test(normalized) &&
    /\bRGB$/iu.test(normalized)
  );
}

export function isRealsenseCaptureEndpointName(name: string): boolean {
  return (
    isRealsenseDepthEndpointName(name) || isRealsenseColorEndpointName(name)
  );
}

export function cameraKind(
  device: Pick<CameraDevice, 'kind'> | undefined,
): CameraKind {
  return device?.kind ?? 'color';
}
