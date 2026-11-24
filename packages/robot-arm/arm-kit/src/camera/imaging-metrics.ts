import sharp from 'sharp';
import type { CameraCorrection } from '../contracts.js';
import { jpegSize } from './jpeg-size.js';
import {
  applyHomography,
  computeHomography,
  quadToArray,
} from './vision-geometry.js';

const EXPOSURE_WIDTH = 128;
const EXPOSURE_HEIGHT = 72;
const ROI_INSET = 0.04;
const FOCUS_WORK_WIDTH = 1280;
const FOCUS_SAMPLE_WIDTH = 180;
const FOCUS_TILE_COLUMNS = 6;
const FOCUS_TILE_ROWS = 12;
const TONE_PATCH_WIDTH = 36;
const TONE_PATCH_HEIGHT = 18;
const WHITE_BALANCE_MIN_PATCHES = 3;
const WHITE_BALANCE_MIN_LEVEL_SPREAD = 45;
const CALIBRATION_TONE_LEVELS = [245, 221, 184, 143, 103, 65, 23] as const;
const CALIBRATION_TONE_CELL_COLUMNS = 3;
const CALIBRATION_TONE_CELL_ROWS = 2;
const CALIBRATION_TONE_CELL_WIDTH = 18;
const CALIBRATION_TONE_CELL_HEIGHT = 12;
const CALIBRATION_MIN_TONE_LEVELS = 4;
const CALIBRATION_MAX_TONE_CONTAMINATION = 0.4;
const CALIBRATION_TARGET_WHITE = 205;
const CALIBRATION_TARGET_BLACK = 24;
const CALIBRATION_CHECKER_COLUMNS = 10;
const CALIBRATION_CHECKER_ROWS = 8;
const CALIBRATION_CHECKER_CELL_WIDTH = 20;
const CALIBRATION_CHECKER_CELL_HEIGHT = 12;
const CALIBRATION_CHECKER_MIN_CLEAN_RATIO = 0.35;
const CALIBRATION_CHECKER_MAX_CONTAMINATION = 0.5;
const CALIBRATION_CHECKER_TARGET_WHITE = 220;

export interface NormalizedImageRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Interior of the bottom-left white tile in the calibration pattern. */
export const CALIBRATION_EXPOSURE_REGION: NormalizedImageRegion = {
  left: 0.06,
  top: 0.82,
  right: 0.27,
  bottom: 0.95,
};

/** Interior sampling windows for the seven neutral bars in the phone pattern. */
export const CALIBRATION_TONE_REGIONS: readonly NormalizedImageRegion[] =
  Array.from({ length: 7 }, (_, index) => ({
    left: (index + 0.12) / 7,
    top: 0.73,
    right: (index + 0.88) / 7,
    bottom: 0.97,
  }));

const CALIBRATION_CHECKER_REGION: NormalizedImageRegion = {
  left: 0.04,
  top: 0.2,
  right: 0.96,
  bottom: 0.68,
};

const CALIBRATION_HEADER_WHITE_REGIONS: readonly NormalizedImageRegion[] = [
  { left: 0.04, top: 0.03, right: 0.25, bottom: 0.15 },
  { left: 0.75, top: 0.03, right: 0.96, bottom: 0.15 },
];

export interface ImagingScreen {
  screenId: string;
  correction: CameraCorrection;
}

export interface LumaMetrics {
  mean: number;
  stddev: number;
  brightRatio: number;
  darkRatio: number;
  p95: number;
  p99: number;
  overExposedRatio: number;
  underExposedRatio: number;
  hiTileRatio: number;
  hiComponentCount: number;
  hiComponentLargestShare: number;
}

export interface ExposureReading {
  roiEnabled: boolean;
  full: LumaMetrics;
  auto: LumaMetrics;
  selected: LumaMetrics;
  screenReadings: Array<{ screenId: string; metrics: LumaMetrics }>;
  updatedAt: number;
}

export type ExposureCalibrationMode =
  | 'grayscale-ramp'
  | 'fullscreen-masked'
  | 'insufficient';

export interface ExposureCalibrationAssessment {
  mode: ExposureCalibrationMode;
  score: number;
  direction?: 'too-bright' | 'too-dark';
  confidence: number;
  contaminationRatio: number;
  validToneLevels: number;
  white: number;
  black: number;
  warnings: string[];
}

export interface CalibrationExposureScreenReading {
  screenId: string;
  metrics: LumaMetrics;
  assessment: ExposureCalibrationAssessment;
}

export interface CalibrationExposureReading
  extends Omit<ExposureReading, 'screenReadings'> {
  screenReadings: CalibrationExposureScreenReading[];
}

export interface FocusReading {
  score: number;
  anisotropy: number;
  overExposedRatio: number;
  screens: Array<{
    screenId: string;
    score: number;
    lowerQuartile: number;
    anisotropy: number;
    overExposedRatio: number;
  }>;
}

export interface WhiteBalanceReading {
  score: number;
  redGreenRatio: number;
  blueGreenRatio: number;
  screens: Array<{
    screenId: string;
    score: number;
    redGreenRatio: number;
    blueGreenRatio: number;
    samples: number;
  }>;
}

export interface ToneReading {
  score: number;
  white: number;
  midtone: number;
  black: number;
  spread: number;
  monotonic: boolean;
  screens: Array<{
    screenId: string;
    score: number;
    levels: number[];
    monotonic: boolean;
  }>;
}

interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

interface RgbImage {
  width: number;
  height: number;
  data: Uint8Array;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function median(values: readonly number[]) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] ?? 0;
}

function percentile(values: readonly number[], fraction: number) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[
    clamp(Math.floor((ordered.length - 1) * fraction), 0, ordered.length - 1)
  ]!;
}

function percentileHistogram(histogram: Uint32Array, fraction: number) {
  let total = 0;
  for (const count of histogram) total += count;
  if (!total) return 0;
  const target = Math.floor((total - 1) * fraction);
  let seen = 0;
  for (let level = 0; level < histogram.length; level += 1) {
    seen += histogram[level]!;
    if (seen > target) return level;
  }
  return 255;
}

function sampleBilinear(image: GrayImage, x: number, y: number) {
  const left = Math.floor(x);
  const top = Math.floor(y);
  const dx = x - left;
  const dy = y - top;
  const x0 = clamp(left, 0, image.width - 1);
  const y0 = clamp(top, 0, image.height - 1);
  const x1 = clamp(left + 1, 0, image.width - 1);
  const y1 = clamp(top + 1, 0, image.height - 1);
  const a = image.data[y0 * image.width + x0]!;
  const b = image.data[y0 * image.width + x1]!;
  const c = image.data[y1 * image.width + x0]!;
  const d = image.data[y1 * image.width + x1]!;
  return (
    a * (1 - dx) * (1 - dy) +
    b * dx * (1 - dy) +
    c * (1 - dx) * dy +
    d * dx * dy
  );
}

function sampleBilinearRgb(image: RgbImage, x: number, y: number) {
  const left = Math.floor(x);
  const top = Math.floor(y);
  const dx = x - left;
  const dy = y - top;
  const x0 = clamp(left, 0, image.width - 1);
  const y0 = clamp(top, 0, image.height - 1);
  const x1 = clamp(left + 1, 0, image.width - 1);
  const y1 = clamp(top + 1, 0, image.height - 1);
  const at = (sampleX: number, sampleY: number, channel: number) =>
    image.data[(sampleY * image.width + sampleX) * 3 + channel]!;
  return [0, 1, 2].map((channel) => {
    const a = at(x0, y0, channel);
    const b = at(x1, y0, channel);
    const c = at(x0, y1, channel);
    const d = at(x1, y1, channel);
    return (
      a * (1 - dx) * (1 - dy) +
      b * dx * (1 - dy) +
      c * (1 - dx) * dy +
      d * dx * dy
    );
  });
}

function scaledQuad(correction: CameraCorrection, image: GrayImage) {
  const scaleX = image.width / correction.sourceWidth;
  const scaleY = image.height / correction.sourceHeight;
  return quadToArray(correction.points).map((point) => ({
    x: point.x * scaleX,
    y: point.y * scaleY,
  }));
}

function samplePerspective(
  image: GrayImage,
  correction: CameraCorrection,
  width: number,
  height: number,
  region: NormalizedImageRegion = {
    left: 0,
    top: 0,
    right: 1,
    bottom: 1,
  },
) {
  const quad = scaledQuad(correction, image);
  const transform = computeHomography(
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    quad,
  );
  const output = new Uint8Array(width * height);
  const left = region.left + (region.right - region.left) * ROI_INSET;
  const right = region.right - (region.right - region.left) * ROI_INSET;
  const top = region.top + (region.bottom - region.top) * ROI_INSET;
  const bottom = region.bottom - (region.bottom - region.top) * ROI_INSET;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const point = applyHomography(transform, {
        x: left + ((x + 0.5) / width) * (right - left),
        y: top + ((y + 0.5) / height) * (bottom - top),
      });
      output[y * width + x] = Math.round(
        sampleBilinear(image, point.x, point.y),
      );
    }
  }
  return output;
}

function samplePerspectiveRgb(
  image: RgbImage,
  correction: CameraCorrection,
  width: number,
  height: number,
  region: NormalizedImageRegion,
) {
  const quad = scaledQuad(correction, image);
  const transform = computeHomography(
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    quad,
  );
  const output = new Uint8Array(width * height * 3);
  const left = region.left + (region.right - region.left) * ROI_INSET;
  const right = region.right - (region.right - region.left) * ROI_INSET;
  const top = region.top + (region.bottom - region.top) * ROI_INSET;
  const bottom = region.bottom - (region.bottom - region.top) * ROI_INSET;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const point = applyHomography(transform, {
        x: left + ((x + 0.5) / width) * (right - left),
        y: top + ((y + 0.5) / height) * (bottom - top),
      });
      const rgb = sampleBilinearRgb(image, point.x, point.y);
      for (let channel = 0; channel < 3; channel += 1)
        output[(y * width + x) * 3 + channel] = Math.round(rgb[channel]!);
    }
  }
  return output;
}

function sampleFrame(image: GrayImage, width: number, height: number) {
  const output = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      output[y * width + x] = Math.round(
        sampleBilinear(
          image,
          ((x + 0.5) / width) * image.width - 0.5,
          ((y + 0.5) / height) * image.height - 0.5,
        ),
      );
    }
  }
  return output;
}

function highlightStructure(data: Uint8Array, width: number, height: number) {
  const saturated = new Uint8Array(data.length);
  const histogram = new Uint32Array(256);
  let saturatedCount = 0;
  for (let index = 0; index < data.length; index += 1) {
    const value = data[index]!;
    histogram[value] = (histogram[value] ?? 0) + 1;
    if (value > 245) {
      saturated[index] = 1;
      saturatedCount++;
    }
  }

  const columns = 8;
  const rows = 6;
  let highlightedTiles = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = Math.floor((column * width) / columns);
      const x1 = Math.floor(((column + 1) * width) / columns);
      const y0 = Math.floor((row * height) / rows);
      const y1 = Math.floor(((row + 1) * height) / rows);
      let count = 0;
      for (let y = y0; y < y1; y += 1)
        for (let x = x0; x < x1; x += 1) count += saturated[y * width + x]!;
      const area = Math.max(1, (x1 - x0) * (y1 - y0));
      if (count / area >= 0.005) highlightedTiles++;
    }
  }

  const visited = new Uint8Array(data.length);
  const components: number[] = [];
  const queue = new Int32Array(data.length);
  for (let start = 0; start < saturated.length; start += 1) {
    if (!saturated[start] || visited[start]) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    visited[start] = 1;
    let area = 0;
    while (head < tail) {
      const index = queue[head++]!;
      area++;
      const x = index % width;
      const y = Math.floor(index / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height)
            continue;
          const next = nextY * width + nextX;
          if (!saturated[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (area >= 3) components.push(area);
  }
  const significant = components.reduce((sum, value) => sum + value, 0);
  return {
    histogram,
    hiTileRatio: highlightedTiles / (columns * rows),
    hiComponentCount: components.length,
    hiComponentLargestShare: significant
      ? Math.max(...components) / significant
      : 0,
    saturatedCount,
  };
}

function metricsFromPixels(
  data: Uint8Array,
  width: number,
  height: number,
): LumaMetrics {
  const structure = highlightStructure(data, width, height);
  let sum = 0;
  let sumSquares = 0;
  let bright = 0;
  let dark = 0;
  let under = 0;
  for (const value of data) {
    sum += value;
    sumSquares += value * value;
    if (value > 20) bright++;
    if (value <= 24) dark++;
    if (value <= 12) under++;
  }
  const count = Math.max(1, data.length);
  const mean = sum / count;
  return {
    mean: round(mean),
    stddev: round(Math.sqrt(Math.max(0, sumSquares / count - mean * mean))),
    brightRatio: round(bright / count, 4),
    darkRatio: round(dark / count, 4),
    p95: percentileHistogram(structure.histogram, 0.95),
    p99: percentileHistogram(structure.histogram, 0.99),
    overExposedRatio: round(structure.saturatedCount / count, 4),
    underExposedRatio: round(under / count, 4),
    hiTileRatio: round(structure.hiTileRatio, 4),
    hiComponentCount: structure.hiComponentCount,
    hiComponentLargestShare: round(structure.hiComponentLargestShare, 4),
  };
}

function combineMetrics(
  images: readonly Uint8Array[],
  width: number,
  height: number,
): LumaMetrics {
  if (!images.length)
    return metricsFromPixels(
      new Uint8Array(EXPOSURE_WIDTH * EXPOSURE_HEIGHT),
      EXPOSURE_WIDTH,
      EXPOSURE_HEIGHT,
    );
  const combined = new Uint8Array(width * height * images.length);
  images.forEach((image, index) => combined.set(image, index * width * height));
  return metricsFromPixels(combined, width, height * images.length);
}

export function classifyExposureExtreme(
  metrics: LumaMetrics,
): 'too-bright' | 'too-dark' | undefined {
  const structuredHighlight =
    metrics.hiTileRatio >= 0.4 && metrics.hiComponentLargestShare <= 0.6;
  const darkUiHighlight =
    metrics.mean <= 120 &&
    metrics.p95 >= 235 &&
    metrics.overExposedRatio >= 0.03 &&
    structuredHighlight;
  if (darkUiHighlight) return 'too-bright';
  if (
    metrics.p95 >= 240 &&
    metrics.p99 >= 250 &&
    metrics.overExposedRatio >= 0.25
  )
    return 'too-bright';
  if (metrics.mean >= 205 && metrics.brightRatio >= 0.95) return 'too-bright';
  if (
    metrics.mean <= 65 &&
    metrics.p95 <= 110 &&
    metrics.p99 <= 135 &&
    (metrics.darkRatio >= 0.25 || metrics.underExposedRatio >= 0.18)
  )
    return 'too-dark';
  return undefined;
}

export function isStructuredDarkUiHighlight(metrics: LumaMetrics) {
  return (
    metrics.mean <= 120 &&
    metrics.p95 >= 235 &&
    metrics.overExposedRatio >= 0.03 &&
    metrics.hiTileRatio >= 0.4 &&
    metrics.hiComponentLargestShare <= 0.6
  );
}

export function exposureTargetDirection(
  metrics: LumaMetrics,
  darkModeActive = false,
): 'too-bright' | 'too-dark' | undefined {
  if (metrics.p99 > 235 || metrics.overExposedRatio > 0.05) return 'too-bright';
  if (metrics.mean > 180) return 'too-bright';
  if (metrics.mean < (darkModeActive ? 30 : 90)) return 'too-dark';
  return undefined;
}

export function exposureSeverity(
  metrics: LumaMetrics,
  direction: 'too-bright' | 'too-dark',
) {
  if (direction === 'too-bright') {
    if (
      metrics.mean >= 240 &&
      metrics.overExposedRatio >= 0.9 &&
      metrics.p99 >= 254
    )
      return 3;
    if (
      metrics.mean >= 220 &&
      metrics.overExposedRatio >= 0.75 &&
      metrics.p99 >= 252
    )
      return 2;
    return 1;
  }
  if (
    metrics.mean <= 15 &&
    metrics.p95 <= 30 &&
    metrics.underExposedRatio >= 0.5
  )
    return 3;
  if (
    metrics.mean <= 30 &&
    metrics.p95 <= 55 &&
    metrics.underExposedRatio >= 0.28
  )
    return 2;
  return 1;
}

async function decodeExposureFrame(jpeg: Buffer): Promise<GrayImage> {
  const { data, info } = await sharp(jpeg, { limitInputPixels: 16_777_216 })
    .rotate()
    .greyscale()
    .resize({
      width: 1024,
      withoutEnlargement: true,
      fit: 'inside',
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  };
}

async function decodeRgbFrame(jpeg: Buffer): Promise<RgbImage> {
  const { data, info } = await sharp(jpeg, { limitInputPixels: 16_777_216 })
    .rotate()
    .toColourspace('srgb')
    .removeAlpha()
    .resize({
      width: 1024,
      withoutEnlargement: true,
      fit: 'inside',
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  };
}

function rgbPatchMeans(pixels: Uint8Array) {
  const totals = [0, 0, 0];
  for (let index = 0; index < pixels.length; index += 3)
    for (let channel = 0; channel < 3; channel += 1)
      totals[channel] = totals[channel]! + pixels[index + channel]!;
  const count = Math.max(1, pixels.length / 3);
  return totals.map((total) => total / count) as [number, number, number];
}

export async function measureWhiteBalance(
  jpeg: Buffer,
  screens: readonly ImagingScreen[],
): Promise<WhiteBalanceReading | undefined> {
  const source = jpegSize(jpeg);
  const image = await decodeRgbFrame(jpeg);
  const screenReadings = screens.flatMap((screen) => {
    if (
      screen.correction.sourceWidth !== source.width ||
      screen.correction.sourceHeight !== source.height
    )
      return [];
    const patches: Array<{
      level: number;
      redGreenRatio: number;
      blueGreenRatio: number;
    }> = [];
    for (const region of CALIBRATION_TONE_REGIONS) {
      const [r, g, b] = rgbPatchMeans(
        samplePerspectiveRgb(
          image,
          screen.correction,
          TONE_PATCH_WIDTH,
          TONE_PATCH_HEIGHT,
          region,
        ),
      );
      const level = (r + g + b) / 3;
      const maxChannel = Math.max(r, g, b);
      const minChannel = Math.min(r, g, b);
      if (
        level < 24 ||
        level > 242 ||
        maxChannel >= 248 ||
        minChannel <= 6 ||
        g < 18
      )
        continue;
      patches.push({
        level,
        redGreenRatio: r / g,
        blueGreenRatio: b / g,
      });
    }
    const levels = patches.map((patch) => patch.level);
    if (
      patches.length < WHITE_BALANCE_MIN_PATCHES ||
      Math.max(...levels) - Math.min(...levels) < WHITE_BALANCE_MIN_LEVEL_SPREAD
    )
      return [];
    const errors = patches.map(
      ({ redGreenRatio, blueGreenRatio }) =>
        Math.abs(Math.log(Math.max(0.001, redGreenRatio))) +
        Math.abs(Math.log(Math.max(0.001, blueGreenRatio))),
    );
    const redGreenRatio = Math.exp(
      median(patches.map((patch) => Math.log(patch.redGreenRatio))),
    );
    const blueGreenRatio = Math.exp(
      median(patches.map((patch) => Math.log(patch.blueGreenRatio))),
    );
    return [
      {
        screenId: screen.screenId,
        score: 0.65 * median(errors) + 0.35 * Math.max(...errors),
        redGreenRatio,
        blueGreenRatio,
        samples: patches.length,
      },
    ];
  });
  if (!screenReadings.length) return undefined;
  const errors = screenReadings.map((screen) => screen.score);
  const mean = errors.reduce((sum, value) => sum + value, 0) / errors.length;
  return {
    score: round(0.7 * Math.max(...errors) + 0.3 * mean, 6),
    redGreenRatio: round(
      screenReadings.reduce((sum, screen) => sum + screen.redGreenRatio, 0) /
        screenReadings.length,
      6,
    ),
    blueGreenRatio: round(
      screenReadings.reduce((sum, screen) => sum + screen.blueGreenRatio, 0) /
        screenReadings.length,
      6,
    ),
    screens: screenReadings.map((screen) => ({
      ...screen,
      score: round(screen.score, 6),
      redGreenRatio: round(screen.redGreenRatio, 6),
      blueGreenRatio: round(screen.blueGreenRatio, 6),
    })),
  };
}

function toneScore(levels: readonly number[]) {
  const white = levels[0] ?? 0;
  const midtone = levels[3] ?? 0;
  const black = levels[6] ?? 0;
  const spread = white - black;
  const monotonic = levels.every(
    (value, index) => index === 0 || levels[index - 1]! >= value - 0.5,
  );
  const targetError = Math.abs(midtone - 140) / 140;
  const whiteError = Math.abs(white - 220) / 220;
  const blackError = Math.abs(black - 24) / 24;
  const spreadError = Math.abs(spread - 196) / 196;
  const clipping =
    Math.max(0, white - 244) / 6 +
    Math.max(0, 6 - black) / 6 +
    (monotonic ? 0 : 0.5);
  return {
    score:
      targetError * 0.35 +
      whiteError * 0.2 +
      blackError * 0.1 +
      spreadError * 0.2 +
      clipping,
    white,
    midtone,
    black,
    spread,
    monotonic,
  };
}

export async function measureTone(
  jpeg: Buffer,
  screens: readonly ImagingScreen[],
): Promise<ToneReading | undefined> {
  const source = jpegSize(jpeg);
  const image = await decodeRgbFrame(jpeg);
  const screenReadings = screens.flatMap((screen) => {
    if (
      screen.correction.sourceWidth !== source.width ||
      screen.correction.sourceHeight !== source.height
    )
      return [];
    const levels = CALIBRATION_TONE_REGIONS.map((region) => {
      const pixels = samplePerspectiveRgb(
        image,
        screen.correction,
        TONE_PATCH_WIDTH,
        TONE_PATCH_HEIGHT,
        region,
      );
      let total = 0;
      for (let index = 0; index < pixels.length; index += 3)
        total +=
          0.2126 * pixels[index]! +
          0.7152 * pixels[index + 1]! +
          0.0722 * pixels[index + 2]!;
      return total / Math.max(1, pixels.length / 3);
    });
    const reading = toneScore(levels);
    return [
      {
        screenId: screen.screenId,
        score: reading.score,
        levels: levels.map((value) => round(value, 2)),
        monotonic: reading.monotonic,
      },
    ];
  });
  if (!screenReadings.length) return undefined;
  const scores = screenReadings.map((screen) => screen.score);
  const levels = CALIBRATION_TONE_REGIONS.map((_, index) => {
    const values = screenReadings.map((screen) => screen.levels[index] ?? 0);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  });
  const combined = toneScore(levels);
  return {
    score: round(0.65 * Math.max(...scores) + 0.35 * combined.score, 6),
    white: round(combined.white, 2),
    midtone: round(combined.midtone, 2),
    black: round(combined.black, 2),
    spread: round(combined.spread, 2),
    monotonic: screenReadings.every((screen) => screen.monotonic),
    screens: screenReadings.map((screen) => ({
      ...screen,
      score: round(screen.score, 6),
    })),
  };
}

export async function measureExposure(
  jpeg: Buffer,
  screens: readonly ImagingScreen[],
  options: { region?: NormalizedImageRegion } = {},
): Promise<ExposureReading> {
  const source = jpegSize(jpeg);
  const image = await decodeExposureFrame(jpeg);
  const full = metricsFromPixels(
    sampleFrame(image, EXPOSURE_WIDTH, EXPOSURE_HEIGHT),
    EXPOSURE_WIDTH,
    EXPOSURE_HEIGHT,
  );
  const screenReadings = screens.flatMap((screen) => {
    if (
      screen.correction.sourceWidth !== source.width ||
      screen.correction.sourceHeight !== source.height
    )
      return [];
    const pixels = samplePerspective(
      image,
      screen.correction,
      EXPOSURE_WIDTH,
      EXPOSURE_HEIGHT,
      options.region,
    );
    return [
      {
        screenId: screen.screenId,
        metrics: metricsFromPixels(pixels, EXPOSURE_WIDTH, EXPOSURE_HEIGHT),
        pixels,
      },
    ];
  });
  const auto = screenReadings.length
    ? combineMetrics(
        screenReadings.map((screen) => screen.pixels),
        EXPOSURE_WIDTH,
        EXPOSURE_HEIGHT,
      )
    : full;
  return {
    roiEnabled: screenReadings.length > 0,
    full,
    auto,
    selected: auto,
    screenReadings: screenReadings.map(({ screenId, metrics }) => ({
      screenId,
      metrics,
    })),
    updatedAt: Date.now(),
  };
}

interface PatchStats {
  mean: number;
  stddev: number;
  low: number;
  high: number;
  clippedRatio: number;
  chroma: number;
}

interface ToneBarEvidence {
  level: number;
  clippedRatio: number;
  contaminationRatio: number;
  valid: boolean;
}

interface ToneRampEvidence {
  bars: ToneBarEvidence[];
  white: number;
  black: number;
  residual: number;
  contaminationRatio: number;
  validLevels: number;
  levelSpan: number;
  score: number;
  direction?: 'too-bright' | 'too-dark';
  usable: boolean;
  warnings: string[];
}

interface CheckerEvidence {
  white: number;
  black: number;
  contaminationRatio: number;
  clippedRatio: number;
  cleanRatio: number;
  score: number;
  direction?: 'too-bright' | 'too-dark';
  usable: boolean;
  warnings: string[];
}

function subregion(
  region: NormalizedImageRegion,
  column: number,
  row: number,
  columns: number,
  rows: number,
): NormalizedImageRegion {
  const width = (region.right - region.left) / columns;
  const height = (region.bottom - region.top) / rows;
  return {
    left: region.left + column * width,
    top: region.top + row * height,
    right: region.left + (column + 1) * width,
    bottom: region.top + (row + 1) * height,
  };
}

function patchStats(pixels: Uint8Array): PatchStats {
  const histogram = new Uint32Array(256);
  const levels: number[] = [];
  let total = 0;
  let totalSquares = 0;
  let clipped = 0;
  let chroma = 0;
  for (let index = 0; index < pixels.length; index += 3) {
    const red = pixels[index]!;
    const green = pixels[index + 1]!;
    const blue = pixels[index + 2]!;
    const level = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    const rounded = clamp(Math.round(level), 0, 255);
    histogram[rounded] = (histogram[rounded] ?? 0) + 1;
    levels.push(level);
    total += level;
    totalSquares += level * level;
    if (rounded > 245) clipped++;
    if (level > 20)
      chroma +=
        (Math.max(red, green, blue) - Math.min(red, green, blue)) /
        Math.max(1, level);
  }
  const count = Math.max(1, levels.length);
  const mean = total / count;
  return {
    mean,
    stddev: Math.sqrt(Math.max(0, totalSquares / count - mean * mean)),
    low: percentileHistogram(histogram, 0.2),
    high: percentileHistogram(histogram, 0.8),
    clippedRatio: clipped / count,
    chroma: chroma / count,
  };
}

function rgbPixelsToGray(pixels: Uint8Array) {
  const output = new Uint8Array(pixels.length / 3);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Math.round(
      0.2126 * pixels[index * 3]! +
        0.7152 * pixels[index * 3 + 1]! +
        0.0722 * pixels[index * 3 + 2]!,
    );
  }
  return output;
}

function rgbImageToGray(image: RgbImage): GrayImage {
  return {
    width: image.width,
    height: image.height,
    data: rgbPixelsToGray(image.data),
  };
}

function medianAbsoluteDeviation(values: readonly number[]) {
  if (!values.length) return 0;
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

function fitToneMap(
  references: readonly number[],
  observations: readonly number[],
) {
  let weights = observations.map(() => 1);
  let intercept = 0;
  let scale = 0;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    let weightSum = 0;
    let xSum = 0;
    let ySum = 0;
    let xxSum = 0;
    let xySum = 0;
    references.forEach((reference, index) => {
      const weight = weights[index] ?? 1;
      const x = reference / 255;
      const y = observations[index] ?? 0;
      weightSum += weight;
      xSum += weight * x;
      ySum += weight * y;
      xxSum += weight * x * x;
      xySum += weight * x * y;
    });
    const denominator = weightSum * xxSum - xSum * xSum;
    if (Math.abs(denominator) < 1e-9) {
      const black = Math.min(...observations);
      const white = Math.max(...observations);
      return {
        black,
        white,
        predict: (reference: number) =>
          black + ((white - black) * reference) / 255,
      };
    }
    scale = Math.max(0, (weightSum * xySum - xSum * ySum) / denominator);
    intercept = (ySum - scale * xSum) / Math.max(1e-9, weightSum);
    const residuals = references.map((reference, index) => {
      const residual =
        (observations[index] ?? 0) - (intercept + scale * (reference / 255));
      return Math.abs(residual);
    });
    const center = median(residuals);
    const deviation = Math.max(1, medianAbsoluteDeviation(residuals));
    const cutoff = Math.max(10, center + 2.5 * deviation);
    weights = residuals.map((residual) =>
      residual <= cutoff ? 1 : cutoff / residual,
    );
  }
  return {
    black: intercept,
    white: intercept + scale,
    predict: (reference: number) => intercept + scale * (reference / 255),
  };
}

function analyzeToneRamp(
  image: RgbImage,
  correction: CameraCorrection,
  checker: CheckerEvidence,
): ToneRampEvidence {
  const bars = CALIBRATION_TONE_REGIONS.map((region) => {
    const cells: PatchStats[] = [];
    for (let row = 0; row < CALIBRATION_TONE_CELL_ROWS; row += 1) {
      for (
        let column = 0;
        column < CALIBRATION_TONE_CELL_COLUMNS;
        column += 1
      ) {
        const pixels = samplePerspectiveRgb(
          image,
          correction,
          CALIBRATION_TONE_CELL_WIDTH,
          CALIBRATION_TONE_CELL_HEIGHT,
          subregion(
            region,
            column,
            row,
            CALIBRATION_TONE_CELL_COLUMNS,
            CALIBRATION_TONE_CELL_ROWS,
          ),
        );
        cells.push(patchStats(pixels));
      }
    }
    const center = median(cells.map((cell) => cell.mean));
    const deviation = Math.max(
      1,
      medianAbsoluteDeviation(cells.map((cell) => cell.mean)),
    );
    const clean = cells.filter(
      (cell) =>
        cell.mean <= center + Math.max(12, 3 * deviation) &&
        cell.clippedRatio <= 0.2,
    );
    const clippedRatio =
      cells.reduce((sum, cell) => sum + cell.clippedRatio, 0) / cells.length;
    return {
      level: median(clean.map((cell) => cell.mean)),
      clippedRatio,
      contaminationRatio: 1 - clean.length / Math.max(1, cells.length),
      valid: clean.length >= Math.ceil(cells.length / 2),
    } satisfies ToneBarEvidence;
  });
  const observations = bars.map((bar) => bar.level);
  const active = bars.map((bar) => bar.valid);
  const fitActive = () => {
    const references = CALIBRATION_TONE_LEVELS.filter(
      (_, index) => active[index],
    );
    const values = observations.filter((_, index) => active[index]);
    return references.length >= 2
      ? fitToneMap(references, values)
      : {
          black: 0,
          white: 0,
          predict: () => 0,
        };
  };
  let fit = fitActive();
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const range = Math.max(1, fit.white - fit.black);
    let changed = false;
    bars.forEach((bar, index) => {
      if (!active[index]) return;
      const residual = Math.abs(
        bar.level - fit.predict(CALIBRATION_TONE_LEVELS[index]!),
      );
      const whiteMismatch =
        index === 0 &&
        checker.usable &&
        Math.abs(bar.level - checker.white) >
          Math.max(16, checker.white * 0.08);
      const blackMismatch =
        index === 6 &&
        checker.usable &&
        Math.abs(bar.level - checker.black) >
          Math.max(18, checker.black * 0.35);
      if (
        residual > Math.max(14, range * 0.08) ||
        whiteMismatch ||
        blackMismatch
      ) {
        active[index] = false;
        changed = true;
      }
    });
    if (!changed || active.filter(Boolean).length < CALIBRATION_MIN_TONE_LEVELS)
      break;
    fit = fitActive();
  }
  const validIndexes = active.flatMap((valid, index) => (valid ? [index] : []));
  const residual =
    validIndexes.reduce(
      (sum, index) =>
        sum +
        Math.abs(
          observations[index]! - fit.predict(CALIBRATION_TONE_LEVELS[index]!),
        ),
      0,
    ) / Math.max(1, validIndexes.length);
  const white = active[0]
    ? observations[0]!
    : checker.usable
      ? checker.white
      : fit.white;
  const black = active[6]
    ? observations[6]!
    : checker.usable
      ? checker.black
      : fit.black;
  const firstLevel = validIndexes.length
    ? CALIBRATION_TONE_LEVELS[validIndexes[0]!]!
    : 0;
  const lastLevel = validIndexes.length
    ? CALIBRATION_TONE_LEVELS[validIndexes.at(-1)!]!
    : 0;
  const levelSpan = (firstLevel - lastLevel) / 222;
  const contaminationRatio = Math.min(
    1,
    Math.max(
      bars.reduce((sum, bar) => sum + bar.contaminationRatio, 0) / bars.length,
      (bars.length - validIndexes.length) / bars.length,
    ),
  );
  const clippedRatio =
    bars.reduce((sum, bar) => sum + bar.clippedRatio, 0) / bars.length;
  const coveragePenalty =
    (1 - validIndexes.length / bars.length) * 0.35 +
    Math.max(0, 0.6 - levelSpan) * 0.5;
  const score =
    Math.abs(white - CALIBRATION_TARGET_WHITE) / CALIBRATION_TARGET_WHITE +
    (Math.abs(black - CALIBRATION_TARGET_BLACK) / 96) * 0.25 +
    (residual / 255) * 2 +
    Math.max(0, clippedRatio - 0.05) * 2 +
    coveragePenalty;
  const direction =
    white >= 238 || clippedRatio >= 0.25
      ? 'too-bright'
      : white <= 155
        ? 'too-dark'
        : undefined;
  const usable =
    validIndexes.length >= CALIBRATION_MIN_TONE_LEVELS &&
    levelSpan >= 0.55 &&
    contaminationRatio <= CALIBRATION_MAX_TONE_CONTAMINATION &&
    residual <= 22 &&
    !(checker.usable && !active[0] && !active[6]);
  const warnings: string[] = [];
  if (!active[0]) warnings.push('The white calibration bar was excluded');
  if (contaminationRatio >= 0.2)
    warnings.push('Part of the grayscale calibration bar was excluded');
  if (!usable)
    warnings.push(
      'The grayscale calibration bar did not provide enough clean levels',
    );
  return {
    bars,
    white,
    black,
    residual,
    contaminationRatio,
    validLevels: validIndexes.length,
    levelSpan,
    score,
    direction,
    usable,
    warnings,
  };
}

function analyzeChecker(
  image: RgbImage,
  correction: CameraCorrection,
): CheckerEvidence {
  const cells: Array<{
    stats: PatchStats;
    column: number;
    row: number;
  }> = [];
  for (let row = 0; row < CALIBRATION_CHECKER_ROWS; row += 1) {
    for (let column = 0; column < CALIBRATION_CHECKER_COLUMNS; column += 1) {
      const stats = patchStats(
        samplePerspectiveRgb(
          image,
          correction,
          CALIBRATION_CHECKER_CELL_WIDTH,
          CALIBRATION_CHECKER_CELL_HEIGHT,
          subregion(
            CALIBRATION_CHECKER_REGION,
            column,
            row,
            CALIBRATION_CHECKER_COLUMNS,
            CALIBRATION_CHECKER_ROWS,
          ),
        ),
      );
      cells.push({ stats, column, row });
    }
  }
  const initialBlack = median(cells.map((cell) => cell.stats.low));
  const blackDeviation = Math.max(
    1,
    medianAbsoluteDeviation(cells.map((cell) => cell.stats.low)),
  );
  const clean = cells.filter(
    (cell) =>
      cell.stats.low <= initialBlack + Math.max(16, 3 * blackDeviation) &&
      !(cell.stats.low > initialBlack + 8 && cell.stats.chroma > 0.18),
  );
  const blackValues = clean.map((cell) => cell.stats.low);
  const whiteValues = clean.map((cell) => cell.stats.high);
  const headerWhites = CALIBRATION_HEADER_WHITE_REGIONS.map(
    (region) =>
      patchStats(
        samplePerspectiveRgb(
          image,
          correction,
          CALIBRATION_CHECKER_CELL_WIDTH,
          CALIBRATION_CHECKER_CELL_HEIGHT,
          region,
        ),
      ).high,
  ).filter((value) => value >= 90);
  const black = median(blackValues);
  const white = median(whiteValues.length >= 8 ? whiteValues : headerWhites);
  const clippedRatio =
    clean.reduce((sum, cell) => sum + cell.stats.clippedRatio, 0) /
    Math.max(1, clean.length);
  const quadrants = new Map<string, number[]>();
  clean.forEach((cell) => {
    const key = `${cell.column < CALIBRATION_CHECKER_COLUMNS / 2 ? 'l' : 'r'}${cell.row < CALIBRATION_CHECKER_ROWS / 2 ? 't' : 'b'}`;
    const values = quadrants.get(key) ?? [];
    values.push(cell.stats.high);
    quadrants.set(key, values);
  });
  const quadrantWhites = [...quadrants.values()].map(median);
  const inconsistent =
    quadrantWhites.length === 4 &&
    Math.max(...quadrantWhites) - Math.min(...quadrantWhites) >
      Math.max(18, white * 0.1);
  const headerMismatch =
    headerWhites.length > 0 &&
    Math.abs(median(headerWhites) - median(whiteValues)) >
      Math.max(18, white * 0.1);
  const blackRaised = black > 80;
  const contaminationRatio = 1 - clean.length / Math.max(1, cells.length);
  const cleanRatio = clean.length / Math.max(1, cells.length);
  const dynamicRange = white - black;
  const score =
    Math.abs(white - CALIBRATION_CHECKER_TARGET_WHITE) /
      CALIBRATION_CHECKER_TARGET_WHITE +
    Math.abs(black - CALIBRATION_TARGET_BLACK) / 96 +
    Math.abs(dynamicRange - 196) / 196 +
    Math.max(0, clippedRatio - 0.05) * 2 +
    contaminationRatio * 0.5;
  const usable =
    cleanRatio >= CALIBRATION_CHECKER_MIN_CLEAN_RATIO &&
    contaminationRatio <= CALIBRATION_CHECKER_MAX_CONTAMINATION &&
    dynamicRange >= 70 &&
    !blackRaised &&
    !inconsistent &&
    !headerMismatch;
  const direction =
    white >= 245 || clippedRatio >= 0.25
      ? 'too-bright'
      : white <= 155
        ? 'too-dark'
        : undefined;
  const warnings: string[] = [];
  if (contaminationRatio >= 0.2)
    warnings.push('Part of the checkerboard was excluded as reflection');
  if (inconsistent)
    warnings.push('Checkerboard brightness is inconsistent across the screen');
  if (headerMismatch)
    warnings.push('Header and checkerboard white references disagree');
  if (blackRaised)
    warnings.push('Checkerboard black reference is lifted by reflection');
  if (!usable)
    warnings.push(
      'The full-screen references did not provide enough clean evidence',
    );
  return {
    white,
    black,
    contaminationRatio,
    clippedRatio,
    cleanRatio,
    score,
    direction,
    usable,
    warnings,
  };
}

/**
 * Exposure calibration is defined by the calibration pattern's white sample,
 * not by coverage of that sample in the complete camera frame.
 */
export async function measureCalibrationExposure(
  jpeg: Buffer,
  screens: readonly ImagingScreen[],
): Promise<CalibrationExposureReading> {
  const source = jpegSize(jpeg);
  const image = await decodeRgbFrame(jpeg);
  const full = metricsFromPixels(
    sampleFrame(rgbImageToGray(image), EXPOSURE_WIDTH, EXPOSURE_HEIGHT),
    EXPOSURE_WIDTH,
    EXPOSURE_HEIGHT,
  );
  const screenReadings = screens.flatMap((screen) => {
    if (
      screen.correction.sourceWidth !== source.width ||
      screen.correction.sourceHeight !== source.height
    )
      return [];
    const whitePixels = rgbPixelsToGray(
      samplePerspectiveRgb(
        image,
        screen.correction,
        EXPOSURE_WIDTH,
        EXPOSURE_HEIGHT,
        CALIBRATION_EXPOSURE_REGION,
      ),
    );
    const metrics = metricsFromPixels(
      whitePixels,
      EXPOSURE_WIDTH,
      EXPOSURE_HEIGHT,
    );
    const checker = analyzeChecker(image, screen.correction);
    const ramp = analyzeToneRamp(image, screen.correction, checker);
    const assessment: ExposureCalibrationAssessment = ramp.usable
      ? {
          mode: 'grayscale-ramp',
          score: ramp.score,
          ...(ramp.direction ? { direction: ramp.direction } : {}),
          confidence: clamp(
            1 - ramp.contaminationRatio * 0.7 - (ramp.residual / 255) * 2,
            0.05,
            1,
          ),
          contaminationRatio: ramp.contaminationRatio,
          validToneLevels: ramp.validLevels,
          white: round(ramp.white),
          black: round(ramp.black),
          warnings: ramp.warnings,
        }
      : checker.usable
        ? {
            mode: 'fullscreen-masked',
            score: checker.score,
            ...(checker.direction ? { direction: checker.direction } : {}),
            confidence: clamp(1 - checker.contaminationRatio * 0.75, 0.05, 1),
            contaminationRatio: checker.contaminationRatio,
            validToneLevels: ramp.validLevels,
            white: round(checker.white),
            black: round(checker.black),
            warnings: [...ramp.warnings, ...checker.warnings],
          }
        : {
            mode: 'insufficient',
            score: 1_000,
            confidence: 0,
            contaminationRatio: Math.max(
              ramp.contaminationRatio,
              checker.contaminationRatio,
            ),
            validToneLevels: ramp.validLevels,
            white: round(checker.white),
            black: round(checker.black),
            warnings: [
              ...ramp.warnings,
              ...checker.warnings,
              'Clean exposure references are unavailable',
            ],
          };
    return [
      {
        screenId: screen.screenId,
        metrics,
        assessment,
        pixels: whitePixels,
      },
    ];
  });
  if (!screenReadings.length)
    throw new Error(
      'Exposure calibration requires a corrected calibration-screen region',
    );
  const auto = combineMetrics(
    screenReadings.map((reading) => reading.pixels),
    EXPOSURE_WIDTH,
    EXPOSURE_HEIGHT,
  );
  return {
    roiEnabled: true,
    full,
    auto,
    selected: auto,
    screenReadings: screenReadings.map(
      ({ pixels: _pixels, ...reading }) => reading,
    ),
    updatedAt: Date.now(),
  };
}

async function decodeFocusFrame(jpeg: Buffer): Promise<GrayImage> {
  const { data, info } = await sharp(jpeg, { limitInputPixels: 16_777_216 })
    .rotate()
    .greyscale()
    .resize({
      width: FOCUS_WORK_WIDTH,
      withoutEnlargement: true,
      fit: 'inside',
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  };
}

function focusScreen(image: GrayImage, correction: CameraCorrection) {
  const quad = quadToArray(correction.points);
  const widthPx = Math.hypot(quad[1]!.x - quad[0]!.x, quad[1]!.y - quad[0]!.y);
  const heightPx = Math.hypot(quad[3]!.x - quad[0]!.x, quad[3]!.y - quad[0]!.y);
  const width = FOCUS_SAMPLE_WIDTH;
  const height = clamp(
    Math.round(width * (heightPx / Math.max(1, widthPx))),
    96,
    360,
  );
  const pixels = samplePerspective(image, correction, width, height);
  const tileScores: number[] = [];
  let horizontal = 0;
  let vertical = 0;
  let saturated = 0;
  for (let row = 0; row < FOCUS_TILE_ROWS; row += 1) {
    for (let column = 0; column < FOCUS_TILE_COLUMNS; column += 1) {
      const x0 = Math.floor((column * width) / FOCUS_TILE_COLUMNS);
      const x1 = Math.floor(((column + 1) * width) / FOCUS_TILE_COLUMNS);
      const y0 = Math.floor((row * height) / FOCUS_TILE_ROWS);
      const y1 = Math.floor(((row + 1) * height) / FOCUS_TILE_ROWS);
      let energy = 0;
      let laplacianEnergy = 0;
      let sum = 0;
      let sumSquares = 0;
      let count = 0;
      for (let y = Math.max(1, y0); y < Math.min(height - 1, y1); y += 1) {
        for (let x = Math.max(1, x0); x < Math.min(width - 1, x1); x += 1) {
          const index = y * width + x;
          const value = pixels[index]!;
          const gx = (pixels[index + 1]! - pixels[index - 1]!) / 2;
          const gy = (pixels[index + width]! - pixels[index - width]!) / 2;
          const laplacian =
            4 * value -
            pixels[index - 1]! -
            pixels[index + 1]! -
            pixels[index - width]! -
            pixels[index + width]!;
          energy += gx * gx + gy * gy;
          laplacianEnergy += laplacian * laplacian;
          horizontal += gx * gx;
          vertical += gy * gy;
          sum += value;
          sumSquares += value * value;
          if (value > 245) saturated++;
          count++;
        }
      }
      const localMean = count ? sum / count : 0;
      const localVariance = count
        ? Math.max(0, sumSquares / count - localMean * localMean)
        : 0;
      const localContrast = Math.sqrt(localVariance);
      const tenengrad = count ? Math.sqrt(energy / count) : 0;
      const laplacian = count ? Math.sqrt(laplacianEnergy / count) : 0;
      const contrastWeight = 0.35 + 0.65 * Math.min(1, localContrast / 48);
      tileScores.push((0.7 * tenengrad + 0.3 * laplacian) * contrastWeight);
    }
  }
  const lowerQuartile = percentile(tileScores, 0.25);
  const topBandEnd = FOCUS_TILE_COLUMNS * 3;
  const topBandMean =
    tileScores.slice(0, topBandEnd).reduce((sum, value) => sum + value, 0) /
    Math.max(1, topBandEnd);
  const score =
    0.55 * median(tileScores) + 0.25 * lowerQuartile + 0.2 * topBandMean;
  const anisotropy =
    Math.min(horizontal, vertical) /
    Math.max(1, Math.max(horizontal, vertical));
  return {
    score,
    lowerQuartile,
    anisotropy,
    overExposedRatio: saturated / Math.max(1, width * height),
  };
}

export async function measureFocus(
  jpeg: Buffer,
  screens: readonly ImagingScreen[],
): Promise<FocusReading> {
  const source = jpegSize(jpeg);
  const validScreens = screens.filter(
    (screen) =>
      screen.correction.sourceWidth === source.width &&
      screen.correction.sourceHeight === source.height,
  );
  if (!validScreens.length)
    throw new Error('Focus search requires at least one corrected screen ROI');
  const image = await decodeFocusFrame(jpeg);
  const readings = validScreens.map((screen) => {
    const result = focusScreen(image, screen.correction);
    return {
      screenId: screen.screenId,
      ...result,
      score: result.anisotropy < 0.25 ? result.score * 0.5 : result.score,
    };
  });
  const scores = readings.map((reading) => reading.score);
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const combined =
    scores.length > 1 ? 0.6 * Math.min(...scores) + 0.4 * mean : mean;
  return {
    score: round(combined, 6),
    anisotropy: round(
      Math.min(...readings.map((reading) => reading.anisotropy)),
      4,
    ),
    overExposedRatio: round(
      Math.max(...readings.map((reading) => reading.overExposedRatio)),
      4,
    ),
    screens: readings.map((reading) => ({
      ...reading,
      score: round(reading.score, 6),
      lowerQuartile: round(reading.lowerQuartile, 6),
      anisotropy: round(reading.anisotropy, 4),
      overExposedRatio: round(reading.overExposedRatio, 4),
    })),
  };
}
