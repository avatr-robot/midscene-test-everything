import { getDebug } from '@midscene/shared/logger';
import type { VisionTrace } from './viewpoint-classifier.js';

/**
 * Model round trips for reference positioning are the bulk of what the search
 * waits on, so they go to the calibration workflow's log file. The scope names
 * the attempt, which is the key on the `Reference positioning timing` line.
 */
const writeTrace = getDebug('robot-arm:web-calibration');

export function logReferenceModelTrace(scope: string, trace: VisionTrace) {
  const parts = [
    `[reference-model] ${scope}`,
    `model=${trace.model}`,
    `endpoint=${trace.endpoint}`,
    `duration=${trace.durationMs}ms`,
  ];
  if (trace.status !== undefined) parts.push(`status=${trace.status}`);
  if (trace.finishReason) parts.push(`finish=${trace.finishReason}`);
  if (trace.responseChars !== undefined)
    parts.push(`chars=${trace.responseChars}`);
  if (trace.error) {
    const error = trace.error.replace(/\s+/g, ' ').slice(0, 300);
    parts.push(`error=${error}`);
  }
  const line = parts.join(' ');
  writeTrace(line);
  // Keep the terminal echo the service had before the line also hit the file.
  if (trace.error) console.warn(line);
  else console.info(line);
}
