import sharp from 'sharp';
import type { SideScreenRegion } from '../assisted-contracts.js';
import { RobotArmError } from '../contracts.js';
import { visibilityPixelResponse } from './screen-visibility.js';

const CELL_SIZE = 5;

export async function markVisibilityRegion(
  jpeg: Buffer,
  region: SideScreenRegion,
) {
  const image = sharp(jpeg);
  const { width, height } = await image.metadata();
  if (
    !width ||
    !height ||
    Math.abs(
      (width * region.sourceHeight) / (height * region.sourceWidth) - 1,
    ) > 0.02
  )
    throw new RobotArmError(
      'VISION_UNAVAILABLE',
      'The eye-level frame no longer matches the screen association.',
      409,
    );
  const sx = width / region.sourceWidth;
  const sy = height / region.sourceHeight;
  const outline = Buffer.from(
    `<svg width="${width}" height="${height}"><rect x="${region.left * sx}" y="${region.top * sy}" width="${(region.right - region.left) * sx}" height="${(region.bottom - region.top) * sy}" fill="none" stroke="#ffbf00" stroke-width="${Math.max(2, Math.round(width / 400))}"/></svg>`,
  );
  return image
    .composite([{ input: outline }])
    .jpeg()
    .toBuffer();
}

/** Locate a visible part of one changing display in a camera with no saved quad. */
export async function findVisibilityRegion(
  frames: readonly [Buffer, Buffer, Buffer],
) {
  const decoded = await Promise.all(
    frames.map((frame) =>
      sharp(frame)
        .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true }),
    ),
  );
  const { width, height } = decoded[0].info;
  if (
    decoded.some(
      ({ info }) =>
        info.width !== width || info.height !== height || info.channels !== 3,
    )
  )
    throw new RobotArmError(
      'VISION_UNAVAILABLE',
      'Camera dimensions changed during screen association.',
      409,
    );

  const columns = Math.ceil(width / CELL_SIZE);
  const rows = Math.ceil(height / CELL_SIZE);
  const positive = new Uint16Array(columns * rows);
  const negative = new Uint16Array(columns * rows);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const response = visibilityPixelResponse(decoded, (y * width + x) * 3);
      const cell =
        Math.floor(y / CELL_SIZE) * columns + Math.floor(x / CELL_SIZE);
      if (response === 1) positive[cell]++;
      if (response === -1) negative[cell]++;
    }
  }

  // Group adjacent responding cells. Both directions of the colour change
  // must be present in the same region to reject uniform exposure shifts.
  const visited = new Uint8Array(columns * rows);
  const candidates = [];
  const responds = (cell: number) => positive[cell] + negative[cell] >= 5;
  for (let start = 0; start < visited.length; start++) {
    if (visited[start] || !responds(start)) continue;
    const cells = [start];
    visited[start] = 1;
    let minX = columns;
    let minY = rows;
    let maxX = 0;
    let maxY = 0;
    let rising = 0;
    let falling = 0;
    for (const cell of cells) {
      const x = cell % columns;
      const y = Math.floor(cell / columns);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      rising += positive[cell];
      falling += negative[cell];
      for (
        let row = Math.max(0, y - 1);
        row <= Math.min(rows - 1, y + 1);
        row++
      ) {
        for (
          let col = Math.max(0, x - 1);
          col <= Math.min(columns - 1, x + 1);
          col++
        ) {
          const next = row * columns + col;
          if (visited[next] || !responds(next)) continue;
          visited[next] = 1;
          cells.push(next);
        }
      }
    }
    const score = rising + falling;
    const boxCells = (maxX - minX + 1) * (maxY - minY + 1);
    if (
      score < 90 ||
      Math.min(rising, falling) < score * 0.15 ||
      cells.length < boxCells * 0.25 ||
      boxCells > visited.length * 0.55
    )
      continue;
    candidates.push({
      score,
      region: {
        sourceWidth: width,
        sourceHeight: height,
        left: minX * CELL_SIZE,
        top: minY * CELL_SIZE,
        right: Math.min(width - 1, (maxX + 1) * CELL_SIZE),
        bottom: Math.min(height - 1, (maxY + 1) * CELL_SIZE),
      },
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const [best, alternate] = candidates;
  if (!best) return { status: 'side-not-visible' } as const;
  if (alternate && alternate.score >= best.score * 0.35)
    return { status: 'ambiguous' } as const;
  return { status: 'associated', region: best.region } as const;
}
