import type { ReferenceObservationDebug } from '@midscene/robotics-shared/assisted-contracts';
import type { CameraCorrection } from '@midscene/robotics-shared/contracts';
import { t } from '../../i18n';

function ReadingChip({ label, value }: { label: string; value?: boolean }) {
  return (
    <span
      className="guided-reading-chip"
      data-state={value === undefined ? 'unknown' : value ? 'yes' : 'no'}
    >
      <span aria-hidden="true">
        {value === undefined ? '–' : value ? '✓' : '✗'}
      </span>
      {label}
    </span>
  );
}

/**
 * What the eye-level model decided about the frame under it. Shown on the
 * model's own input so a rejected reference can be read from the image.
 */
export function ReferenceModelReading({
  debug,
}: {
  debug: ReferenceObservationDebug;
}) {
  return (
    <output
      className="guided-model-reading"
      data-ok={debug.ok}
      aria-live="polite"
    >
      <div className="guided-model-reading-title">
        {t('Eye-level model reading')}
        {debug.confidence !== undefined && (
          <span className="guided-model-reading-confidence">
            {t('Confidence {0}%', [String(Math.round(debug.confidence * 100))])}
          </span>
        )}
      </div>
      <div className="guided-model-reading-chips">
        <ReadingChip
          label={t('Selected screen visible')}
          value={debug.targetVisible}
        />
        <ReadingChip label={t('Stylus tip visible')} value={debug.tipVisible} />
        <ReadingChip label={t('View clear')} value={debug.viewClear} />
        <ReadingChip
          label={t('Gap above the screen')}
          value={debug.visibleGapAboveTarget}
        />
        <ReadingChip
          label={t('Tip above screens')}
          value={debug.aboveScreens}
        />
      </div>
      {debug.error && (
        <div className="guided-model-reading-error">{debug.error}</div>
      )}
    </output>
  );
}

/** The model-reported tip, projected onto the overhead frame it was read from. */
export function ReferenceTipMarker({
  correction,
  point,
}: {
  correction: CameraCorrection;
  point: { x: number; y: number };
}) {
  const { sourceWidth, sourceHeight } = correction;
  if (!sourceWidth || !sourceHeight) return null;
  const x = (point.x / 1000) * sourceWidth;
  const y = (point.y / 1000) * sourceHeight;
  const arm = Math.max(Math.min(sourceWidth, sourceHeight) / 40, 12);
  return (
    <svg
      className="camera-mapping-outlines guided-reference-tip"
      viewBox={`0 0 ${sourceWidth} ${sourceHeight}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <circle cx={x} cy={y} r={arm / 2} />
      <line x1={x - arm} y1={y} x2={x + arm} y2={y} />
      <line x1={x} y1={y - arm} x2={x} y2={y + arm} />
    </svg>
  );
}
