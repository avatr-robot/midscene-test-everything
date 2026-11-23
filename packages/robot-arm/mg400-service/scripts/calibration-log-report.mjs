#!/usr/bin/env node
/**
 * Aggregate the workflow's `Automatic sampling timing` lines.
 *
 * Every automatic run logs one line with a JSON payload:
 *   Automatic sampling timing {"attemptId":"...","deviceId":"...","timing":{
 *     "movl":{"count":47,"ms":16400},"phone-confirmation":{"count":43,...},...}}
 *
 * The events are nested on purpose (`movl` contains probe moves and point
 * travel), so this report prints them as recorded and derives a sampling total
 * from the two disjoint buckets: motion (`movl`) and phone confirmations.
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

const attempts = new Map();
for (const file of files) {
  const text = await readFile(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const marker = line.indexOf('Automatic sampling timing ');
    if (marker < 0) continue;
    const start = line.indexOf('{', marker);
    const end = line.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    let payload;
    try {
      payload = JSON.parse(line.slice(start, end + 1));
    } catch {
      continue;
    }
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
if (!rows.length) {
  console.error(
    `No "Automatic sampling timing" lines found in ${files.join(', ')}`,
  );
  process.exit(1);
}

if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

const seconds = (ms) => (ms / 1000).toFixed(1);
const event = (row, name) => row.events[name] ?? { count: 0, ms: 0 };
console.log(
  [
    'attempt',
    'moves',
    'motion s',
    'phone',
    'phone s',
    'travel n',
    'travel s',
    'initial s',
    'sampling s',
  ]
    .map((header) => header.padEnd(12))
    .join(''),
);
for (const row of rows) {
  console.log(
    [
      row.attemptId.slice(0, 10),
      String(row.moves),
      seconds(event(row, 'movl').ms),
      String(row.phoneConfirmations),
      seconds(event(row, 'phone-confirmation').ms),
      String(event(row, 'point-travel').count),
      seconds(event(row, 'point-travel').ms),
      seconds(event(row, 'initial-search').ms),
      seconds(row.samplingMs),
    ]
      .map((cell) => cell.padEnd(12))
      .join(''),
  );
}
const average = (pick) =>
  rows.reduce((total, row) => total + pick(row), 0) / rows.length;
console.log('');
console.log(
  `attempts: ${rows.length}  avg sampling: ${seconds(average((row) => row.samplingMs))} s  ` +
    `avg moves: ${average((row) => row.moves).toFixed(1)}  ` +
    `avg phone confirmations: ${average((row) => row.phoneConfirmations).toFixed(1)}`,
);
