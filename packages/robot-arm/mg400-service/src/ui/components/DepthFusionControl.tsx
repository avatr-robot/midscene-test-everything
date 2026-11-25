import { Slider, Switch, Tooltip } from 'antd';
import { useLanguage } from '../i18n';

export function DepthFusionControl({
  available,
  blockedReason,
  enabled,
  opacity,
  onChange,
  onOpacityChange,
}: {
  available: boolean;
  blockedReason?: string;
  enabled: boolean;
  opacity: number;
  onChange: (enabled: boolean) => void;
  onOpacityChange: (opacity: number) => void;
}) {
  const zh = useLanguage() === 'zh';
  return (
    <div className="depth-fusion-control">
      <Tooltip title={blockedReason}>
        <span className="depth-fusion-toggle">
          <span>{zh ? 'RGB + 深度' : 'RGB + Depth'}</span>
          <Switch
            aria-label={zh ? '融合 RGB 与深度' : 'Fuse RGB and depth'}
            checked={enabled}
            disabled={(!available || Boolean(blockedReason)) && !enabled}
            onChange={onChange}
            size="small"
          />
        </span>
      </Tooltip>
      {blockedReason ? (
        <span className="depth-fusion-warning">{blockedReason}</span>
      ) : null}
      {enabled ? (
        <div className="depth-fusion-opacity">
          <span>{zh ? '深度层透明度' : 'Depth opacity'}</span>
          <Slider
            aria-label={zh ? '深度层透明度' : 'Depth opacity'}
            max={90}
            min={0}
            onChange={(value) => onOpacityChange(value / 100)}
            step={5}
            tooltip={{ formatter: (value) => `${value}%` }}
            value={Math.round(opacity * 100)}
          />
          <span>{Math.round(opacity * 100)}%</span>
        </div>
      ) : null}
    </div>
  );
}
