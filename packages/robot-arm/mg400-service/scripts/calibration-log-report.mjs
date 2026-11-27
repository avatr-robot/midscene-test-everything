#!/usr/bin/env node
/**
 * Aggregate the two per-attempt timing lines the calibration workflow writes.
 *
 * Sampling (one line per attempt):
 *   Automatic sampling timing {"attemptId":"...","deviceId":"...","timing":{
 *     "movl":{"count":47,"ms":16400},"phone-confirmation":{"count":43,...},...}}
 *
 * Reference positioning (one line per search):
 *   Reference positioning timing {"attemptId":"...","bootstrap":true,"ok":true,
 *     "totalMs":85700,"markerWaitMs":8000,
 *     "timing":{"observe":{"count":17,"ms":71800},"verify":{...},...},
 *     "servo":{"steps":13,"probeSteps":2,"servoSteps":11,"moveMs":8321,...},
 *     "steps":[{"index":1,"kind":"probe-x","moveMs":600,"observeMs":6455,...}]}
 *
 * The sampling events are nested on purpose (`movl` contains probe moves and
 * point travel), so this report prints them as recorded and derives a sampling
 * total from the two disjoint buckets: motion (`movl`) and phone confirmations.
 * Reference positioning is reported separately: its `verify` bucket is the
 * model round trip that dominates the search, and `capture` is the camera work
 * around it. A failed search keeps the line and adds `ok:false` with `failure`.
 *
 * Usage:
 *   node scripts/calibration-log-report.mjs <log file> [more logs...]
 *   node scripts/calibration-log-report.mjs --json <log file>
 */
import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const files = args.filter((argument) => !argument.startsWith('--'));
if (!files.length) {
  console.error(
    'Usage: node scripts/calibration-log-report.mjs [--json] <log file>...',
  );
  process.exit(2);
}

/** Two disjoint buckets; every other event is nested inside one of them. */
const SAMPLING_EVENTS = ['movl', 'phone-confirmation'];
const SAMPLING_MARKER = 'Automatic sampling timing ';
const REFERENCE_MARKER = 'Reference positioning timing ';

/** Reads the JSON object that follows a log marker on one line. */
function payloadAfter(line, marker) {
  const start = line.indexOf('{', line.indexOf(marker));
  const end = line.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(line.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

const attempts = new Map();
const references = new Map();
for (const file of files) {
  const text = await readFile(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (line.includes(SAMPLING_MARKER)) {
      const payload = payloadAfter(line, SAMPLING_MARKER);
      if (!payload?.attemptId || !payload.timing) continue;
      const existing = attempts.get(payload.attemptId) ?? {
        attemptId: payload.attemptId,
        deviceId: payload.deviceId,
        source: file,
        events: {},
      };
      for (const [event, reading] of Object.entries(payload.timing)) {
        const entry = existing.events[event] ?? { count: 0, ms: 0 };
        entry.count += Number(reading?.count) || 0;
        entry.ms += Number(reading?.ms) || 0;
        existing.events[event] = entry;
      }
      attempts.set(payload.attemptId, existing);
      continue;
    }
    if (line.includes(REFERENCE_MARKER)) {
      const payload = payloadAfter(line, REFERENCE_MARKER);
      if (!payload?.attemptId) continue;
      // One search per attempt; a retry rewrites the reading.
      references.set(payload.attemptId, {
        attemptId: payload.attemptId,
        deviceId: payload.deviceId,
        bootstrap: payload.bootstrap === true,
        ok: payload.ok !== false,
        failure: payload.failure,
        source: file,
        totalMs: Number(payload.totalMs) || 0,
        markerWaitMs: Number(payload.markerWaitMs) || 0,
        timing: payload.timing ?? {},
        servo: payload.servo ?? {},
        steps: Array.isArray(payload.steps) ? payload.steps : [],
      });
    }
  }
}

const rows = [...attempts.values()].map((attempt) => {
  const samplingMs = SAMPLING_EVENTS.reduce(
    (total, event) => total + (attempt.events[event]?.ms ?? 0),
    0,
  );
  return {
    ...attempt,
    samplingMs,
    moves: attempt.events.movl?.count ?? 0,
    phoneConfirmations: attempt.events['phone-confirmation']?.count ?? 0,
  };
});
const referenceRows = [...references.values()].map((reference) => ({
  ...reference,
  observeMs: reference.timing.observe?.ms ?? 0,
  verifyMs: reference.timing.verify?.ms ?? 0,
  captureMs: reference.timing.capture?.ms ?? 0,
}));
if (!rows.length && !referenceRows.length) {
  console.error(`No calibration timing lines found in ${files.join(', ')}`);
  process.exit(1);
}

if (asJson) {
  console.log(
    JSON.stringify({ sampling: rows, reference: referenceRows }, null, 2),
  );
  process.exit(0);
}

const seconds = (ms) => (ms / 1000).toFixed(1);
const event = (row, name) => row.events[name] ?? { count: 0, ms: 0 };
const row = (cells) => cells.map((cell) => String(cell).padEnd(12)).join('');
const average = (values) =>
  values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;

if (rows.length) {
  console.log(
    row([
      'attempt',
      'moves',
      'motion s',
      'phone',
      'phone s',
      'travel n',
      'travel s',
      'initial s',
      'sampling s',
    ]),
  );
  for (const attempt of rows) {
    console.log(
      row([
        attempt.attemptId.slice(0, 10),
        attempt.moves,
        seconds(event(attempt, 'movl').ms),
        attempt.phoneConfirmations,
        seconds(event(attempt, 'phone-confirmation').ms),
        event(attempt, 'point-travel').count,
        seconds(event(attempt, 'point-travel').ms),
        seconds(event(attempt, 'initial-search').ms),
        seconds(attempt.samplingMs),
      ]),
    );
  }
  console.log('');
  console.log(
    `attempts: ${rows.length}  avg sampling: ${seconds(average(rows.map((attempt) => attempt.samplingMs)))} s  ` +
      `avg moves: ${average(rows.map((attempt) => attempt.moves)).toFixed(1)}  ` +
      `avg phone confirmations: ${average(rows.map((attempt) => attempt.phoneConfirmations)).toFixed(1)}`,
  );
}

if (referenceRows.length) {
  if (rows.length) console.log('');
  console.log('reference positioning (one search per attempt)');
  console.log(
    row([
      'attempt',
      'bootstrap',
      'steps',
      'probe',
      'servo',
      'motion s',
      'observe s',
      'model s',
      'frame s',
      'markers s',
      'total s',
    ]),
  );
  for (const reference of referenceRows) {
    console.log(
      row([
        reference.attemptId.slice(0, 10),
        reference.ok ? (reference.bootstrap ? 'yes' : 'no') : 'FAILED',
        reference.servo.steps ?? reference.steps.length,
        reference.servo.probeSteps ?? 0,
        reference.servo.servoSteps ?? 0,
        seconds(reference.servo.moveMs ?? 0),
        seconds(reference.observeMs),
        seconds(reference.verifyMs),
        seconds(reference.captureMs),
        seconds(reference.markerWaitMs),
        seconds(reference.totalMs),
      ]),
    );
    if (!reference.ok && reference.failure)
      console.log(`  ! ${reference.failure}`);
  }
  const perStep = (pick) =>
    referenceRows.flatMap((reference) =>
      reference.steps.map((step) => Number(step[pick]) || 0),
    );
  const servoSteps = perStep('observeMs');
  console.log('');
  console.log(
    `searches: ${referenceRows.length}  ` +
      `avg observe/step: ${seconds(average(servoSteps))} s  ` +
      `avg motion/step: ${Math.round(average(perStep('moveMs')))} ms  ` +
      `avg total: ${seconds(average(referenceRows.map((reference) => reference.totalMs)))} s`,
  );
}
