export interface ColorPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface PointCloudOrigin {
  x: number;
  y: number;
  z: number;
}

export interface DepthPointCloud {
  center: PointCloudOrigin;
  colors: Float32Array;
  pointCount: number;
  positions: Float32Array;
  radius: number;
  stride: number;
}

export interface BuildDepthPointCloudInput {
  color: ColorPixels;
  depth: ArrayBuffer;
  depthHeight: number;
  depthWidth: number;
  fillDepthHoles?: boolean;
  intrinsics: { fx: number; fy: number; cx: number; cy: number };
  scaleMeters: number;
  maxPoints?: number;
  maxDepthMeters?: number;
  origin?: PointCloudOrigin;
  radius?: number;
}

export function depthClipZ(
  viewDepth: number,
  near: number,
  far: number,
): number {
  if (
    !Number.isFinite(viewDepth) ||
    !Number.isFinite(near) ||
    !Number.isFinite(far) ||
    near <= 0 ||
    far <= near
  )
    throw new Error('Invalid depth projection range');
  return (
    (far + near) / (far - near) - (2 * far * near) / ((far - near) * viewDepth)
  );
}

function fillHoleDepth(
  depthValues: Uint16Array,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
  maxDepthUnits: number,
): number {
  const neighbours: number[] = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) continue;
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      if (nx < 0 || nx >= width) continue;
      const candidate = depthValues[ny * width + nx] ?? 0;
      if (candidate > 0 && candidate <= maxDepthUnits)
        neighbours.push(candidate);
    }
  }
  if (neighbours.length < 4) return 0;
  neighbours.sort((left, right) => left - right);
  const median = neighbours[Math.floor(neighbours.length / 2)]!;
  const spread = neighbours.at(-1)! - neighbours[0]!;
  return spread <= Math.max(4, median * 0.03) ? median : 0;
}

/**
 * Re-project an RGB-aligned depth map into camera-space points and sample the
 * aligned color image for each point.
 */
export function buildDepthPointCloud({
  color,
  depth,
  depthHeight,
  depthWidth,
  fillDepthHoles = false,
  intrinsics,
  scaleMeters,
  maxPoints = 300_000,
  maxDepthMeters = 6,
  origin,
  radius: fixedRadius,
}: BuildDepthPointCloudInput): DepthPointCloud {
  if (
    depthWidth <= 0 ||
    depthHeight <= 0 ||
    color.width <= 0 ||
    color.height <= 0 ||
    intrinsics.fx <= 0 ||
    intrinsics.fy <= 0 ||
    scaleMeters <= 0
  )
    throw new Error('Invalid depth point cloud metadata');
  const depthValues = new Uint16Array(depth);
  if (depthValues.length < depthWidth * depthHeight)
    throw new Error('Depth frame is smaller than its advertised dimensions');
  const pixelCount = depthWidth * depthHeight;
  const hardMaxUnits = maxDepthMeters / scaleMeters;
  const sampleStep = Math.max(1, Math.floor(pixelCount / 20_000));
  const sample: number[] = [];
  for (let index = 0; index < pixelCount; index += sampleStep) {
    const units = depthValues[index] ?? 0;
    if (units > 0 && units <= hardMaxUnits) sample.push(units);
  }
  sample.sort((left, right) => left - right);
  const median = sample[Math.floor(sample.length / 2)];
  // RealSense reports sparse far-range invalid readings alongside a nearby
  // work surface. Centering the cloud on their min/max makes the useful scene
  // collapse into a few pixels, so bound the displayed range around the median.
  const displayMaxUnits =
    median === undefined ? hardMaxUnits : Math.min(hardMaxUnits, median * 4);
  let validPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const units = depthValues[index] ?? 0;
    if (units > 0 && units <= displayMaxUnits) validPixels += 1;
  }
  const stride = Math.max(1, Math.ceil(Math.sqrt(validPixels / maxPoints)));
  const capacity =
    Math.ceil(depthWidth / stride) * Math.ceil(depthHeight / stride);
  const rawPositions = new Float32Array(capacity * 3);
  const rawColors = new Float32Array(capacity * 3);
  const holeFillRadius = Math.max(2, Math.min(4, stride + 1));
  let pointCount = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < depthHeight; y += stride) {
    for (let x = 0; x < depthWidth; x += stride) {
      let units = depthValues[y * depthWidth + x] ?? 0;
      if (units === 0 && fillDepthHoles)
        units = fillHoleDepth(
          depthValues,
          depthWidth,
          depthHeight,
          x,
          y,
          holeFillRadius,
          displayMaxUnits,
        );
      if (units === 0) continue;
      const z = units * scaleMeters;
      if (z <= 0 || units > displayMaxUnits) continue;
      const px = ((x - intrinsics.cx) * z) / intrinsics.fx;
      const cameraY = ((y - intrinsics.cy) * z) / intrinsics.fy;
      const displayY = -cameraY;
      const offset = pointCount * 3;
      rawPositions[offset] = px;
      rawPositions[offset + 1] = displayY;
      rawPositions[offset + 2] = z;

      const colorX = Math.min(
        color.width - 1,
        Math.floor((x * color.width) / depthWidth),
      );
      const colorY = Math.min(
        color.height - 1,
        Math.floor((y * color.height) / depthHeight),
      );
      const colorOffset = (colorY * color.width + colorX) * 4;
      rawColors[offset] = (color.data[colorOffset] ?? 0) / 255;
      rawColors[offset + 1] = (color.data[colorOffset + 1] ?? 0) / 255;
      rawColors[offset + 2] = (color.data[colorOffset + 2] ?? 0) / 255;
      minX = Math.min(minX, px);
      minY = Math.min(minY, displayY);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, displayY);
      maxZ = Math.max(maxZ, z);
      pointCount += 1;
    }
  }

  if (pointCount === 0) {
    const center = origin ?? { x: 0, y: 0, z: 1 };
    return {
      center,
      colors: new Float32Array(),
      pointCount: 0,
      positions: new Float32Array(),
      radius: fixedRadius ?? 1,
      stride,
    };
  }

  const center: PointCloudOrigin = origin ?? {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2,
  };
  let radius = fixedRadius ?? 0;
  for (let index = 0; index < pointCount; index += 1) {
    const offset = index * 3;
    const x = rawPositions[offset]! - center.x;
    const y = rawPositions[offset + 1]! - center.y;
    const z = rawPositions[offset + 2]! - center.z;
    rawPositions[offset] = x;
    rawPositions[offset + 1] = y;
    rawPositions[offset + 2] = z;
    if (fixedRadius === undefined)
      radius = Math.max(radius, Math.hypot(x, y, z));
  }

  return {
    center,
    colors: rawColors.slice(0, pointCount * 3),
    pointCount,
    positions: rawPositions.slice(0, pointCount * 3),
    radius: Math.max(0.1, radius),
    stride,
  };
}
