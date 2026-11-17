#!/usr/bin/env node
/**
 * Read the calibration logs and print the per-screen time budget that the
 * speed plan (docs/screen-calibration-speedup-plan.md, section 3) is based on.
 *
 * Usage:
 *   node scripts/calibration-log-report.mjs
 *   node scripts/calibration-log-report.mjs --log <dir>
 *
 * The logs are util.inspect output, not JSON, so the few fields we need are
 * extracted with line-oriented regular expressions. Nothing is written.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const logDir = path.resolve(
  option('--log', path.join(here, '..', 'midscene_run', 'log')),
);

async function readIfPresent(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}

/** Collect the body of each `prefix { ... }` block up to the first `}` line. */
function blocks(text, prefix) {
  const found = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].includes(`${prefix} {`)) continue;
    const body = [];
    for (index++; index < lines.length; index++) {
      if (lines[index].trim() === '}') break;
      body.push(lines[index]);
    }
    found.push(body.join('\n'));
  }
  return found;
}

const field = (body, name) => {
  const match = new RegExp(`${name}:\\s*([^,\\n]+)`).exec(body);
  return match ? match[1].trim().replace(/^'|'$/g, '') : undefined;
};
const numberField = (body, name) => {
  const value = field(body, name);
  const parsed = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const timingEntries = (body) => {
  const entries = new Map();
  for (const line of body.split('\n')) {
    const match =
      /'?([\w-]+)'?:\s*\{\s*count:\s*(\d+),\s*ms:\s*([\d.e+-]+)/.exec(line);
    if (match)
      entries.set(match[1], {
        count: Number(match[2]),
        ms: Number(match[3]),
      });
  }
  return entries;
};

const batchLog = await readIfPresent(
  path.join(logDir, 'robot-arm-calibration-batch.log'),
);
const samplingLog = await readIfPresent(
  path.join(logDir, 'robot-arm-web-calibration.log'),
);
const sampling = new Map(
  blocks(samplingLog, 'Fast batch sampling').flatMap((body) => {
    const attemptId = field(body, 'attemptId');
    return attemptId ? [[attemptId, timingEntries(body)]] : [];
  }),
);

const short = (id) =>
  !id ? '-' : id.startsWith('dshow:') ? 'camera' : id.slice(0, 8);
const secs = (value) =>
  value === undefined ? '-' : `${(value / 1000).toFixed(1)}s`;

const stageOrder = [
  'movl',
  'phone-confirmation',
  'probe-move',
  'point-travel',
  'initial-search',
];
const rows = blocks(batchLog, 'Fast batch screen').map((body) => {
  const attemptId = field(body, 'attemptId');
  const timing = attemptId ? sampling.get(attemptId) : undefined;
  const totalMs = numberField(body, 'totalMs');
  const moveMs = timing?.get('movl')?.ms;
  const observeMs = timing?.get('phone-confirmation')?.ms;
  return {
    device: short(field(body, 'deviceId')),
    status: field(body, 'status') ?? '-',
    totalMs,
    moves: timing?.get('movl')?.count,
    moveMs,
    observations: timing?.get('phone-confirmation')?.count,
    observeMs,
    restMs:
      totalMs !== undefined && moveMs !== undefined && observeMs !== undefined
        ? totalMs - moveMs - observeMs
        : undefined,
  };
});

console.log(`Logs: ${logDir}`);
if (!rows.length) {
  console.log('No `Fast batch screen` blocks found.');
} else {
  const header = [
    'device',
    'status',
    'total',
    'moves',
    'move',
    'observe',
    'n',
    'other',
  ];
  console.log(header.map((text) => text.padEnd(11)).join(''));
  for (const row of rows)
    console.log(
      [
        row.device,
        row.status,
        secs(row.totalMs),
        row.moves ?? '-',
        secs(row.moveMs),
        secs(row.observeMs),
        row.observations ?? '-',
        secs(row.restMs),
      ]
        .map((text) => String(text).padEnd(11))
        .join(''),
    );

  const complete = rows.filter(
    (row) =>
      row.totalMs && row.moveMs !== undefined && row.observeMs !== undefined,
  );
  if (complete.length) {
    const total = complete.reduce((sum, row) => sum + row.totalMs, 0);
    const move = complete.reduce((sum, row) => sum + row.moveMs, 0);
    const observe = complete.reduce((sum, row) => sum + row.observeMs, 0);
    console.log(
      `\nAttempts with timing (${complete.length}): ${(total / 1000).toFixed(1)}s; ` +
        `moves ${((move / total) * 100).toFixed(0)}%, ` +
        `observations ${((observe / total) * 100).toFixed(0)}%, ` +
        `other ${(((total - move - observe) / total) * 100).toFixed(0)}%.`,
    );
  }

  const events = new Map();
  for (const timing of sampling.values())
    for (const [name, entry] of timing) {
      const previous = events.get(name) ?? { count: 0, ms: 0 };
      events.set(name, {
        count: previous.count + entry.count,
        ms: previous.ms + entry.ms,
      });
    }
  if (events.size) {
    console.log('\nTiming buckets (all attempts):');
    const rank = (name) => {
      const index = stageOrder.indexOf(name);
      return index >= 0 ? index : stageOrder.length;
    };
    const ordered = [...events.entries()].sort(
      (a, b) => rank(a[0]) - rank(b[0]) || b[1].ms - a[1].ms,
    );
    for (const [name, entry] of ordered)
      console.log(
        `  ${name.padEnd(28)} ${String(entry.count).padStart(5)}  ${secs(entry.ms).padStart(8)}${entry.count ? `  ${(entry.ms / entry.count).toFixed(0).padStart(5)} ms/each` : ''}`,
      );
  }
}
