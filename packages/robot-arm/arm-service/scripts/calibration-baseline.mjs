#!/usr/bin/env node
/**
 * Summarize the fast-mode calibration evidence already stored in a profile
 * store, and derive the historical warning band used by the speed plan
 * (docs/screen-calibration-speedup-plan.md, section 1.1).
 *
 * Usage:
 *   node scripts/calibration-baseline.mjs
 *   node scripts/calibration-baseline.mjs --profiles <profiles.json> --out <baseline.json>
 *
 * The script only reads. It never writes into the store.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const profilesPath = path.resolve(
  option(
    '--profiles',
    path.join(
      here,
      '..',
      '.midscene',
      'arm-kit',
      'installations',
      'mg400',
      'profiles.json',
    ),
  ),
);
const outPath = option('--out');
const asJson = args.includes('--json');

/** Gate values from the fast exploration path (sampler.ts / surface.ts). */
const GATES = {
  planeRmseMm: 0.5,
  holdoutHeightMm: 1.5,
  tiltDeg: 5,
  heightRangeMm: 6,
};
/** Relaxed band used to compare a new run against the historical population. */
const TOLERANCE = { mean: 0.1, max: 0.2 };

const data = JSON.parse(await readFile(profilesPath, 'utf8'));
const robots = (data.robots ?? []).map((robot) => ({
  id: robot.id,
  adapterId: robot.adapterId,
  connectionIdentity: robot.connectionIdentity,
}));
const records = (data.calibrations ?? [])
  .filter(
    (calibration) => calibration.verification?.auto?.tiltDeg !== undefined,
  )
  .map((calibration) => {
    const auto = calibration.verification.auto;
    return {
      id: calibration.id,
      createdAt: calibration.createdAt,
      screenProfileId: calibration.screenProfileId,
      samples: Array.isArray(auto.samples) ? auto.samples.length : 0,
      planeRmseMm: auto.planeRmseMm,
      holdoutHeightMm: auto.holdoutHeightMm,
      validationMaxMm: auto.validationMaxMm,
      validationHeightMaxMm: auto.validationHeightMaxMm,
      gridRmsMm: auto.gridRmsMm,
      tiltDeg: auto.tiltDeg,
      heightRangeMm: auto.heightRangeMm,
      surfaceMaxMm: auto.surfaceMaxMm,
      coverage: auto.coverage,
    };
  });

if (!records.length) {
  console.error(`No fast-mode calibration evidence found in ${profilesPath}`);
  process.exit(1);
}

const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  const p90 =
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  return {
    n: sorted.length,
    mean: sum / sorted.length,
    min: sorted[0],
    max: sorted.at(-1),
    p90,
  };
};
const metrics = {};
for (const key of Object.keys(GATES)) {
  const values = records
    .map((record) => record[key])
    .filter((value) => Number.isFinite(value));
  metrics[key] = {
    ...stats(values),
    gate: GATES[key],
    band: {
      meanUpper: stats(values).mean + TOLERANCE.mean,
      maxUpper: stats(values).max + TOLERANCE.max,
    },
    overGate: values.filter((value) => value > GATES[key]).length,
  };
}
const screens = new Set(records.map((record) => record.screenProfileId));
const summary = {
  source: profilesPath,
  generatedAt: new Date().toISOString(),
  robots,
  count: records.length,
  screens: screens.size,
  tolerance: TOLERANCE,
  metrics,
  records,
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const ids = robots.map((robot) => robot.connectionIdentity).join(', ');
  console.log(`Source: ${profilesPath}`);
  console.log(`Robot:  ${ids || '(none)'}`);
  console.log(
    `Records: ${records.length} fast-mode calibrations over ${screens.size} screen profile(s)`,
  );
  console.log('');
  console.log(
    ['metric', 'n', 'mean', 'max', 'gate', 'over', 'mean+0.1', 'max+0.2']
      .map((header) => header.padEnd(16))
      .join(''),
  );
  for (const [key, value] of Object.entries(metrics))
    console.log(
      [
        key,
        String(value.n),
        value.mean.toFixed(3),
        value.max.toFixed(3),
        String(value.gate),
        String(value.overGate),
        value.band.meanUpper.toFixed(3),
        value.band.maxUpper.toFixed(3),
      ]
        .map((cell) => cell.padEnd(16))
        .join(''),
    );
}
if (outPath) {
  await writeFile(
    path.resolve(outPath),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );
  console.log(`\nWrote ${path.resolve(outPath)}`);
}
