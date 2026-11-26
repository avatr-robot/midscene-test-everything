import { expect, it } from '@rstest/core';
import {
  classifyCameraViewpoints,
  parseViewpointClassification,
  windowsProxyUrl,
} from '../src/server/viewpoint-classifier';

const frames = [
  { cameraId: 'camera-a', jpeg: Buffer.from('frame-a') },
  { cameraId: 'camera-b', jpeg: Buffer.from('frame-b') },
];
const model = {
  provider: 'OpenRouter',
  modelName: 'vision-model',
  modelFamily: 'qwen3-vl',
  baseUrl: 'https://example.test/v1',
  apiKey: 'secret',
};
const result = {
  overheadCameraId: 'camera-b',
  eyeLevelCameraId: 'camera-a',
  confidence: 0.93,
  reason: 'Camera B looks down on the screen.',
};

it('sends both frames to an OpenAI-compatible endpoint and parses the mapping', async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(result) } }],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  expect(await classifyCameraViewpoints({ frames, model, fetchImpl })).toEqual(
    result,
  );
  expect(String(calls[0]?.input)).toBe(
    'https://example.test/v1/chat/completions',
  );
  const body = JSON.parse(String(calls[0]?.init?.body));
  expect(body.messages[1].content).toHaveLength(2);
  expect(body.messages[1].content[0].image_url.url).toMatch(
    /^data:image\/jpeg;base64,/,
  );
});

it('uses the Anthropic messages endpoint for a direct Claude model', async () => {
  let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    request = { input, init };
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  await classifyCameraViewpoints({
    frames,
    model: {
      ...model,
      provider: 'Anthropic Claude',
      modelFamily: 'claude',
      baseUrl: 'https://api.anthropic.com/v1',
    },
    fetchImpl,
  });
  expect(String(request?.input)).toBe('https://api.anthropic.com/v1/messages');
  expect(request?.init?.headers).toMatchObject({ 'x-api-key': 'secret' });
});

it('uses the Responses endpoint for a direct GPT model', async () => {
  let endpoint = '';
  const fetchImpl = (async (input: RequestInfo | URL) => {
    endpoint = String(input);
    return new Response(
      JSON.stringify({ output_text: JSON.stringify(result) }),
      { status: 200 },
    );
  }) as typeof fetch;

  await classifyCameraViewpoints({
    frames,
    model: {
      ...model,
      provider: 'OpenAI',
      modelName: 'gpt-6-sol',
      modelFamily: 'gpt-6',
      baseUrl: 'https://api.openai.com/v1',
    },
    fetchImpl,
  });
  expect(endpoint).toBe('https://api.openai.com/v1/responses');
});

it('rejects mappings that do not contain two distinct input cameras', () => {
  expect(() =>
    parseViewpointClassification(
      JSON.stringify({
        overheadCameraId: 'camera-a',
        eyeLevelCameraId: 'camera-a',
      }),
      ['camera-a', 'camera-b'],
    ),
  ).toThrow('both camera IDs');
});

it('reads an enabled Windows system proxy', () => {
  expect(
    windowsProxyUrl(`
HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ       127.0.0.1:7890
`),
  ).toBe('http://127.0.0.1:7890');
  expect(
    windowsProxyUrl(`
    ProxyEnable    REG_DWORD    0x0
    ProxyServer    REG_SZ       127.0.0.1:7890
`),
  ).toBeUndefined();
});

it('reports the endpoint and network cause when the VLM is unreachable', async () => {
  const fetchImpl = (async () => {
    throw Object.assign(new Error('fetch failed'), {
      cause: {
        code: 'UND_ERR_CONNECT_TIMEOUT',
        message: 'Connect Timeout Error',
      },
    });
  }) as typeof fetch;

  await expect(
    classifyCameraViewpoints({ frames, model, fetchImpl }),
  ).rejects.toThrow(
    'Could not reach the VLM endpoint https://example.test. UND_ERR_CONNECT_TIMEOUT',
  );
});
