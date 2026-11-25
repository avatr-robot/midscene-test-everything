import type { CameraControlCapability, CameraControlChoice } from '../cameras';
import { hasTranslation, t } from '../i18n';

const GENERIC_SDK_DESCRIPTIONS = new Set(['hdroption']);
const CHOICE_LABELS_ZH: Record<string, string> = {
  custom: '自定义',
  default: '默认',
  hand: '手部',
  'high accuracy': '高精度',
  'high density': '高密度',
  'medium density': '中等密度',
  'remove irregular streaks': '去除不规则条纹',
  'edge enhancement': '边缘增强',
  off: '关闭',
  laser: '红外激光',
  'laser auto': '自动激光',
  uvc: 'UVC',
};
const SELF_EXPLANATORY = new Set([
  'enable_auto_exposure',
  'emitter_enabled',
  'error_polling_enabled',
  'global_time_enabled',
  'auto_exposure_limit_toggle',
  'auto_gain_limit_toggle',
  'emitter_always_on',
  'hdr_enabled',
]);
const RANGE_UNITS: Record<string, [string, string]> = {
  exposure: ['微秒', 'µs'],
  auto_exposure_limit: ['微秒', 'µs'],
  laser_power: ['毫瓦', 'mW'],
  depth_units: ['米/深度单位', 'm/depth unit'],
  frames_queue_size: ['帧', 'frames'],
};

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return Number(value.toPrecision(6)).toString();
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/gu, '');
}

export function depthControlDescription(
  control: CameraControlCapability,
  language: 'zh' | 'en',
): string | undefined {
  const description = control.description?.trim();
  if (!description || SELF_EXPLANATORY.has(control.key)) return undefined;
  const normalizedDescription = normalize(description);
  if (
    normalizedDescription === normalize(control.label) ||
    GENERIC_SDK_DESCRIPTIONS.has(normalizedDescription)
  )
    return undefined;
  if (language === 'en') return description;
  return hasTranslation(description, language) ? t(description) : undefined;
}

export function depthControlRangeHint(
  control: CameraControlCapability,
  language: 'zh' | 'en',
): string | undefined {
  if (control.type !== 'number' || control.min === control.max)
    return undefined;
  const unit = RANGE_UNITS[control.key]?.[language === 'zh' ? 0 : 1];
  const minimum = formatNumber(control.min);
  const maximum = formatNumber(control.max);
  const step = formatNumber(control.step);
  return language === 'zh'
    ? `设备范围：${minimum}–${maximum}${unit ? ` ${unit}` : ''}；步长 ${step}`
    : `Device range: ${minimum}–${maximum}${unit ? ` ${unit}` : ''}; step ${step}`;
}

export function depthControlChoiceLabel(
  choice: CameraControlChoice,
  language: 'zh' | 'en',
): string {
  const value = formatNumber(choice.value);
  const label =
    language === 'zh'
      ? CHOICE_LABELS_ZH[choice.label.trim().toLocaleLowerCase('en-US')]
      : choice.label;
  return label && label !== value ? `${value} · ${label}` : value;
}
