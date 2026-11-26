export interface VlmModelSettings {
  provider: string;
  modelName: string;
  modelFamily: string;
  baseUrl: string;
  apiKey: string;
}

export const EMPTY_VLM_MODEL_SETTINGS: VlmModelSettings = {
  provider: '',
  modelName: '',
  modelFamily: '',
  baseUrl: '',
  apiKey: '',
};

export const VLM_MODEL_SETTINGS_STORAGE_KEY = 'midscene-arm-vlm-model-settings';

export interface VlmModelPreset {
  name: string;
  label: string;
  family: string;
}

interface VlmProviderPreset {
  name: string;
  label: string;
  baseUrl: string;
  aliases: readonly string[];
  models: readonly VlmModelPreset[];
}

const GPT_MODELS: readonly VlmModelPreset[] = [
  { name: 'gpt-6-sol', label: 'GPT-6 Sol', family: 'gpt-6' },
  { name: 'gpt-6-astra', label: 'GPT-6 Astra', family: 'gpt-6' },
  { name: 'gpt-6-luna', label: 'GPT-6 Luna', family: 'gpt-6' },
  { name: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', family: 'gpt-5' },
  { name: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', family: 'gpt-5' },
  { name: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', family: 'gpt-5' },
  { name: 'gpt-5.5', label: 'GPT-5.5', family: 'gpt-5' },
  { name: 'gpt-5.4', label: 'GPT-5.4', family: 'gpt-5' },
];

const CLAUDE_MODELS: readonly VlmModelPreset[] = [
  { name: 'claude-opus-5-5', label: 'Claude Opus 5.5', family: 'claude' },
  { name: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', family: 'claude' },
  { name: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', family: 'claude' },
  { name: 'claude-opus-4-8', label: 'Claude Opus 4.8', family: 'claude' },
  { name: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', family: 'claude' },
  { name: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', family: 'claude' },
];

const GEMINI_MODELS: readonly VlmModelPreset[] = [
  { name: 'gemini-4-argon', label: 'Gemini 4 Argon', family: 'gemini' },
  { name: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', family: 'gemini' },
  {
    name: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash Preview',
    family: 'gemini',
  },
];

const DEEPSEEK_MODELS: readonly VlmModelPreset[] = [
  { name: 'deepseek-flash', label: 'DeepSeek V4.1 Flash', family: 'deepseek' },
  {
    name: 'deepseek-v4-flash-vision-exp',
    label: 'DeepSeek V4 Flash Vision',
    family: 'deepseek',
  },
];

const QWEN_MODELS: readonly VlmModelPreset[] = [
  { name: 'qwen3.7-plus', label: 'Qwen3.7 Plus', family: 'qwen3' },
  { name: 'qwen3.6-plus', label: 'Qwen3.6 Plus', family: 'qwen3' },
  { name: 'qwen3.5-plus', label: 'Qwen3.5 Plus', family: 'qwen3' },
  { name: 'qwen3-vl-plus', label: 'Qwen3-VL Plus', family: 'qwen3-vl' },
  {
    name: 'qwen-vl-max-latest',
    label: 'Qwen2.5-VL Max',
    family: 'qwen2.5-vl',
  },
];

const KIMI_MODELS: readonly VlmModelPreset[] = [
  { name: 'kimi-k3', label: 'Kimi K3', family: 'kimi3' },
  { name: 'kimi-k2.6', label: 'Kimi K2.6', family: 'kimi' },
  { name: 'kimi-k2.5', label: 'Kimi K2.5', family: 'kimi' },
];

const DOUBAO_MODELS: readonly VlmModelPreset[] = [
  {
    name: 'doubao-seed-2-1-pro-260915',
    label: 'Doubao Seed 2.1 Pro',
    family: 'doubao-seed',
  },
  {
    name: 'doubao-seed-2-1-turbo-260628',
    label: 'Doubao Seed 2.1 Turbo',
    family: 'doubao-seed',
  },
  {
    name: 'Doubao-Seed-1.8',
    label: 'Doubao Seed 1.8',
    family: 'doubao-seed',
  },
  {
    name: 'Doubao-Seed-1.6-Vision',
    label: 'Doubao Seed 1.6 Vision',
    family: 'doubao-seed',
  },
];

const GLM_MODELS: readonly VlmModelPreset[] = [
  { name: 'glm-5v-turbo', label: 'GLM-5V Turbo', family: 'glm-v' },
  { name: 'glm-4.6v', label: 'GLM-4.6V', family: 'glm-v' },
];

const MIMO_MODELS: readonly VlmModelPreset[] = [
  { name: 'mimo-v2.6-pro', label: 'MiMo V2.6 Pro', family: 'xiaomi-mimo' },
  {
    name: 'mimo-v2.6-flash',
    label: 'MiMo V2.6 Flash',
    family: 'xiaomi-mimo',
  },
  {
    name: 'mimo-v2.6-pro-ultraspeed',
    label: 'MiMo V2.6 Pro Ultraspeed',
    family: 'xiaomi-mimo',
  },
  { name: 'mimo-v2.5', label: 'MiMo V2.5', family: 'xiaomi-mimo' },
];

const ANT_LING_MODELS: readonly VlmModelPreset[] = [
  {
    name: 'Ling-3.0-flash-VL',
    label: 'Ling 3.0 Flash VL',
    family: 'ant-ling',
  },
];

const OPENROUTER_MODELS: readonly VlmModelPreset[] = [
  ...GPT_MODELS.map((model) => ({
    ...model,
    name: `openai/${model.name}`,
  })),
  ...CLAUDE_MODELS.map((model) => ({
    ...model,
    name: `anthropic/${model.name}`,
  })),
  ...GEMINI_MODELS.map((model) => ({
    ...model,
    name: `google/${model.name}`,
  })),
  {
    name: 'deepseek/deepseek-v4.1-flash',
    label: 'DeepSeek V4.1 Flash',
    family: 'deepseek',
  },
  ...QWEN_MODELS.map((model) => ({
    ...model,
    name: `qwen/${model.name}`,
  })),
  ...KIMI_MODELS.map((model) => ({
    ...model,
    name: `moonshotai/${model.name}`,
  })),
  {
    name: 'bytedance-seed/seed-2-1-turbo',
    label: 'Doubao Seed 2.1 Turbo',
    family: 'doubao-seed',
  },
  ...GLM_MODELS.map((model) => ({
    ...model,
    name: `z-ai/${model.name}`,
  })),
  ...MIMO_MODELS.map((model) => ({
    ...model,
    name: `xiaomi/${model.name}`,
  })),
  {
    name: 'inclusionai/ling-3.0-flash-vl',
    label: 'Ling 3.0 Flash VL',
    family: 'ant-ling',
  },
];

export const VLM_PROVIDER_PRESETS: readonly VlmProviderPreset[] = [
  {
    name: 'OpenAI',
    label: 'OpenAI / GPT',
    baseUrl: 'https://api.openai.com/v1',
    aliases: ['openai', 'gpt'],
    models: GPT_MODELS,
  },
  {
    name: 'OpenRouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    aliases: ['openrouter'],
    models: OPENROUTER_MODELS,
  },
  {
    name: 'Google Gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    aliases: ['google', 'gemini', 'google ai studio'],
    models: GEMINI_MODELS,
  },
  {
    name: 'Anthropic Claude',
    label: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    aliases: ['anthropic', 'claude'],
    models: CLAUDE_MODELS,
  },
  {
    name: 'DeepSeek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    aliases: ['deepseek'],
    models: DEEPSEEK_MODELS,
  },
  {
    name: 'Alibaba Qwen',
    label: 'Alibaba Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    aliases: ['alibaba', 'qwen', 'dashscope'],
    models: QWEN_MODELS,
  },
  {
    name: 'Moonshot Kimi',
    label: 'Moonshot Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    aliases: ['moonshot', 'kimi'],
    models: KIMI_MODELS,
  },
  {
    name: 'Volcengine Doubao',
    label: 'Volcengine Doubao',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    aliases: ['volcengine', 'doubao', 'ark'],
    models: DOUBAO_MODELS,
  },
  {
    name: 'Zhipu GLM',
    label: 'Zhipu GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    aliases: ['zhipu', 'glm', 'bigmodel'],
    models: GLM_MODELS,
  },
  {
    name: 'Xiaomi MiMo',
    label: 'Xiaomi MiMo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    aliases: ['xiaomi', 'mimo'],
    models: MIMO_MODELS,
  },
  {
    name: 'Ant Ling',
    label: 'Ant Ling',
    baseUrl: 'https://api.ant-ling.com/v1',
    aliases: ['ant', 'ling', 'ant-ling'],
    models: ANT_LING_MODELS,
  },
];

export function normalizeVlmModelSettings(
  value: Partial<VlmModelSettings>,
): VlmModelSettings {
  return {
    provider: value.provider?.trim() ?? '',
    modelName: value.modelName?.trim() ?? '',
    modelFamily: value.modelFamily?.trim() ?? '',
    baseUrl: value.baseUrl?.trim() ?? '',
    apiKey: value.apiKey?.trim() ?? '',
  };
}

export function isVlmModelSettingsComplete(
  value: Partial<VlmModelSettings>,
): boolean {
  const settings = normalizeVlmModelSettings(value);
  return (
    Boolean(
      settings.modelName &&
        settings.modelFamily &&
        settings.baseUrl &&
        settings.apiKey,
    ) && isHttpUrl(settings.baseUrl)
  );
}

export function findVlmProviderPreset(
  provider?: string,
): VlmProviderPreset | undefined {
  const normalized = provider?.trim().toLowerCase() ?? '';
  if (!normalized) return;
  return VLM_PROVIDER_PRESETS.find(
    (preset) =>
      preset.name.toLowerCase() === normalized ||
      preset.aliases.includes(normalized),
  );
}

export function applyVlmProviderSelection(
  current: VlmModelSettings,
  provider?: string,
): VlmModelSettings {
  const nextProvider = provider?.trim() ?? '';
  const preset = findVlmProviderPreset(nextProvider);
  if (!preset) return { ...current, provider: nextProvider };
  const currentModel = preset.models.find(
    (model) => model.name === current.modelName,
  );
  return {
    ...current,
    provider: nextProvider,
    baseUrl: preset.baseUrl,
    modelName: currentModel ? current.modelName : '',
    modelFamily: currentModel ? current.modelFamily : '',
  };
}

export function findVlmModelPreset(
  provider: string,
  modelName: string,
): VlmModelPreset | undefined {
  return findVlmProviderPreset(provider)?.models.find(
    (model) => model.name === modelName.trim(),
  );
}

export function loadVlmModelSettings(): VlmModelSettings | undefined {
  try {
    const stored = globalThis.localStorage?.getItem(
      VLM_MODEL_SETTINGS_STORAGE_KEY,
    );
    if (!stored) return;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return;
    const settings = normalizeVlmModelSettings(
      parsed as Partial<VlmModelSettings>,
    );
    return isVlmModelSettingsComplete(settings) ? settings : undefined;
  } catch {
    return;
  }
}

export function saveVlmModelSettings(
  value: Partial<VlmModelSettings>,
): VlmModelSettings {
  const settings = normalizeVlmModelSettings(value);
  if (!isVlmModelSettingsComplete(settings))
    throw new Error('Complete the VLM model configuration before saving.');
  globalThis.localStorage.setItem(
    VLM_MODEL_SETTINGS_STORAGE_KEY,
    JSON.stringify(settings),
  );
  return settings;
}

export function clearVlmModelSettings(): void {
  globalThis.localStorage.removeItem(VLM_MODEL_SETTINGS_STORAGE_KEY);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
