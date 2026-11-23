import { type CameraCorrection, RobotArmError } from '../contracts.js';
import { jpegSize } from './jpeg-size.js';
import { PerspectiveTransformer } from './perspective-transformer.js';
import type { PerspectiveTarget } from './vision-types.js';

export interface RectifiedPreviewOptions {
  maxSide?: number;
  maxPixels?: number;
  sampling?: 'bilinear' | 'nearest';
}

export interface RectifiedPreviewRequest {
  correction: CameraCorrection;
  target: PerspectiveTarget;
  options: RectifiedPreviewOptions;
}

export interface RectifiedPreviewJob extends RectifiedPreviewRequest {
  jpeg: Uint8Array;
}

/** Apply the exact same preview transform in the main thread or a worker. */
export function transformRectifiedPreview(
  jpeg: Buffer,
  { correction, target, options }: RectifiedPreviewRequest,
  transformer = new PerspectiveTransformer(),
) {
  const size = jpegSize(jpeg);
  if (
    size.width !== correction.sourceWidth ||
    size.height !== correction.sourceHeight
  )
    throw new RobotArmError(
      'VISION_BINDING_CHANGED',
      'Camera image dimensions changed; repeat correction',
      409,
    );
  let width = target.width;
  let height = target.height;
  let scale = 1;
  if (options.maxSide)
    scale = Math.min(scale, options.maxSide / Math.max(width, height));
  if (options.maxPixels)
    scale = Math.min(scale, Math.sqrt(options.maxPixels / (width * height)));
  if (scale < 1) {
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }
  return transformer.transform(jpeg, {
    points: correction.points,
    // The preview target already describes the intended output orientation.
    rotation: target.rotation,
    targetWidth: width,
    targetHeight: height,
    sampling: options.sampling,
  });
}
