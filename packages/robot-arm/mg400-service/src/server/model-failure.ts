import { RobotArmError } from '@midscene/arm-kit';

/** Why one model call did not produce a usable answer. */
export type ModelFailureReason =
  | 'timeout'
  | 'network'
  | 'auth'
  | 'not-found'
  | 'rate-limit'
  | 'request'
  | 'service'
  | 'response'
  | 'unknown';

/**
 * One actionable sentence per cause. Each string is a translation key, so the
 * operator sees the same wording in the queue, the plan dialog and the preview.
 */
const MESSAGES: Record<ModelFailureReason, string> = {
  timeout: 'The model did not answer in time. Check the network and retry.',
  network:
    'Could not reach the model endpoint. Check the network and proxy settings.',
  auth: 'The model rejected the API key. Check the model settings.',
  'not-found':
    'The model endpoint or model name was not found. Check the model settings.',
  'rate-limit': 'The model is rate limited. Wait a moment and retry.',
  request: 'The model rejected the request. Check that it supports two images.',
  service: 'The model service failed. Retry later.',
  response:
    'The model did not return usable JSON. Check that it supports vision JSON output.',
  unknown:
    'The side-view model did not return a usable observation. Check model settings and try again.',
};

/** Retrying a rejected key or a wrong model name only wastes time. */
const RETRYABLE = new Set<ModelFailureReason>([
  'timeout',
  'network',
  'rate-limit',
  'service',
  'response',
  'unknown',
]);

export interface ModelFailure {
  reason: ModelFailureReason;
  message: string;
  retryable: boolean;
  /** Technical text for logs and the preview; never shown as the main line. */
  detail: string;
}

export function classifyModelFailure(error: unknown): ModelFailure {
  const detail = error instanceof Error ? error.message : String(error);
  const reason = reasonOf(detail);
  return {
    reason,
    message: MESSAGES[reason],
    retryable: RETRYABLE.has(reason),
    detail,
  };
}

/** Wrap a failed model call in the one error shape the batch already handles. */
export function modelFailure(error: unknown) {
  const failure = classifyModelFailure(error);
  return new RobotArmError('VISION_UNAVAILABLE', failure.message, 409, {
    modelFailure: failure.reason,
    modelFailureDetail: failure.detail,
  });
}

function reasonOf(detail: string): ModelFailureReason {
  // A timed-out request surfaces as an abort wrapped by the transport message.
  if (/abort|timed? ?out/i.test(detail)) return 'timeout';
  if (/Could not reach the VLM endpoint/i.test(detail)) return 'network';
  const status = /\(HTTP (\d{3})\)/.exec(detail)?.[1];
  if (status) {
    const code = Number(status);
    if (code === 401 || code === 403) return 'auth';
    if (code === 404) return 'not-found';
    if (code === 408) return 'timeout';
    if (code === 429) return 'rate-limit';
    if (code >= 500) return 'service';
    if (code >= 400) return 'request';
  }
  if (/base URL must use HTTP/i.test(detail)) return 'request';
  if (
    /did not contain readable text|did not contain a JSON object|was not a JSON object|response was empty|not valid JSON|did not assign both camera IDs/i.test(
      detail,
    )
  )
    return 'response';
  return 'unknown';
}
