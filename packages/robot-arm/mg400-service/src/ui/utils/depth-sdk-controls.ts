import type { CameraControlCapability, CameraControlChoice } from '../cameras';

const CONTROL_LABELS_ZH: Record<string, string> = {
  enable_auto_exposure: '自动曝光',
  exposure: '曝光',
  gain: '增益',
  laser_power: '激光功率',
  emitter_enabled: '红外发射器',
  visual_preset: '视觉预设',
  hdr_enabled: 'HDR',
  depth_units: '深度单位',
  frames_queue_size: '帧队列长度',
};
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

export function depthControlLabel(
  control: CameraControlCapability,
  language: 'zh' | 'en',
): string {
  return language === 'zh'
    ? (CONTROL_LABELS_ZH[control.key] ?? control.label)
    : control.label;
}

export function depthControlDescription(
  control: CameraControlCapability,
  language: 'zh' | 'en',
): string | undefined {
  const description = control.description?.trim();
  if (!description || SELF_EXPLANATORY.has(control.key)) return undefined;
  if (language === 'en') return description;
  const translated = /increases|decreases|controls|values|l%|projector/i.test(
    description,
  )
    ? undefined
    : description;
  return translated;
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
