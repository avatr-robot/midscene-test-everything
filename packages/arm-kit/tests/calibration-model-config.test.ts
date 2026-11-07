import { describe, expect, it } from '@rstest/core';
import { createCalibrationModelStore } from '../../calibration-ui/src/model-settings';
import { parseModelEnvironment } from '../../calibration-ui/src/utils/modelEnv';
import { parseDetectionModel } from '../src/calibration-server/model-config.js';

describe('calibration model isolation', () => {
  it('validates request overrides without persisting or retaining unknown properties', () => {
    expect(parseDetectionModel(undefined)).toBeUndefined();
    const model = {
      modelName: 'test',
      modelFamily: 'qwen',
      baseUrl: '',
      apiKey: '',
    };
    expect(parseDetectionModel({ ...model, unrelated: 'ignored' })).toEqual(
      model,
    );
    for (const invalid of [
      null,
      [],
      'secret',
      {},
      { ...model, apiKey: 12 },
      { ...model, modelName: ' ' },
    ])
      expect(() => parseDetectionModel(invalid)).toThrow();
  });
  it('prioritizes dedicated calibration variables and parses exports/quotes without evaluating them', () => {
    expect(
      parseModelEnvironment(`
export MIDSCENE_MODEL_NAME="task"
MIDSCENE_ROBOT_CALIBRATION_MODEL_NAME='calibration' # preferred
OPENAI_API_KEY='literal-$(not-executed)'
MIDSCENE_MODEL_API_KEY='explicit'
MIDSCENE_ROBOT_CALIBRATION_MODEL_FAMILY=qwen # note
IGNORED=value
`),
    ).toEqual({
      modelName: 'calibration',
      modelFamily: 'qwen',
      apiKey: 'explicit',
    });
  });
  it('keeps separate workspace settings independent', () => {
    const a = createCalibrationModelStore();
    const b = createCalibrationModelStore();
    a.setState({
      config: {
        modelName: 'a',
        modelFamily: 'qwen',
        baseUrl: '',
        apiKey: 'a-secret',
      },
      custom: true,
    });
    expect(b.getState().config.apiKey).toBe('');
    expect(b.getState().custom).toBe(false);
  });
});
