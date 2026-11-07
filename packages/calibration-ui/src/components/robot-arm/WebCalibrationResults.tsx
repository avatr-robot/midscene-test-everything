import { Progress, Table, Typography } from 'antd';
import { t, useCalibrationLanguage } from '../../i18n';
import {
  CALIBRATION_CLICK_COUNT,
  CALIBRATION_CLICK_RADIUS_PX,
  CALIBRATION_CLICK_REQUIRED,
  type WebVerificationAttempt,
  type WebVerificationResult,
} from '../../robot-arm-api';

/** Renders the same measured evidence for a live session and a saved result. */
export function WebCalibrationResults({
  attempts,
  results,
  phase,
}: {
  attempts: WebVerificationAttempt[];
  results: WebVerificationResult[];
  phase: 'verifying' | 'review' | 'completed' | 'failed';
}) {
  useCalibrationLanguage((state) => state.language);
  const rows = attempts;
  const count = CALIBRATION_CLICK_COUNT;
  const hits = rows.filter((r) => r.hit).length;
  return (
    <>
      <Typography.Title level={5}>
        {t(
          phase === 'failed'
            ? 'Click verification failed'
            : phase === 'completed'
              ? 'Calibration complete'
              : phase === 'review'
                ? 'Review measured clicks'
                : 'Verifying clicks',
        )}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        {t(
          'Verify 15 random circles; all 15 must be hit. Each circle is 26 CSS px in diameter; any click inside it counts.',
        )}
      </Typography.Paragraph>
      <Typography.Paragraph>
        {t('Hit')}: {hits} / {rows.length} · {t('Hit rate')}:{' '}
        {rows.length ? Math.round((hits / rows.length) * 100) : 0}% ·{' '}
        {t('Required hits')}: {CALIBRATION_CLICK_REQUIRED} / {count}
      </Typography.Paragraph>
      {results.length > 0 && (
        <Typography.Text>
          {t('Maximum landing error: {0} CSS px', [
            Math.max(...results.map((r) => r.errorPx)).toFixed(1),
          ])}
        </Typography.Text>
      )}
      <Progress
        percent={Math.round((rows.length / count) * 100)}
        status={
          phase === 'failed'
            ? 'exception'
            : phase === 'verifying'
              ? 'active'
              : 'success'
        }
      />
      <details className="calibration-result-details">
        <summary>{t('View individual click results')}</summary>
        <Table
          size="small"
          pagination={false}
          scroll={{ y: 200 }}
          rowKey="id"
          dataSource={rows}
          columns={[
            { title: t('Target'), render: (_v, _r, i) => i + 1 },
            {
              title: 'Δx / Δy (CSS px)',
              render: (_v, r) => {
                const sample = results.find((p) => p.id === r.id);
                return sample
                  ? `${(sample.actual.x - r.target.x).toFixed(1)} / ${(sample.actual.y - r.target.y).toFixed(1)}`
                  : '—';
              },
            },

            {
              title: t('Result'),
              render: (_v, r) => t(r.hit ? 'Hit' : 'Miss'),
            },
          ]}
        />
      </details>
      <Typography.Paragraph type="secondary">
        {t(
          'These measurements cover the web viewport. System bars use the fitted full-screen mapping and are not directly touch-verified by this page.',
        )}
      </Typography.Paragraph>
    </>
  );
}

export function ClickMap({
  layout,
  attempts,
  results,
}: {
  layout: { width: number; height: number };
  attempts: WebVerificationAttempt[];
  results: WebVerificationResult[];
}) {
  return (
    <svg
      className="calibration-click-map"
      viewBox={`-8 -8 ${layout.width + 16} ${layout.height + 16}`}
      role="img"
      aria-label={t('Target circles and measured landings')}
    >
      <rect
        width={layout.width}
        height={layout.height}
        rx={12}
        fill="var(--midscene-surface)"
        stroke="var(--rv-border)"
        strokeWidth={2}
      />
      {attempts.map(({ id, target, hit }) => (
        <circle
          key={id}
          cx={target.x}
          cy={target.y}
          r={CALIBRATION_CLICK_RADIUS_PX}
          fill="none"
          stroke={hit ? 'var(--rv-accent)' : '#b14a2c'}
          strokeWidth={2}
        />
      ))}
      {results.map(({ id, target, actual }) => (
        <g key={id}>
          <line
            x1={target.x}
            y1={target.y}
            x2={actual.x}
            y2={actual.y}
            stroke="currentColor"
          />
          <circle cx={actual.x} cy={actual.y} r={3} fill="currentColor" />
        </g>
      ))}
    </svg>
  );
}
