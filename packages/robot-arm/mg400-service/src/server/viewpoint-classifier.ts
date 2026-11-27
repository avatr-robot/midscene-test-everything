import { RobotArmError } from '@midscene/arm-kit';

export interface ViewpointModelConfig {
  provider: string;
  modelName: string;
  modelFamily: string;
  baseUrl: string;
  apiKey: string;
}

export function requireViewpointModel(value: unknown): ViewpointModelConfig {
  if (
    !value ||
    typeof value !== 'object' ||
    !(
      ['provider', 'modelName', 'modelFamily', 'baseUrl', 'apiKey'] as const
    ).every((key) => {
      const field = (value as Partial<ViewpointModelConfig>)[key];
      return typeof field === 'string' && field.trim();
    })
  )
    throw new RobotArmError(
      'VISION_UNAVAILABLE',
      'Complete the VLM model settings first.',
      409,
    );
  return value as ViewpointModelConfig;
}

export interface ViewpointFrame {
  cameraId: string;
  jpeg: Buffer;
}

export interface CameraViewpointClassification {
  overheadCameraId: string;
  eyeLevelCameraId: string;
  confidence: number;
  reason?: string;
}

type FetchLike = typeof fetch;
const execFileAsync = promisify(execFile);
let dispatcherPromise: Promise<ProxyAgent | undefined> | undefined;

export async function classifyCameraViewpoints({
  frames,
  model,
  fetchImpl = fetch,
  onTrace,
}: {
  frames: readonly ViewpointFrame[];
  model: ViewpointModelConfig;
  fetchImpl?: FetchLike;
  onTrace?: (trace: VisionTrace) => void;
}): Promise<CameraViewpointClassification> {
  if (
    frames.length !== 2 ||
    new Set(frames.map((frame) => frame.cameraId)).size !== 2
  )
    throw new Error('Exactly two distinct camera frames are required');
  const source = await requestVisionText({
    frames,
    prompt: viewpointPrompt(frames),
    model,
    fetchImpl,
    onTrace,
  });
  return parseViewpointClassification(
    source,
    frames.map((frame) => frame.cameraId),
  );
}

export interface VisionTrace {
  model: string;
  endpoint: string;
  status?: number;
  durationMs: number;
  finishReason?: string;
  responseChars?: number;
  error?: string;
}

export async function requestVisionText({
  frames,
  prompt,
  model,
  signal = AbortSignal.timeout(45_000),
  fetchImpl = fetch,
  jsonMode = false,
  maxTokens = 800,
  onTrace,
}: {
  frames: readonly Pick<ViewpointFrame, 'jpeg'>[];
  prompt: string;
  model: ViewpointModelConfig;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  /** Ask OpenAI-compatible chat endpoints for one bare JSON object. */
  jsonMode?: boolean;
  /** Visible output budget; reasoning models spend it before the answer. */
  maxTokens?: number;
  onTrace?: (trace: VisionTrace) => void;
}): Promise<string> {
  const baseUrl = new URL(model.baseUrl);
  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:')
    throw new Error('The model base URL must use HTTP or HTTPS');

  const isAnthropic =
    model.provider.toLowerCase().includes('anthropic') ||
    baseUrl.hostname === 'api.anthropic.com';
  const isOpenAIResponses =
    !isAnthropic &&
    /^gpt-/i.test(model.modelFamily) &&
    (model.provider.toLowerCase().includes('openai') ||
      baseUrl.hostname === 'api.openai.com');
  const endpoint = `${baseUrl.toString().replace(/\/+$/, '')}${
    isAnthropic
      ? '/messages'
      : isOpenAIResponses
        ? '/responses'
        : '/chat/completions'
  }`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const body = ({
    json,
    reasoning,
  }: {
    json: boolean;
    reasoning: boolean;
  }): unknown => {
    if (isAnthropic) {
      headers['x-api-key'] = model.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      return {
        model: model.modelName,
        max_tokens: maxTokens,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...frames.map((frame) => ({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: frame.jpeg.toString('base64'),
                },
              })),
            ],
          },
        ],
      };
    }
    if (isOpenAIResponses) {
      headers.Authorization = `Bearer ${model.apiKey}`;
      return {
        model: model.modelName,
        max_output_tokens: maxTokens,
        /*
         * These answers are a handful of fields, so reasoning tokens only add
         * latency; a reference search waits on one round trip per step. `none`
         * is the supported way to say that (GPT-6 rejects `minimal`), and the
         * caller falls back without the field if the endpoint rejects it.
         */
        ...(reasoning ? { reasoning: { effort: 'none' } } : {}),
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              ...frames.map((frame) => ({
                type: 'input_image',
                image_url: jpegDataUrl(frame.jpeg),
              })),
            ],
          },
        ],
      };
    }
    headers.Authorization = `Bearer ${model.apiKey}`;
    return {
      model: model.modelName,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: frames.map((frame) => ({
            type: 'image_url',
            image_url: { url: jpegDataUrl(frame.jpeg) },
          })),
        },
      ],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    };
  };

  const dispatcher =
    fetchImpl === fetch && !bypassesProxy(baseUrl)
      ? await getProxyDispatcher()
      : undefined;
  const send = async (options: { json: boolean; reasoning: boolean }) => {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body(options)),
        signal,
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit & { dispatcher?: ProxyAgent });
    } catch (error) {
      const cause =
        error && typeof error === 'object' && 'cause' in error
          ? (error as { cause?: { code?: string; message?: string } }).cause
          : undefined;
      throw new Error(
        [
          `Could not reach the VLM endpoint ${baseUrl.origin}.`,
          cause?.code,
          cause?.message ??
            (error instanceof Error ? error.message : String(error)),
          dispatcher
            ? 'The system proxy was used.'
            : 'No system proxy was detected.',
        ]
          .filter(Boolean)
          .join(' '),
      );
    }
    const text = await response.text();
    if (!response.ok)
      throw new Error(
        `VLM request failed (HTTP ${response.status}): ${text.slice(0, 400)}`,
      );
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('The VLM response was not valid JSON');
    }
    let text_: string;
    try {
      text_ = extractResponseText(payload);
    } catch (error) {
      /*
       * A truncated answer has no text at all, and its finish reason is the only
       * clue that the output budget was the problem rather than the model.
       */
      const finish = finishReasonOf(payload);
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}${
          finish ? ` (finish: ${finish})` : ''
        }`,
      );
    }
    return {
      status: response.status,
      text: text_,
      finishReason: finishReasonOf(payload),
    };
  };

  /*
   * One optional field can make an endpoint reject the request, and which one
   * depends on the API shape: the Responses API takes a reasoning budget, the
   * chat APIs take response_format. Try it once, then send without it, so a
   * rejected field costs one retry instead of the whole calibration.
   */
  const variants = (
    isOpenAIResponses
      ? [
          { json: jsonMode, reasoning: true },
          { json: false, reasoning: false },
        ]
      : [
          { json: jsonMode, reasoning: false },
          { json: false, reasoning: false },
        ]
  ).filter(
    (variant, index, all) =>
      all.findIndex(
        (other) =>
          other.json === variant.json && other.reasoning === variant.reasoning,
      ) === index,
  );
  let lastError: unknown;
  for (const [index, variant] of variants.entries()) {
    const startedAt = Date.now();
    try {
      const result = await send(variant);
      onTrace?.({
        model: model.modelName,
        endpoint,
        status: result.status,
        durationMs: Date.now() - startedAt,
        ...(result.finishReason ? { finishReason: result.finishReason } : {}),
        responseChars: result.text.length,
      });
      return result.text;
    } catch (error) {
      lastError = error;
      const detail = error instanceof Error ? error.message : String(error);
      onTrace?.({
        model: model.modelName,
        endpoint,
        durationMs: Date.now() - startedAt,
        error: detail.slice(0, 400),
      });
      const rejectedFormat = /\(HTTP (400|422)\)/.test(detail);
      if (!rejectedFormat || index === variants.length - 1) throw error;
    }
  }
  throw lastError;
}

export function parseViewpointClassification(
  source: string,
  cameraIds: readonly string[],
): CameraViewpointClassification {
  const result = parseVisionObject(source);
  const overheadCameraId = result.overheadCameraId;
  const eyeLevelCameraId = result.eyeLevelCameraId;
  if (
    typeof overheadCameraId !== 'string' ||
    typeof eyeLevelCameraId !== 'string' ||
    !cameraIds.includes(overheadCameraId) ||
    !cameraIds.includes(eyeLevelCameraId) ||
    overheadCameraId === eyeLevelCameraId
  )
    throw new Error(
      'The VLM response did not assign both camera IDs correctly',
    );
  const confidence =
    typeof result.confidence === 'number' && Number.isFinite(result.confidence)
      ? Math.min(1, Math.max(0, result.confidence))
      : 0.5;
  return {
    overheadCameraId,
    eyeLevelCameraId,
    confidence,
    ...(typeof result.reason === 'string' && result.reason.trim()
      ? { reason: result.reason.trim() }
      : {}),
  };
}

export function parseVisionObject(source: string): Record<string, unknown> {
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start)
    throw new Error('The VLM response did not contain a JSON object');
  const value: unknown = JSON.parse(source.slice(start, end + 1));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('The VLM response was not a JSON object');
  return value as Record<string, unknown>;
}

function viewpointPrompt(frames: readonly ViewpointFrame[]) {
  return [
    'You are comparing two live still frames from the same workstation.',
    'Exactly one camera is overhead/top-down and sees the phone or screen surface from above.',
    'The other camera is eye-level/side-view and sees the setup from a low horizontal angle.',
    'Use the visible screen plane, perspective, horizon, desk, and surroundings. Do not rely on camera names.',
    `Camera IDs in image order: ${frames.map((frame) => JSON.stringify(frame.cameraId)).join(', ')}.`,
    'Return only one JSON object with keys overheadCameraId, eyeLevelCameraId, confidence, and reason.',
    'Both camera IDs must exactly match the supplied IDs, and they must be different.',
  ].join('\n');
}

function jpegDataUrl(jpeg: Buffer) {
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

/** Reported so a truncated answer is visible in the trace/log. */
function finishReasonOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return;
  const value = payload as Record<string, unknown>;
  if (Array.isArray(value.choices)) {
    const choice = value.choices[0];
    if (choice && typeof choice === 'object') {
      const reason = (choice as Record<string, unknown>).finish_reason;
      if (typeof reason === 'string') return reason;
    }
  }
  if (typeof value.stop_reason === 'string') return value.stop_reason;
  if (typeof value.status === 'string') {
    const incomplete = value.incomplete_details;
    const reason =
      incomplete && typeof incomplete === 'object'
        ? (incomplete as Record<string, unknown>).reason
        : undefined;
    return typeof reason === 'string'
      ? `${value.status}: ${reason}`
      : value.status;
  }
  return;
}

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== 'object')
    throw new Error('The VLM response was empty');
  const value = payload as Record<string, unknown>;
  if (typeof value.output_text === 'string') return value.output_text;
  if (Array.isArray(value.output)) {
    const text = value.output.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const content = (entry as Record<string, unknown>).content;
      return Array.isArray(content)
        ? content.flatMap((part) => textPart(part))
        : [];
    });
    if (text.length) return text.join('');
  }
  if (Array.isArray(value.content)) {
    const text = value.content.flatMap((part) => textPart(part));
    if (text.length) return text.join('');
  }
  if (Array.isArray(value.choices)) {
    const choice = value.choices[0];
    if (choice && typeof choice === 'object') {
      const message = (choice as Record<string, unknown>).message;
      if (message && typeof message === 'object') {
        const content = (message as Record<string, unknown>).content;
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
          const text = content.flatMap((part) => textPart(part));
          if (text.length) return text.join('');
        }
      }
    }
  }
  throw new Error('The VLM response did not contain readable text');
}

function textPart(value: unknown) {
  if (!value || typeof value !== 'object') return [];
  const text = (value as Record<string, unknown>).text;
  return typeof text === 'string' ? [text] : [];
}
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProxyAgent } from 'undici';

async function getProxyDispatcher() {
  dispatcherPromise ??= resolveProxyUrl().then((url) =>
    url ? new ProxyAgent(url) : undefined,
  );
  return dispatcherPromise;
}

async function resolveProxyUrl(): Promise<string | undefined> {
  const environmentProxy =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy ??
    process.env.ALL_PROXY ??
    process.env.all_proxy;
  if (environmentProxy?.trim()) return normalizeProxyUrl(environmentProxy);
  if (process.platform !== 'win32') return;
  try {
    const { stdout } = await execFileAsync(
      'reg.exe',
      [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      ],
      { windowsHide: true },
    );
    return windowsProxyUrl(stdout);
  } catch {
    return;
  }
}

export function windowsProxyUrl(registryOutput: string): string | undefined {
  const enabled = /^\s*ProxyEnable\s+REG_DWORD\s+0x([0-9a-f]+)\s*$/im.exec(
    registryOutput,
  );
  if (!enabled || Number.parseInt(enabled[1]!, 16) === 0) return;
  const configured = /^\s*ProxyServer\s+REG_SZ\s+(.+?)\s*$/im.exec(
    registryOutput,
  )?.[1];
  if (!configured) return;
  const byProtocol = new Map(
    configured.split(';').flatMap((entry) => {
      const separator = entry.indexOf('=');
      return separator < 0
        ? []
        : [[entry.slice(0, separator), entry.slice(separator + 1)] as const];
    }),
  );
  return normalizeProxyUrl(
    byProtocol.get('https') ?? byProtocol.get('http') ?? configured,
  );
}

function normalizeProxyUrl(value: string) {
  const trimmed = value.trim();
  return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
}

function bypassesProxy(url: URL) {
  if (
    ['localhost', '127.0.0.1', '::1'].includes(url.hostname) ||
    url.hostname.endsWith('.local')
  )
    return true;
  const noProxy = process.env.NO_PROXY ?? process.env.no_proxy;
  return (noProxy ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/^\./, ''))
    .filter(Boolean)
    .some(
      (entry) =>
        entry === '*' ||
        url.hostname === entry ||
        url.hostname.endsWith(`.${entry}`),
    );
}
