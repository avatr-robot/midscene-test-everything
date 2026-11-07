import { armUiTheme } from '@midscene/arm-kit-shared';
import type { CameraMappingAccuracy } from '@midscene/arm-kit-shared/assisted-contracts';
import type { CameraCorrection } from '@midscene/arm-kit-shared/contracts';
import {
  Alert,
  Button,
  ConfigProvider,
  Modal,
  Space,
  Spin,
  Steps,
  Typography,
} from 'antd';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { CalibrationPanel } from './CalibrationPanel';
import {
  CalibrationSetup,
  type MeasuredCalibrationSetup,
} from './CalibrationSetup';
import { CameraCornerEditor } from './CameraCornerEditor';
import { CorrectedPreview } from './CorrectedPreview';
import { createCalibrationClient } from './client';
import { CalibrationLanguageProvider, t, useCalibrationLanguage } from './i18n';
import type {
  CalibrationModelConfig,
  CalibrationServerModel,
} from './model-settings';
import { calibrationPowerControl } from './power-state';
import type {
  AssistedCalibrationInput,
  AssistedMappingInput,
  CalibrationProfile,
  EffectiveCapabilities,
} from './robot-arm-api';
import type { RuntimeState } from './robot-arm-api';
import type { CameraProfile } from './types';
import './styles.less';
import './standalone/page.less';
interface Configuration {
  detectionModel?: CalibrationServerModel;
  deviceId: string;
  capabilities: EffectiveCapabilities;
  input?: AssistedCalibrationInput;
  output?: AssistedMappingInput;
  camera: CameraProfile;
  correction?: CameraCorrection;
  correctionOutput?: { width: number; height: number };
  correctionKey?: string;
  result?: CalibrationProfile;
  ready: boolean;
  armState?: RuntimeState;
  editable?: boolean;
  measuredSetup?: MeasuredCalibrationSetup;
}
async function requestAt<T>(
  base: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error?.message ??
        data.error ??
        `Request failed (${response.status})`,
    );
  return data as T;
}
export function CalibrationWorkspace({
  baseUrl = '/api/calibration',
  onComplete,
  embedded = false,
  cancelAction,
}: {
  embedded?: boolean;
  cancelAction?: ReactNode;
  baseUrl?: string;
  onComplete?: () => void;
}) {
  const base = baseUrl.replace(/\/+$/, '');
  const request = useCallback(
    <T,>(path: string, body?: unknown) => requestAt<T>(base, path, body),
    [base],
  );
  const language = useCalibrationLanguage((state) => state.language);
  const setLanguage = useCalibrationLanguage((state) => state.setLanguage);
  const client = useMemo(
    () => createCalibrationClient({ baseUrl: base }),
    [base],
  );
  const [config, setConfig] = useState<Configuration>();
  const [error, setError] = useState<string>();
  const [pollError, setPollError] = useState<string>();
  const [draft, setDraft] = useState<CameraCorrection>();
  const [editingSetup, setEditingSetup] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingFrame, setLoadingFrame] = useState(false);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const [navigation, setNavigation] = useState<HTMLDivElement | null>(null);
  const [panelStep, setPanelStep] = useState(0);
  const checkDraft = useCallback(async () => {
    if (draft)
      return (
        await request<{
          accuracy: CameraMappingAccuracy;
        }>('/camera/check', draft)
      ).accuracy;
  }, [draft, request]);
  const geometry = draft ?? config?.correction;
  const outputSize = config?.correctionOutput ?? config?.output;
  const refresh = useCallback(async () => {
    const next = await request<Configuration>('/configuration');
    setConfig(next);
    setError(undefined);
    setPollError(undefined);
  }, [request]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await request<Configuration>('/configuration');
        if (!disposed) {
          setConfig(next);
          setPollError(undefined);
        }
      } catch (error) {
        if (!disposed)
          setPollError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!disposed) timer = setTimeout(() => void poll(), 2000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [request]);
  const openCorrection = async (path: string, body: unknown = {}) => {
    setLoadingFrame(true);
    try {
      const { sourceWidth, sourceHeight, points, rotation } =
        await request<CameraCorrection>(path, body);
      const correction = { sourceWidth, sourceHeight, points, rotation };
      await refresh();
      setDraft(correction);
    } finally {
      setLoadingFrame(false);
    }
  };
  const detect = async () => {
    await openCorrection('/camera/markers');
  };
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await request('/camera/correction', draft);
      await refresh();
      setDraft(undefined);
    } finally {
      setSaving(false);
    }
  };
  return (
    <ConfigProvider theme={armUiTheme}>
      <CalibrationLanguageProvider>
        <main className={`calibration-page${embedded ? ' is-embedded' : ''}`}>
          <header className="calibration-shell-header">
            <div className="calibration-shell-heading">
              <div>
                <Typography.Text type="secondary">
                  {t('Calibration')}
                </Typography.Text>
                <Typography.Title level={2}>
                  {t(
                    !config?.input || editingSetup
                      ? 'Touch Tool'
                      : [
                          'Connect Phone',
                          'Camera correction',
                          'Arm calibration',
                        ][panelStep],
                  )}
                </Typography.Title>
              </div>
              <Space>
                {cancelAction}
                {!embedded && (
                  <Button
                    onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
                  >
                    {language === 'zh' ? 'English' : '中文'}
                  </Button>
                )}
              </Space>
            </div>
            <div className="calibration-shell-progress" ref={setNavigation}>
              {(!config?.input || editingSetup) && (
                <Steps
                  size="small"
                  current={0}
                  items={[
                    'Touch Tool',
                    'Connect Phone',
                    'Camera correction',
                    'Arm calibration',
                  ].map((title) => ({ title: t(title) }))}
                />
              )}
            </div>
          </header>
          <div className="calibration-shell-body">
            <div className="calibration-shell-content">
              {(error || pollError) && (
                <Alert
                  type="error"
                  showIcon
                  message={error || pollError}
                  action={
                    <Button
                      onClick={() =>
                        void refresh().catch((error) => setError(String(error)))
                      }
                    >
                      {t('Retry')}
                    </Button>
                  }
                />
              )}
              {!config ? (
                !error && !pollError && <Spin />
              ) : !config.input || editingSetup ? (
                <CalibrationSetup
                  footer={footer}
                  capabilities={config.capabilities}
                  initial={config.measuredSetup}
                  onCancel={
                    config.input ? () => setEditingSetup(false) : undefined
                  }
                  onSave={async (input) => {
                    const next = await request<Configuration>(
                      '/configuration',
                      input,
                    );
                    setConfig(next);
                    setEditingSetup(false);
                  }}
                />
              ) : (
                <CalibrationPanel
                  showSessionCancel={cancelAction === undefined}
                  footerContainer={footer}
                  navigationContainer={navigation}
                  onStepChange={setPanelStep}
                  onEditSetup={() => {
                    if (config.editable) {
                      setDraft(undefined);
                      setEditingSetup(true);
                    }
                  }}
                  controls={
                    !config.ready ? (
                      <CalibrationPowerButton
                        config={config}
                        apply={async (action) => {
                          const next = await request<Configuration>(
                            `/${action}`,
                            {
                              confirmed: true,
                            },
                          );
                          setConfig(next);
                        }}
                      />
                    ) : undefined
                  }
                  client={client}
                  {...config}
                  preview={
                    <img
                      className="calibration-preview"
                      src={`${base}/camera/preview`}
                      alt={config.camera.name}
                    />
                  }
                  mappingPreview={
                    geometry && (
                      <CameraCornerEditor
                        value={geometry}
                        src={`${base}/camera/preview`}
                        disabled={!config.editable || saving || loadingFrame}
                        onDragging={setDragging}
                        onChange={setDraft}
                      />
                    )
                  }
                  outputSize={outputSize}
                  correctedPreview={
                    geometry &&
                    outputSize && (
                      <CorrectedPreview
                        correction={geometry}
                        size={outputSize}
                        src={`${base}/camera/preview`}
                      />
                    )
                  }
                  checkDraft={
                    draft && !dragging && !loadingFrame ? checkDraft : undefined
                  }
                  onConfirmMapping={save}
                  savingMapping={saving}
                  onDetect={detect}
                  onDetectAI={(modelConfig?: CalibrationModelConfig) =>
                    openCorrection('/camera/detect', { modelConfig })
                  }
                  editing={Boolean(draft)}
                  onComplete={onComplete}
                  completionLabel={
                    embedded ? 'Open Workspace' : 'Finish Calibration'
                  }
                />
              )}
            </div>
          </div>
          <footer className="calibration-shell-footer">
            <div className="arm-calibration-footer" ref={setFooter} />
          </footer>
        </main>
      </CalibrationLanguageProvider>
    </ConfigProvider>
  );
}

function CalibrationPowerButton({
  config,
  apply,
}: {
  config: Configuration;
  apply: (action: 'enable' | 'payload' | 'recover') => Promise<void>;
}) {
  const control = calibrationPowerControl(
    config.armState,
    config.capabilities,
    Boolean(config.editable),
  );
  const label =
    control.action === 'recover'
      ? 'Check Recovery'
      : control.action === 'payload'
        ? 'Sync Tool Payload'
        : 'Enable Robot';
  const [confirming, setConfirming] = useState<typeof control.action>();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();
  const stale = confirming !== undefined && confirming !== control.action;
  return (
    <>
      <Button
        disabled={control.disabled || pending}
        onClick={() => {
          setFailure(undefined);
          setConfirming(control.action);
        }}
      >
        {t(label)}
      </Button>
      <Modal
        title={t(label)}
        open={confirming !== undefined}
        confirmLoading={pending}
        closable={!pending}
        maskClosable={!pending}
        cancelButtonProps={{ disabled: pending }}
        okButtonProps={{ disabled: control.disabled || stale }}
        onCancel={() => {
          if (!pending) setConfirming(undefined);
        }}
        onOk={async () => {
          if (!confirming || pending || control.disabled || stale) return;
          setPending(true);
          setFailure(undefined);
          try {
            await apply(confirming);
            setConfirming(undefined);
          } catch (error) {
            setFailure(error instanceof Error ? error.message : String(error));
          } finally {
            setPending(false);
          }
        }}
      >
        <Typography.Paragraph>
          {t(
            confirming === 'recover'
              ? 'Check recovery while the robot is stationary and fault-free. This does not enable or move the robot.'
              : confirming === 'payload'
                ? 'Sync saved tool payload without disabling the robot?'
                : 'Confirm the tool configuration and ensure the workspace is clear before enabling the robot.',
          )}
        </Typography.Paragraph>
        {stale && (
          <Alert
            type="warning"
            showIcon
            message={t(
              'Robot state changed. Close this dialog and confirm the current operation again.',
            )}
          />
        )}
        {failure && <Alert type="error" showIcon message={failure} />}
      </Modal>
    </>
  );
}
