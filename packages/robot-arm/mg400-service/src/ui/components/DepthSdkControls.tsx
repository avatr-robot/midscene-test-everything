import { InputNumber, Select, Switch, Tooltip, Typography } from 'antd';
import type { CameraControlCapability } from '../cameras';
import { t, useLanguage } from '../i18n';
import {
  depthControlChoiceLabel,
  depthControlDescription,
  depthControlRangeHint,
} from '../utils/depth-sdk-controls';

const COMMON_CONTROLS = new Set([
  'enable_auto_exposure',
  'exposure',
  'gain',
  'laser_power',
  'emitter_enabled',
  'visual_preset',
  'hdr_enabled',
]);

function precisionFor(step: number): number {
  if (step >= 1) return 0;
  return Math.min(9, Math.max(0, Math.ceil(-Math.log10(step))));
}

function isDisabled(
  control: CameraControlCapability,
  values: Record<string, number>,
): boolean {
  if (control.min === control.max) return true;
  if (
    (control.key === 'exposure' || control.key === 'gain') &&
    values.enable_auto_exposure === 1
  )
    return true;
  if (
    control.key === 'auto_exposure_limit' &&
    values.auto_exposure_limit_toggle !== 1
  )
    return true;
  if (control.key === 'auto_gain_limit' && values.auto_gain_limit_toggle !== 1)
    return true;
  return false;
}

function DepthControlField({
  control,
  language,
  values,
  onChange,
}: {
  control: CameraControlCapability;
  language: 'zh' | 'en';
  values: Record<string, number>;
  onChange: (key: string, value: number) => void;
}) {
  const disabled = isDisabled(control, values);
  const value = values[control.key] ?? control.value;
  const label = t(control.label);
  const description = depthControlDescription(control, language);
  const range = depthControlRangeHint(control, language);
  const tooltip =
    description || range ? (
      <span className="depth-sdk-tooltip">
        {description ? <span>{description}</span> : null}
        {range ? (
          <span className="depth-sdk-tooltip-range">{range}</span>
        ) : null}
      </span>
    ) : undefined;
  return (
    <div className="depth-sdk-field">
      <Tooltip title={tooltip}>
        <span
          className={
            tooltip
              ? 'depth-sdk-label depth-sdk-label--help'
              : 'depth-sdk-label'
          }
        >
          {label}
        </span>
      </Tooltip>
      {control.type === 'boolean' ? (
        <Switch
          aria-label={label}
          checked={value === 1}
          disabled={disabled}
          onChange={(checked) => onChange(control.key, checked ? 1 : 0)}
          size="small"
        />
      ) : control.type === 'select' && control.choices?.length ? (
        <Select
          aria-label={label}
          disabled={disabled}
          onChange={(next) => onChange(control.key, next)}
          options={control.choices.map((choice) => ({
            label: depthControlChoiceLabel(choice, language),
            value: choice.value,
          }))}
          popupClassName="robot-select-menu"
          size="small"
          value={value}
        />
      ) : (
        <InputNumber
          aria-label={label}
          disabled={disabled}
          max={control.max}
          min={control.min}
          onChange={(next) => onChange(control.key, next ?? control.default)}
          precision={precisionFor(control.step)}
          size="small"
          step={control.step}
          value={value}
        />
      )}
    </div>
  );
}

export function DepthSdkControls({
  controls,
  values,
  onChange,
}: {
  controls: CameraControlCapability[];
  values: Record<string, number>;
  onChange: (key: string, value: number) => void;
}) {
  const language = useLanguage();
  const zh = language === 'zh';
  const common = controls.filter((control) => COMMON_CONTROLS.has(control.key));
  const advanced = controls.filter(
    (control) => !COMMON_CONTROLS.has(control.key),
  );
  const render = (control: CameraControlCapability) => (
    <DepthControlField
      control={control}
      key={control.key}
      language={language}
      onChange={onChange}
      values={values}
    />
  );
  return (
    <section
      className="depth-sdk-controls"
      aria-label={zh ? '深度 SDK 设置' : 'Depth SDK controls'}
    >
      <div className="depth-sdk-note">
        <Typography.Text strong>
          {zh ? '深度传感器参数' : 'Depth sensor controls'}
        </Typography.Text>
        <Typography.Text type="secondary">
          {zh
            ? '保存后会重启正在运行的深度流，以应用 SDK 参数。'
            : 'Saving restarts the running depth stream to apply SDK values.'}
        </Typography.Text>
      </div>
      <div className="depth-sdk-grid">{common.map(render)}</div>
      {advanced.length > 0 ? (
        <details className="depth-sdk-advanced">
          <summary>
            {zh ? '高级 SDK 参数' : 'Advanced SDK controls'} ({advanced.length})
          </summary>
          <div className="depth-sdk-grid">{advanced.map(render)}</div>
        </details>
      ) : null}
    </section>
  );
}
