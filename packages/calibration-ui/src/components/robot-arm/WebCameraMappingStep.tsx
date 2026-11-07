import type { CameraMappingAccuracy } from '@midscene/arm-kit-shared/assisted-contracts';
import { Button, Spin } from 'antd';
import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AssistedCalibrationController } from '../../hooks/useAssistedCalibration';
import { useCameraMarkerMapping } from '../../hooks/useCameraMarkerMapping';
import { calibrationErrorText, t, useCalibrationLanguage } from '../../i18n';
import {
  type CalibrationModelConfig,
  type CalibrationServerModel,
  clearDetectionModel,
  emptyModel,
  loadDetectionModel,
  saveDetectionModel,
} from '../../model-settings';
import type {
  AssistedCalibrationInput,
  AssistedMappingInput,
} from '../../robot-arm-api';
import type { CameraProfile } from '../../types';
import { CalibrationModelModal } from '../CalibrationModelModal';

export function WebCameraMappingStep({
  controller,
  camera,
  live,
  corrected,
  size,
  footer,
  onDetect,
  onDetectAI,
  detectionModel,

  onPair,
  onContinue,
  output,
  input,
  correctionKey,
  editing = false,
  hasCorners = false,
  checkDraft,
  onConfirm,
  saving = false,
}: {
  input?: AssistedCalibrationInput;
  output?: AssistedMappingInput;
  /** Saved correction geometry and capture settings, not the editor draft. */
  correctionKey?: string;
  editing?: boolean;
  hasCorners?: boolean;
  checkDraft?(): Promise<CameraMappingAccuracy | undefined>;
  onConfirm?(): Promise<void>;
  saving?: boolean;
  controller: AssistedCalibrationController;
  camera?: CameraProfile;
  live?: ReactNode;
  corrected?: ReactNode;
  size?: { width: number; height: number };
  footer: HTMLElement | null;
  onDetect?(): Promise<void>;
  onDetectAI?(modelConfig?: CalibrationModelConfig): Promise<void>;
  detectionModel?: CalibrationServerModel;
  onPair(): void;
  onContinue(): void;
}) {
  useCalibrationLanguage((state) => state.language);
  const [detecting, setDetecting] = useState(false);
  const [continueRequested, setContinueRequested] = useState(false);
  const [error, setError] = useState<string>();
  const { setup, busy } = controller;
  const [attemptedCamera, setAttemptedCamera] = useState<string>();
  const [detectionKind, setDetectionKind] = useState<'markers' | 'ai'>(
    'markers',
  );
  const [rememberedModel] = useState(loadDetectionModel);
  const [model, setModel] = useState(rememberedModel?.config ?? emptyModel());
  const [customModel, setCustomModel] = useState(
    rememberedModel?.custom ?? !detectionModel?.modelName,
  );
  const [modelOpen, setModelOpen] = useState(false);
  const [modelStorageError, setModelStorageError] = useState<string>();
  const [detectAfterSettings, setDetectAfterSettings] = useState(false);
  const autoDetectPending = Boolean(
    onDetect &&
      camera?.online &&
      setup.phoneConnected &&
      setup.layout?.screen &&
      !editing &&
      !hasCorners &&
      attemptedCamera !== camera.id,
  );
  const { mapped, mappingBusy, mappingError, canMap, retry } =
    useCameraMarkerMapping({
      controller,
      camera,
      output,
      input,
      correctionKey,
      blocked:
        editing || detecting || saving || autoDetectPending || Boolean(error),
    });
  useEffect(() => {
    if (
      continueRequested &&
      mapped &&
      !editing &&
      !saving &&
      !busy &&
      !mappingBusy
    ) {
      setContinueRequested(false);
      onContinue();
    }
  }, [
    continueRequested,
    mapped,
    editing,
    saving,
    busy,
    mappingBusy,
    onContinue,
  ]);
  const check =
    setup.phoneConnected && camera?.online && !saving && !detecting
      ? checkDraft
      : undefined;
  const layoutKey = JSON.stringify([
    camera?.id,
    setup.layout,
    size?.width,
    size?.height,
  ]);
  const [result, setResult] = useState<{
    check: typeof check;
    layoutKey: string;
    accuracy?: CameraMappingAccuracy;
    error?: string;
  }>();
  useEffect(() => {
    if (!check) return;
    let active = true;
    const timer = setTimeout(run, 400);
    async function run() {
      try {
        const accuracy = await check!();
        if (active) setResult({ check, layoutKey, accuracy });
      } catch (cause) {
        if (!active) return;
        const error = cause instanceof Error ? cause.message : String(cause);
        setResult({ check, layoutKey, error });
      }
    }
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [check, layoutKey]);
  const current =
    check && result?.check === check && result.layoutKey === layoutKey
      ? result
      : undefined;
  const problem =
    error ??
    (editing ? current?.error : mappingError) ??
    controller.connectionError;
  const verified = editing ? Boolean(current && !current.error) : mapped;
  const accuracy = editing ? current?.accuracy : setup.mapping?.accuracy;
  const confirm = async () => {
    setError(undefined);
    try {
      if (!setup.phoneConnected) {
        if (editing) await onConfirm?.();
        onPair();
        return;
      }
      if (editing) {
        await onConfirm?.();
        retry();
        setContinueRequested(true);
      } else if (verified) {
        onContinue();
      } else {
        retry();
        setContinueRequested(true);
      }
    } catch (error) {
      setContinueRequested(false);
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  const detect = async (
    kind: 'markers' | 'ai' = 'markers',
    override?: CalibrationModelConfig,
  ) => {
    setAttemptedCamera(camera?.id);
    setDetectionKind(kind);
    setContinueRequested(false);
    setDetecting(true);
    setError(undefined);
    try {
      if (kind === 'ai') await onDetectAI?.(override);
      else await onDetect?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetecting(false);
    }
  };
  const detectAI = () => {
    if (
      customModel
        ? !model.modelName.trim() || !model.modelFamily.trim()
        : !detectionModel?.modelName
    ) {
      setDetectAfterSettings(true);
      setModelOpen(true);
    } else void detect('ai', customModel ? model : undefined);
  };
  useEffect(() => {
    if (!autoDetectPending || !canMap || busy || mappingBusy || detecting)
      return;
    void detect();
  }, [autoDetectPending, canMap, busy, mappingBusy, detecting]);
  return (
    <div className="robot-camera-mapping-header">
      <section className="robot-disclosure-body">
        <div className="robot-web-section-heading">
          <strong>{camera?.name}</strong>
          <span>
            {controller.phone.model ?? t('Phone')} ·{' '}
            {t(setup.phoneConnected ? 'Phone connected' : 'Connect Phone')}
          </span>
        </div>
        <div className="screen-range-card">
          <section>
            <header>
              <strong>{t('Live Preview')}</strong>
              <div className="range-actions">
                <Button
                  size="small"
                  loading={detecting && detectionKind === 'markers'}
                  disabled={
                    detecting ||
                    !onDetect ||
                    !camera?.online ||
                    !setup.phoneConnected ||
                    !canMap ||
                    busy ||
                    saving ||
                    mappingBusy
                  }
                  onClick={() => void detect()}
                >
                  {t('Detect screen markers')}
                </Button>
                {onDetectAI && (
                  <Button
                    size="small"
                    loading={detecting && detectionKind === 'ai'}
                    disabled={
                      !camera?.online ||
                      detecting ||
                      busy ||
                      saving ||
                      mappingBusy ||
                      !canMap
                    }
                    onClick={detectAI}
                  >
                    {t('Use AI detection')}
                  </Button>
                )}
                {onDetectAI && (
                  <Button
                    size="small"
                    type="text"
                    disabled={detecting || saving || busy}
                    onClick={() => {
                      setDetectAfterSettings(false);
                      setModelOpen(true);
                    }}
                  >
                    {t('AI model settings')}
                  </Button>
                )}
              </div>
            </header>
            <div className="screen-range-stage">{live}</div>
          </section>
          <section>
            <header>
              <strong>{t('Corrected View')}</strong>
              {size && (
                <small>
                  {size.width} × {size.height} px
                </small>
              )}
            </header>
            <div className="screen-range-stage">{corrected}</div>
          </section>
        </div>
        {hasCorners && (
          <span className="range-check-status">
            {t(
              'Drag the four corners to include the full display and system bars.',
            )}
          </span>
        )}
        <output className="range-check-status">
          {error ? (
            <span className="is-warning">{calibrationErrorText(error)}</span>
          ) : !setup.phoneConnected ? (
            <>
              {t(
                'No phone page is connected. Use AI detection to locate the screen, then connect the phone before arm calibration.',
              )}{' '}
              <Button type="link" size="small" onClick={onPair}>
                {t('Connect Phone')}
              </Button>
            </>
          ) : problem ? (
            <span className="is-warning">{calibrationErrorText(problem)}</span>
          ) : verified ? (
            <span className="is-success">
              ✓{' '}
              {t(
                'Page marker fit verified; screen edges require visual confirmation',
              )}
              {accuracy &&
                ` · ${t('{0} fit markers · {1} held out · maximum {2} CSS px', [
                  accuracy.fit.count,
                  accuracy.validation.count,
                  accuracy.validation.maxErrorCssPx.toFixed(2),
                ])}`}
            </span>
          ) : check || mappingBusy ? (
            <>
              <Spin size="small" /> {t('Checking page markers…')}
            </>
          ) : null}
        </output>
        {onDetectAI &&
          problem &&
          setup.phoneConnected &&
          detectionKind === 'markers' &&
          !detecting && (
            <span className="range-check-status">
              {t(
                'Page detection is unavailable or inaccurate? Use AI detection, then check the screen edges.',
              )}
            </span>
          )}
        {verified && (
          <span className="range-check-status">
            {t(
              'Check all four display edges, including the system bars, before continuing.',
            )}
          </span>
        )}
      </section>
      <CalibrationModelModal
        open={modelOpen}
        title={t('AI model settings')}
        description={t(
          'AI detection uses a camera image to locate the full screen. Check the corners before saving.',
        )}
        serverModel={detectionModel}
        value={model}
        custom={customModel}
        onClose={() => setModelOpen(false)}
        error={modelStorageError}
        persistenceNotice={t(
          'Model settings, including the API key, are saved in this browser. Clear them here when no longer needed.',
        )}
        onClear={() => {
          try {
            clearDetectionModel();
            setModelStorageError(undefined);
          } catch {
            setModelStorageError(
              t('Unable to clear saved model settings in this browser.'),
            );
            return;
          }
          setModel(emptyModel());
          setCustomModel(false);
        }}
        onApply={(config, custom) => {
          try {
            saveDetectionModel(config, custom);
            setModelStorageError(undefined);
          } catch {
            setModelStorageError(
              t('Unable to save model settings in this browser.'),
            );
            return;
          }
          setModel(config);
          setCustomModel(custom);
          setModelOpen(false);
          if (detectAfterSettings)
            void detect('ai', custom ? config : undefined);
        }}
      />
      {footer &&
        createPortal(
          <Button
            type="primary"
            loading={saving || (continueRequested && mappingBusy)}
            disabled={
              (!editing &&
                ((!verified && !(mappingError && canMap)) ||
                  !setup.phoneConnected)) ||
              !hasCorners ||
              busy ||
              mappingBusy ||
              detecting ||
              saving
            }
            onClick={() => void confirm()}
          >
            {t(mappingError && !editing ? 'Retry and continue' : 'Continue')}
          </Button>,
          footer,
        )}
    </div>
  );
}
