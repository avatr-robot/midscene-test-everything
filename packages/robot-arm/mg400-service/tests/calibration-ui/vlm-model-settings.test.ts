import { afterEach, expect, it, rstest } from '@rstest/core';
import {
  applyVlmProviderSelection,
  findVlmModelPreset,
  findVlmProviderPreset,
  isVlmModelSettingsComplete,
  loadVlmModelSettings,
  saveVlmModelSettings,
} from '../../src/ui/components/robot-arm/vlm-model-settings';

afterEach(() => rstest.unstubAllGlobals());

it('fills a selected GPT model from its provider preset', () => {
  expect(findVlmProviderPreset('gpt')?.baseUrl).toBe(
    'https://api.openai.com/v1',
  );
  expect(findVlmModelPreset('OpenAI', 'gpt-6-sol')).toEqual({
    name: 'gpt-6-sol',
    label: 'GPT-6 Sol',
    family: 'gpt-6',
  });
  expect(findVlmModelPreset('OpenRouter', 'openai/gpt-6-sol')?.family).toBe(
    'gpt-6',
  );
});

it('provides direct presets for the mainstream model providers', () => {
  expect(findVlmProviderPreset('Gemini')?.baseUrl).toBe(
    'https://generativelanguage.googleapis.com/v1beta/openai/',
  );
  expect(findVlmModelPreset('Gemini', 'gemini-3.5-flash')?.family).toBe(
    'gemini',
  );
  expect(findVlmProviderPreset('Claude')?.baseUrl).toBe(
    'https://api.anthropic.com/v1',
  );
  expect(findVlmModelPreset('Claude', 'claude-sonnet-5-5')?.family).toBe(
    'claude',
  );
  expect(findVlmModelPreset('DeepSeek', 'deepseek-flash')?.family).toBe(
    'deepseek',
  );
  expect(
    findVlmModelPreset('OpenRouter', 'anthropic/claude-opus-5-5')?.family,
  ).toBe('claude');
});

it('clears the provider without discarding a manual endpoint', () => {
  const current = {
    provider: 'OpenRouter',
    modelName: 'custom-model',
    modelFamily: 'custom-family',
    baseUrl: 'https://example.test/v1',
    apiKey: 'secret',
  };
  expect(applyVlmProviderSelection(current, undefined)).toEqual({
    ...current,
    provider: '',
  });
  expect(() => findVlmProviderPreset(undefined)).not.toThrow();
});

it('persists only a complete HTTP(S) model configuration', () => {
  const values = new Map<string, string>();
  rstest.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  const config = {
    provider: 'OpenAI',
    modelName: 'vision-model',
    modelFamily: 'qwen3.6',
    baseUrl: 'https://example.test/v1',
    apiKey: 'secret',
  };

  expect(() =>
    saveVlmModelSettings({ ...config, baseUrl: 'not-a-url' }),
  ).toThrow();
  saveVlmModelSettings(config);
  expect(loadVlmModelSettings()).toEqual(config);
  expect(isVlmModelSettingsComplete(config)).toBe(true);
  expect(isVlmModelSettingsComplete({ ...config, provider: '' })).toBe(true);
});
