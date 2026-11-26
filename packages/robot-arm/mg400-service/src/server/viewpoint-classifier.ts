export interface ViewpointModelConfig {
  provider: string;
  modelName: string;
  modelFamily: string;
  baseUrl: string;
  apiKey: string;
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
}: {
  frames: readonly ViewpointFrame[];
  model: ViewpointModelConfig;
  fetchImpl?: FetchLike;
}): Promise<CameraViewpointClassification> {
  if (
    frames.length !== 2 ||
    new Set(frames.map((frame) => frame.cameraId)).size !== 2
  )
    throw new Error('Exactly two distinct camera frames are required');
  const baseUrl = new URL(model.baseUrl);
  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:')
    throw new Error('The model base URL must use HTTP or HTTPS');

  const prompt = viewpointPrompt(frames);
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
  let body: unknown;
  if (isAnthropic) {
    headers['x-api-key'] = model.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = {
      model: model.modelName,
      max_tokens: 300,
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
  } else if (isOpenAIResponses) {
    headers.Authorization = `Bearer ${model.apiKey}`;
    body = {
      model: model.modelName,
      max_output_tokens: 300,
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
  } else {
    headers.Authorization = `Bearer ${model.apiKey}`;
    body = {
      model: model.modelName,
      max_tokens: 300,
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
    };
  }

  const dispatcher =
    fetchImpl === fetch && !bypassesProxy(baseUrl)
      ? await getProxyDispatcher()
      : undefined;
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
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
  const payload: unknown = JSON.parse(text);
  return parseViewpointClassification(
    extractResponseText(payload),
    frames.map((frame) => frame.cameraId),
  );
}

export function parseViewpointClassification(
  source: string,
  cameraIds: readonly string[],
): CameraViewpointClassification {
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start)
    throw new Error('The VLM response did not contain a JSON object');
  const value: unknown = JSON.parse(source.slice(start, end + 1));
  if (!value || typeof value !== 'object')
    throw new Error('The VLM response was not a JSON object');
  const result = value as Record<string, unknown>;
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
