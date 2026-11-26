import sharp from 'sharp';

/** Longest edge handed to the VLM; bigger frames only add latency and tokens. */
export const MODEL_FRAME_MAX_EDGE = 1280;

function isJpeg(jpeg: Buffer) {
  return (
    jpeg.length > 3 && jpeg[0] === 0xff && jpeg[1] === 0xd8 && jpeg[2] === 0xff
  );
}

/**
 * Downscale one camera frame for a model request. Coordinates measured on the
 * original frame (a screen outline, for example) must be multiplied by `scale`.
 * Anything that is not a decodable JPEG is returned untouched.
 */
export async function prepareModelFrame(
  jpeg: Buffer,
  maxEdge = MODEL_FRAME_MAX_EDGE,
): Promise<{ jpeg: Buffer; scale: number }> {
  if (!isJpeg(jpeg)) return { jpeg, scale: 1 };
  try {
    const metadata = await sharp(jpeg).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (!width || !height || Math.max(width, height) <= maxEdge)
      return { jpeg, scale: 1 };
    const { data, info } = await sharp(jpeg)
      .resize({
        width: maxEdge,
        height: maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    return { jpeg: data, scale: info.width / width };
  } catch {
    return { jpeg, scale: 1 };
  }
}
