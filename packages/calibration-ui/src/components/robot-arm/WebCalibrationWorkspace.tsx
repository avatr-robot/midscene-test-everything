import { Button, Checkbox, Radio, Typography } from 'antd';
import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AssistedCalibrationController } from '../../hooks/useAssistedCalibration';
import { calibrationErrorText, t, useCalibrationLanguage } from '../../i18n';
import {
  type AutomaticExplorationMode,
  type CalibrationProfile,
  calibrationAccepted,
} from '../../robot-arm-api';
import { ExplorationProgress } from './ExplorationProgress';
import { SetupNotice } from './SetupNotice';

export function WebCalibrationWorkspace({
  controller,
  result,
  readyToCapture = true,
  readyToStart = true,
  showSessionCancel = true,
  footer,
  preview,
  controls,
  onActivated,
  onBeforeLeaveChange,
  onReturn,
  completionLabel = 'Back to Overview',
  onCheckCamera,
  onConnectPhone,
}: {
  controller: AssistedCalibrationController;
  result?: CalibrationProfile;
  readyToCapture?: boolean;
  readyToVerify?: boolean;
  readyToStart?: boolean;
  showSessionCancel?: boolean;
  footer: HTMLElement | null;
  preview?: ReactNode;
  controls?: ReactNode;
  onActivated(): Promise<void>;
  onBeforeLeaveChange(handler: (() => Promise<void>) | null): void;
  onReturn?(): void;
  completionLabel?: string;
  onCheckCamera?(): void;
  onConnectPhone?(): void;
}) {
  useCalibrationLanguage((state) => state.language);
  const { session: s, setup, busy, error } = controller;
  const [mode, setMode] = useState<AutomaticExplorationMode>('standard');
  const [confirmed, setConfirmed] = useState(false);
  const [horizontal, setHorizontal] = useState(false);
  const [saveConfirmed, setSaveConfirmed] = useState(false);
  const [reviewStep, setReviewStep] = useState<number>();
  const stage = s?.stage;
  const completed =
    stage === 'completed' || (!s && calibrationAccepted(result));
  const activeMotion =
    stage === 'collecting' || stage === 'safety' || stage === 'returning';
  const command = (
    action: Parameters<typeof controller.command>[0],
    confirm = false,
  ) => void controller.command(action, confirm).catch(() => undefined);
  useEffect(() => {
    setConfirmed(false);
    setSaveConfirmed(false);
    setReviewStep(undefined);
  }, [stage, s?.id]);
  useEffect(() => {
    onBeforeLeaveChange(async () => {
      if (s && !completed && !['cancelled', 'interrupted'].includes(s.stage))
        await controller.command('cancel');
    });
    return () => onBeforeLeaveChange(null);
  }, [s?.id, stage, completed, controller.command, onBeforeLeaveChange]);
  const quality = s?.explorationQuality;
  const steps = [
    'Set a calibration reference position',
    'Collect calibration points',
    'Boundary verification',
    'Set a safe position',
    'Save and Use',
  ];
  const index =
    completed || stage === 'review'
      ? 4
      : stage === 'return-ready' || stage === 'positioning-safe'
        ? 3
        : stage === 'safety' || stage === 'returning'
          ? 2
          : stage === 'collecting' ||
              (stage === 'ready' && s?.referencePosition)
            ? 1
            : 0;
  const canReview = !busy && !activeMotion && stage !== 'positioning-safe';
  const viewed =
    canReview && reviewStep !== undefined ? Math.min(reviewStep, index) : index;
  const reviewing = viewed < index;
  const saved = !s || completed ? result : undefined;
  const pose =
    viewed === 0
      ? s?.referencePosition
      : (s?.safePosition ?? saved?.observationPose);
  const boundary = s?.calibration?.boundary ?? saved?.verification?.boundary;
  const samples = s?.samples ?? saved?.verification?.auto?.samples.length;
  const reviewDetail =
    viewed === 1
      ? samples === undefined
        ? undefined
        : `${t('Samples')} · ${samples}`
      : viewed === 2
        ? boundary
          ? [
              [t('Hover'), boundary.hoverCorners && boundary.hoverEdges],
              [t('Contact'), boundary.contactCorners && boundary.contactEdges],
            ]
              .map(([label, passed]) => `${label} ${passed ? '✓' : '—'}`)
              .join(' · ')
          : undefined
        : pose
          ? ['x', 'y', 'z']
              .map(
                (axis) =>
                  `${axis.toUpperCase()} ${pose.positionMm[axis as 'x' | 'y' | 'z'].toFixed(2)} mm`,
              )
              .join(' · ')
          : undefined;
  const liveActions = completed ? (
    <>
      <Button
        disabled={busy || !readyToStart}
        onClick={() => void controller.create().catch(() => undefined)}
      >
        {t('Restart Calibration')}
      </Button>
      <Button type="primary" onClick={onReturn}>
        {t(completionLabel)}
      </Button>
    </>
  ) : !s ? (
    <Button
      type="primary"
      disabled={busy || !setup.mapping || !readyToStart}
      onClick={() => void controller.create().catch(() => undefined)}
    >
      {t('Start automatic calibration')}
    </Button>
  ) : stage === 'positioning' ? (
    <Button
      type="primary"
      loading={busy}
      onClick={() => command('record-reference', true)}
    >
      {t('Record Reference Position')}
    </Button>
  ) : stage === 'ready' && !s.referencePosition ? (
    <Button
      type="primary"
      disabled={busy || !readyToCapture}
      onClick={() => command('position-reference', true)}
    >
      {t('Enter Drag Mode')}
    </Button>
  ) : stage === 'ready' ? (
    <Button
      type="primary"
      loading={busy}
      disabled={
        !confirmed ||
        (mode !== 'standard' && !horizontal) ||
        !s.phoneConnected ||
        !readyToCapture
      }
      onClick={() =>
        command(
          mode === 'slide'
            ? 'start-slide'
            : mode === 'fast'
              ? 'start-fast'
              : 'start-automatic',
          true,
        )
      }
    >
      {t('Start automatic calibration')}
    </Button>
  ) : stage === 'return-ready' ? (
    <Button
      type="primary"
      disabled={busy || !readyToCapture}
      onClick={() => command('position-safe', true)}
    >
      {t('Enter Drag Mode')}
    </Button>
  ) : stage === 'positioning-safe' ? (
    <Button
      type="primary"
      loading={busy}
      onClick={() => command('record-safe', true)}
    >
      {t('Record Safe Position')}
    </Button>
  ) : stage === 'review' ? (
    <Button
      type="primary"
      loading={busy}
      disabled={!saveConfirmed || !s.phoneConnected}
      onClick={() =>
        void controller
          .command('accept', true)
          .then(onActivated)
          .catch(() => undefined)
      }
    >
      {t('Save and Use')}
    </Button>
  ) : ['cancelled', 'interrupted', 'capture-failed'].includes(stage ?? '') ? (
    <Button
      type="primary"
      disabled={busy || !readyToStart}
      onClick={() => command('restart', true)}
    >
      {t('Restart Calibration')}
    </Button>
  ) : null;
  const actions = (
    <>
      {viewed > 0 && (
        <Button
          className="robot-previous-step"
          disabled={!canReview}
          onClick={() => setReviewStep(viewed - 1)}
        >
          {t('Previous Step')}
        </Button>
      )}
      {reviewing ? (
        <Button
          onClick={() =>
            setReviewStep(viewed + 1 < index ? viewed + 1 : undefined)
          }
        >
          {t('Next')}
        </Button>
      ) : (
        liveActions
      )}
    </>
  );
  return (
    <div className="robot-web-calibration">
      <nav className="robot-web-phases" aria-label={t('Calibration progress')}>
        {steps.map((label, i) => (
          <span key={label} className={i === viewed ? 'current' : ''}>
            {i < index ? '✓' : i + 1} {t(label)}
          </span>
        ))}
      </nav>
      <div className="robot-setup-task-layout">
        <section className="robot-disclosure-body">
          <SetupNotice
            notice={
              error || s?.error
                ? {
                    tone: 'warning',
                    title: calibrationErrorText(error ?? s!.error!),
                  }
                : undefined
            }
          />
          {reviewing ? (
            <>
              <Typography.Title level={4}>{t(steps[viewed])}</Typography.Title>
              <Typography.Paragraph>
                {reviewDetail ?? t('No measurement recorded for this step.')}
              </Typography.Paragraph>
            </>
          ) : (
            <>
              {!s && controls}
              {s && !s.phoneConnected && !completed && (
                <Typography.Paragraph>
                  {t('Phone disconnected')}
                  {onConnectPhone && (
                    <Button onClick={onConnectPhone}>
                      {t('Connect Phone')}
                    </Button>
                  )}
                </Typography.Paragraph>
              )}
              {!setup.mapping && !s?.mapping && onCheckCamera && (
                <Button onClick={onCheckCamera}>
                  {t('Check Camera Mapping')}
                </Button>
              )}
              {(stage === 'positioning' ||
                (stage === 'ready' && !s?.referencePosition)) && (
                <Typography.Paragraph>
                  {t(
                    'Place the stylus 20–50 mm above the center of the screen. Release the robot and record the starting position. Recording does not move the robot.',
                  )}
                </Typography.Paragraph>
              )}
              {stage === 'ready' && s?.referencePosition && (
                <>
                  <Radio.Group
                    value={mode}
                    onChange={(e) => {
                      setMode(e.target.value);
                      setConfirmed(false);
                      setHorizontal(false);
                    }}
                  >
                    <Radio.Button value="standard">
                      {t('Standard probing')}
                    </Radio.Button>
                    <Radio.Button value="fast">
                      {t('Fast probing')}
                    </Radio.Button>
                    <Radio.Button value="slide">
                      {t('Sliding collection')}
                    </Radio.Button>
                  </Radio.Group>
                  <Typography.Paragraph>
                    {t(
                      'Sampling and fitting are followed by automatic hover and contact boundary verification. Record the Safe Position afterwards, then review and save.',
                    )}
                  </Typography.Paragraph>
                  {mode !== 'standard' && (
                    <Checkbox
                      checked={horizontal}
                      onChange={(e) => setHorizontal(e.target.checked)}
                    >
                      {t('The screen is horizontal and securely fixed.')}
                    </Checkbox>
                  )}
                  <Checkbox
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  >
                    {t(
                      'I confirm the setup and clear workspace for sampling and automatic boundary verification.',
                    )}
                  </Checkbox>
                </>
              )}
              {s?.capture && <ExplorationProgress session={s} />}
              {activeMotion && (
                <Typography.Paragraph>
                  {t(
                    stage === 'collecting'
                      ? 'Collect calibration points'
                      : 'Boundary verification',
                  )}
                </Typography.Paragraph>
              )}
              {(stage === 'return-ready' || stage === 'positioning-safe') && (
                <Typography.Paragraph>
                  {t(
                    'Boundary verification is complete. Record a Safe Position clear of the screen and camera; release the robot before recording.',
                  )}
                </Typography.Paragraph>
              )}
              {quality && (
                <Typography.Paragraph>
                  {t(
                    'Grid RMS {0} mm · Holdout maximum {1} mm · Coverage {2}%',
                    [
                      quality.gridRmsMm.toFixed(2),
                      quality.holdoutMaxMm.toFixed(2),
                      Math.round(quality.coverage * 100),
                    ],
                  )}
                </Typography.Paragraph>
              )}
              {stage === 'review' && (
                <Checkbox
                  checked={saveConfirmed}
                  onChange={(e) => setSaveConfirmed(e.target.checked)}
                >
                  {t(
                    'I have reviewed the measurements and confirm the phone, camera and tool have not moved.',
                  )}
                </Checkbox>
              )}
              {completed && (
                <Typography.Paragraph>
                  {t('Calibration complete')}
                </Typography.Paragraph>
              )}
            </>
          )}
          <div className="robot-web-actions">
            {!footer && actions}
            {showSessionCancel &&
              s &&
              !completed &&
              !['cancelled', 'interrupted'].includes(stage ?? '') && (
                <Button
                  danger
                  disabled={busy}
                  onClick={() => command('cancel')}
                >
                  {t('Cancel Calibration')}
                </Button>
              )}
          </div>
        </section>
        <section className="robot-setup-guide-card">
          {preview ?? (
            <Typography.Paragraph>
              {t('Camera preview unavailable')}
            </Typography.Paragraph>
          )}
        </section>
      </div>
      {footer &&
        createPortal(
          <div className="robot-web-actions">{actions}</div>,
          footer,
        )}
    </div>
  );
}
