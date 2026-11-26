import { expect, it } from '@rstest/core';
import { verifyReferenceObservation } from '../src/server/reference-observation';

const model = {
  provider: 'OpenRouter',
  modelName: 'vision-model',
  modelFamily: 'qwen3-vl',
  baseUrl: 'https://example.test/v1',
  apiKey: 'secret',
};

const observation = {
  overhead: { jpeg: Buffer.from('overhead') },
  side: { jpeg: Buffer.from('side') },
  targetOutline: {
    topLeft: { x: 10, y: 20 },
    topRight: { x: 110, y: 20 },
    bottomRight: { x: 110, y: 220 },
    bottomLeft: { x: 10, y: 220 },
  },
  centered: false,
  trackOverheadTip: true,
  signal: new AbortController().signal,
};

const reading = {
  targetVisible: true,
  tipVisible: true,
  viewClear: true,
  visibleGapAboveTarget: true,
  confidence: 0.91,
  overheadTip: { x: 520, y: 340 },
};

function reply(content: string, status = 200) {
  return (async () =>
    new Response(
      status === 200
        ? JSON.stringify({ choices: [{ message: { content } }] })
        : content,
      { status },
    )) as typeof fetch;
}

it('returns the eye-level reading the preview overlays', async () => {
  const result = await verifyReferenceObservation(
    observation,
    model,
    undefined,
    reply(JSON.stringify(reading)),
  );

  expect(result.hovering).toBe(true);
  expect(result.overheadTip).toEqual({ x: 520, y: 340 });
  expect(result.debug).toMatchObject({
    ok: true,
    model: 'vision-model',
    targetVisible: true,
    tipVisible: true,
    viewClear: true,
    visibleGapAboveTarget: true,
    confidence: 0.91,
    overheadTip: { x: 520, y: 340 },
  });
});

it('retries one unparsable answer before failing the call', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'I cannot tell.' } }] }),
      { status: 200 },
    );
  }) as typeof fetch;

  await expect(
    verifyReferenceObservation(observation, model, undefined, fetchImpl),
  ).rejects.toMatchObject({
    message:
      'The model did not return usable JSON. Check that it supports vision JSON output.',
    details: { modelFailure: 'response' },
  });
  expect(calls).toBe(2);
});

it('accepts a retry when the first attempt was a server error', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return calls === 1
      ? new Response('upstream failure', { status: 500 })
      : new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(reading) } }],
          }),
          { status: 200 },
        );
  }) as typeof fetch;

  const result = await verifyReferenceObservation(
    observation,
    model,
    undefined,
    fetchImpl,
  );
  expect(calls).toBe(2);
  expect(result.debug).toMatchObject({ ok: true });
});

it('does not retry a rejected API key', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('bad key', { status: 401 });
  }) as typeof fetch;

  await expect(
    verifyReferenceObservation(observation, model, undefined, fetchImpl),
  ).rejects.toMatchObject({
    message: 'The model rejected the API key. Check the model settings.',
    details: { modelFailure: 'auth' },
  });
  expect(calls).toBe(1);
});

it('reports a truncated transport as a timeout', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    throw new DOMException('This operation was aborted', 'AbortError');
  }) as typeof fetch;

  await expect(
    verifyReferenceObservation(observation, model, undefined, fetchImpl),
  ).rejects.toMatchObject({
    message: 'The model did not answer in time. Check the network and retry.',
    details: { modelFailure: 'timeout' },
  });
  expect(calls).toBe(2);
});

it('reports which observation the model rejected', async () => {
  await expect(
    verifyReferenceObservation(
      observation,
      model,
      undefined,
      reply(
        JSON.stringify({
          ...reading,
          tipVisible: false,
          visibleGapAboveTarget: false,
          confidence: 0.42,
        }),
      ),
    ),
  ).rejects.toMatchObject({
    details: {
      referenceObservation: {
        ok: false,
        targetVisible: true,
        tipVisible: false,
        confidence: 0.42,
      },
    },
  });
});
