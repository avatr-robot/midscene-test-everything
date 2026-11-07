import * as aiModelActual from '@midscene/core/ai-model' with {
  rstest: 'importActual',
};
import { AIResponseParseError } from '@midscene/core/ai-model';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  rstest,
} from '@rstest/core';
import {
  SCREEN_CORNER_PROMPT,
  detectScreenWithModel,
  validateScreenCorners,
} from '../src/calibration/camera/screen-detector.js';

const ai = rstest.hoisted(() => ({ call: rstest.fn() }));
rstest.mock('@midscene/core/ai-model', () => ({
  ...aiModelActual,
  callAIWithObjectResponse: ai.call,
  getModelRuntime: (config: unknown) => ({ config }),
}));
const jpeg = Buffer.from([
  255, 216, 255, 192, 0, 17, 8, 1, 244, 3, 232, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0,
]);
const config = {
  modelName: 'test-model',
  modelFamily: 'qwen3.6',
  baseUrl: 'https://model.test/v1',
  apiKey: 'private-key',
};
const output = {
  found: true,
  reason: 'Complete display',
  corners: {
    topLeft: { x: 100, y: 100 },
    topRight: { x: 900, y: 100 },
    bottomRight: { x: 900, y: 900 },
    bottomLeft: { x: 100, y: 900 },
  },
};
beforeEach(() => {
  rstest.stubGlobal(
    'fetch',
    rstest.fn(() => {
      throw new Error('Unexpected legacy camera request');
    }),
  );
  ai.call.mockResolvedValue({
    content: output,
    contentString: JSON.stringify(output),
  });
});
afterEach(() => {
  rstest.unstubAllGlobals();
  ai.call.mockReset();
});

describe('screen model detection evidence', () => {
  it('explains the reversed corner order in the reported phone photograph', () => {
    const reported = {
      topLeft: { x: 844, y: 576 },
      topRight: { x: 763, y: 121 },
      bottomRight: { x: 194, y: 326 },
      bottomLeft: { x: 275, y: 691 },
    };
    expect(() => validateScreenCorners(reported, 1920, 1080)).toThrowError(
      expect.objectContaining({
        code: 'SCREEN_CORNER_ORDER',
        message: expect.stringContaining('镜像'),
      }),
    );
  });
  it.each([0, 1, 2, 3])(
    'accepts a correctly ordered screen rotated by %s quarter turns',
    (turns) => {
      const rotated = Object.fromEntries(
        Object.entries(output.corners).map(([name, original]) => {
          let point = original;
          for (let i = 0; i < turns; i++)
            point = { x: 1000 - point.y, y: point.x };
          return [name, point];
        }),
      );
      expect(() => validateScreenCorners(rotated, 1920, 1080)).not.toThrow();
    },
  );
  it('returns the actual input and model response, without model credentials', async () => {
    const result = await detectScreenWithModel(jpeg, config);
    expect(result.points.topLeft.x).toBeCloseTo(99.9);
    expect(result.points.topLeft.y).toBeCloseTo(49.9);
    expect(result.attempt.input).toEqual({
      jpegBase64: jpeg.toString('base64'),
      width: 1000,
      height: 500,
      prompt: SCREEN_CORNER_PROMPT,
      modelName: config.modelName,
      modelFamily: config.modelFamily,
    });
    expect(ai.call.mock.calls[0][0][0].content).toEqual([
      { type: 'text', text: result.attempt.input.prompt },
      {
        type: 'image',
        url: `data:image/jpeg;base64,${result.attempt.input.jpegBase64}`,
      },
    ]);
    expect(result.attempt.output).toEqual({
      text: JSON.stringify(output),
      parsed: output,
    });
    expect(JSON.stringify(result)).not.toContain(config.apiKey);
    expect(JSON.stringify(result)).not.toContain(config.baseUrl);
  });
  it('keeps input and rejected output when the model cannot identify a complete display', async () => {
    const rejected = { found: false, reason: 'Top edge is occluded' };
    ai.call.mockResolvedValue({
      content: rejected,
      contentString: JSON.stringify(rejected),
    });
    await expect(detectScreenWithModel(jpeg, config)).rejects.toMatchObject({
      code: 'SCREEN_NOT_FOUND',
      details: {
        attempt: {
          input: { jpegBase64: jpeg.toString('base64') },
          output: { parsed: rejected },
          error: rejected.reason,
        },
      },
    });
  });
  it('retains an unparseable assistant response for inspection', async () => {
    ai.call.mockRejectedValue(
      new AIResponseParseError('Invalid JSON', 'not JSON'),
    );
    await expect(detectScreenWithModel(jpeg, config)).rejects.toMatchObject({
      code: 'SCREEN_DETECTION_FAILED',
      details: {
        attempt: { output: { text: 'not JSON' }, error: 'Invalid JSON' },
      },
    });
  });
  it('retains crossed-corner output and asks the operator to retry', async () => {
    const crossed = {
      ...output,
      corners: {
        ...output.corners,
        topRight: output.corners.bottomRight,
        bottomRight: output.corners.topRight,
      },
    };
    ai.call.mockResolvedValue({
      content: crossed,
      contentString: JSON.stringify(crossed),
    });
    await expect(detectScreenWithModel(jpeg, config)).rejects.toMatchObject({
      code: 'SCREEN_NOT_FOUND',
      details: { attempt: { output: { parsed: crossed } } },
    });
  });
});
