#!/usr/bin/env node
/**
 * Summarize automatic-calibration evidence from a profile store and derive the
 * historical warning band used by docs/screen-calibration-speedup-plan.md.
 *
 * The store is read-only. Gates (hard per-run limits) come from the sampler and
 * surface code; the band (mean +0.1 mm, max +0.2 mm) is a batch rule: it says
 * whether a *population* of runs drifted, not whether one run is acceptable.
 *
 * Usage:
 *   node scripts/calibration-baseline.mjs
 *   node scripts/calibration-baseline.mjs --mode fast --out docs/calibration-baseline.json
 *   node scripts/calibration-baseline.mjs --check docs/calibration-baseline.json
 *
 * `--check` evaluates every record newer than the baseline file against the
 * per-run gates and the batch band. It exits 1 on a gate violation or a batch
 * mean outside the band, 0 otherwise.
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
const flag = (name) => args.includes(name);

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
const checkPath = option('--check');
const modeFilter = option('--mode', 'all');
const asJson = flag('--json');

/** Hard per-run limits enforced by the sampler, surface code and acceptance. */
const GATES = {
  planeRmseMm: 0.5,
  holdoutHeightMm: 1.5,
  tiltDeg: 5,
  heightRangeMm: 6,
  validationHeightMaxMm: 1.5,
  surfaceMaxMm: 3,
};
/** Relaxed band for comparing a batch against the historical population. */
const TOLERANCE = { mean: 0.1, max: 0.2 };

const data = JSON.parse(await readFile(profilesPath, 'utf8'));
const robots = (data.robots ?? []).map((robot) => ({
  id: robot.id,
  adapterId: robot.adapterId,
  connectionIdentity: robot.connectionIdentity,
}));
const allRecords = (data.calibrations ?? [])
  .filter((calibration) => calibration.verification?.auto)
  .map((calibration) => {
    const auto = calibration.verification.auto;
    return {
      id: calibration.id,
      createdAt: calibration.createdAt,
      screenProfileId: calibration.screenProfileId,
      // Records created before this field existed cannot be attributed.
      samplingMode: auto.samplingMode ?? 'unknown',
      planeSource: auto.planeSource,
      samples: Array.isArray(auto.samples) ? auto.samples.length : 0,
      measuredPlaneSamples: auto.measuredPlaneSamples,
      predictedSamples: auto.predictedSamples,
      predictedFraction: auto.predictedFraction,
      predictionInInterval: auto.independentHeightCheck?.predictionInInterval,
      planeRmseMm: auto.planeRmseMm,
      holdoutHeightMm: auto.holdoutHeightMm,
      tiltDeg: auto.tiltDeg,
      heightRangeMm: auto.heightRangeMm,
      validationMaxMm: auto.validationMaxMm,
      validationHeightMaxMm: auto.validationHeightMaxMm,
      gridRmsMm: auto.gridRmsMm,
      surfaceMaxMm: auto.surfaceMaxMm,
      coverage: auto.coverage,
    };
  });
const records = allRecords.filter(
  (record) => modeFilter === 'all' || record.samplingMode === modeFilter,
);
if (!records.length) {
  console.error(
    `No calibration evidence found in ${profilesPath}${
      modeFilter === 'all' ? '' : ` for mode "${modeFilter}"`
    }`,
  );
  process.exit(1);
}

const stats = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
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

const summarize = (groupRecords) => {
  const metrics = {};
  for (const key of Object.keys(GATES)) {
    const values = groupRecords
      .map((record) => record[key])
      .filter((value) => Number.isFinite(value));
    if (!values.length) continue;
    const summary = stats(values);
    metrics[key] = {
      ...summary,
      gate: GATES[key],
      band: {
        meanUpper: summary.mean + TOLERANCE.mean,
        maxUpper: summary.max + TOLERANCE.max,
      },
      overGate: values.filter((value) => value > GATES[key]).length,
    };
  }
  const predictionSamples = groupRecords.filter(
    (record) => record.predictionInInterval !== undefined,
  );
  return {
    count: groupRecords.length,
    screens: new Set(groupRecords.map((record) => record.screenProfileId)).size,
    modes: [...new Set(groupRecords.map((record) => record.samplingMode))],
    predictionInInterval: {
      checked: predictionSamples.length,
      true: predictionSamples.filter(
        (record) => record.predictionInInterval === true,
      ).length,
    },
    metrics,
    records: groupRecords,
  };
};

const modes = [...new Set(records.map((record) => record.samplingMode))];
const summary = {
  source: profilesPath,
  generatedAt: new Date().toISOString(),
  robots,
  tolerance: TOLERANCE,
  gates: GATES,
  modes: Object.fromEntries(
    modes.map((mode) => [
      mode,
      summarize(records.filter((record) => record.samplingMode === mode)),
    ]),
  ),
};

if (checkPath) {
  const baseline = JSON.parse(await readFile(path.resolve(checkPath), 'utf8'));
  const mode = modeFilter === 'all' ? modes[0] : modeFilter;
  const expected = baseline.modes?.[mode];
  if (!expected) {
    console.error(
      `Baseline ${checkPath} has no mode "${mode}" (found: ${
        Object.keys(baseline.modes ?? {}).join(', ') || 'none'
      })`,
    );
    process.exit(2);
  }
  const since = Date.parse(baseline.generatedAt);
  const fresh = allRecords.filter(
    (record) =>
      record.samplingMode === mode &&
      (!Number.isFinite(since) || Date.parse(record.createdAt) > since),
  );
  if (!fresh.length) {
    console.log(
      `No ${mode} calibration recorded after ${baseline.generatedAt}; run a normal calibration first.`,
    );
    process.exit(0);
  }
  const failures = [];
  for (const record of fresh) {
    for (const [key, gate] of Object.entries(GATES)) {
      const value = record[key];
      if (Number.isFinite(value) && value > gate)
        failures.push(
          `${record.id}: ${key} ${value.toFixed(3)} > gate ${gate}`,
        );
    }
  }
  for (const [key, metric] of Object.entries(expected.metrics)) {
    const values = fresh
      .map((record) => record[key])
      .filter((value) => Number.isFinite(value));
    if (!values.length) continue;
    for (const value of values)
      if (value > metric.band.maxUpper)
        failures.push(
          `${key} ${value.toFixed(3)} above band max ${metric.band.maxUpper.toFixed(3)}`,
        );
    if (values.length >= 3) {
      const mean =
        values.reduce((total, value) => total + value, 0) / values.length;
      if (mean > metric.band.meanUpper)
        failures.push(
          `${key} mean ${mean.toFixed(3)} above band mean ${metric.band.meanUpper.toFixed(3)}`,
        );
    }
  }
  console.log(
    `Checked ${fresh.length} ${mode} run(s) against ${checkPath} (generated ${baseline.generatedAt})`,
  );
  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exit(1);
  }
  console.log('OK: per-run gates and batch band hold');
  process.exit(0);
}

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const ids = robots.map((robot) => robot.connectionIdentity).join(', ');
  console.log(`Source: ${profilesPath}`);
  console.log(`Robot:  ${ids || '(none)'}`);
  for (const [mode, group] of Object.entries(summary.modes)) {
    console.log('');
    console.log(
      `[${mode}] ${group.count} calibration(s) over ${group.screens} screen profile(s)`,
    );
    console.log(
      `  predictionInInterval: ${group.predictionInInterval.true}/${group.predictionInInterval.checked} checked`,
    );
    console.log(
      ['metric', 'n', 'mean', 'max', 'gate', 'over', 'mean+0.1', 'max+0.2']
        .map((header) => header.padEnd(22))
        .join(''),
    );
    for (const [key, value] of Object.entries(group.metrics))
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
          .map((cell) => cell.padEnd(22))
          .join(''),
      );
  }
  if (modes.includes('unknown'))
    console.log(
      '\nNote: "unknown" records predate evidence.samplingMode; they cannot be used as a fast-horizontal baseline.',
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
