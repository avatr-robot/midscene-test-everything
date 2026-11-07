import { Alert, Button, Empty, Segmented, Spin, Tag, Typography } from 'antd';
import { Drawer, Modal, Tooltip } from 'antd';
import {
  ArrowRightLeft,
  Cable,
  Play,
  RefreshCw,
  ScanLine,
  Settings2,
  StopCircle,
  Unplug,
  VideoOff,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { type CameraView, cameraPreviewUrl } from '../camera-preview';
import { cameraStateLabel, useCameras } from '../cameras';
import { useConnection } from '../connection';
import { useViews } from '../extensions';
import { useDeviceReadiness } from '../hooks/useDeviceReadiness';
import { useRobotArm } from '../hooks/useRobotArm';
import { usePreferences, useT } from '../i18n';
import { CameraRail } from './CameraRail';
import { DeviceCalibration } from './DeviceCalibration';
import { DeviceTransfer } from './DeviceTransfer';
import { RobotReadinessCard } from './RobotReadinessCard';
import { TaskWorkspace } from './TaskWorkspace';
import { ActionAudit } from './robot-arm/ActionAudit';
import { ControllerMotionSettings } from './robot-arm/ControllerMotionSettings';
import { DeviceSettings } from './robot-arm/DeviceSettings';
import { RobotStatusBar } from './robot-arm/RobotStatusBar';
import './CameraStage.less';

export function DeviceWorkspace() {
  const t = useT();
  const { ConnectionForm } = useViews();
  const arm = useRobotArm();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const language = usePreferences((state) => state.language);
  const [configurationRevision, setConfigurationRevision] = useState(0);
  const [calibrationId, setCalibrationId] = useState<string>();
  const [transferId, setTransferId] = useState<string>();
  const [preferredView, setCameraView] = useState<CameraView>('corrected');
  const [previewError, setPreviewError] = useState<string>();
  const [previewRevision, setPreviewRevision] = useState(0);
  const {
    cameras,
    selectedId,
    select,
    status,
    refresh,
    start,
    stop,
    pendingId,
    error,
  } = useCameras();
  const closeCalibration = useCallback(() => {
    setCalibrationId(undefined);
    setConfigurationRevision((value) => value + 1);
    void refresh();
  }, [refresh]);
  const { host, disconnect } = useConnection();
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (
      status === 'loading' ||
      !cameras.some((camera) => camera.stream?.state === 'starting')
    )
      return;
    const timer = setTimeout(() => void refresh(false), 500);
    return () => clearTimeout(timer);
  }, [cameras, status, refresh]);
  const selected = cameras.find((camera) => camera.id === selectedId);
  const running = selected?.stream?.state === 'running';
  const starting = selected?.stream?.state === 'starting';
  const cameraActionLabel = t(
    starting ? 'cameraStarting' : running ? 'stopCamera' : 'startCamera',
  );
  const readiness = useDeviceReadiness(selected?.id, configurationRevision);
  const ready = readiness?.status === 'ready';
  const cameraView = ready ? preferredView : 'raw';
  const previewKey = `${selectedId}:${cameraView}:${previewRevision}`;
  return (
    <>
      <RobotStatusBar
        key={selectedId ?? 'no-camera'}
        cameraId={selectedId ?? undefined}
        onConfigure={() => {
          if (selectedId) setCalibrationId(selectedId);
        }}
        preparing={!ready}
        settings={
          <Button
            type="text"
            disabled={Boolean(calibrationId)}
            icon={<Settings2 size={16} />}
            onClick={() => setSettingsOpen(true)}
          >
            {language === 'zh' ? '机械臂配置' : 'Robot settings'}
          </Button>
        }
      />
      {calibrationId ? (
        <DeviceCalibration id={calibrationId} onClose={closeCalibration} />
      ) : selected ? (
        <main className="app-workspace">
          <section className="streams-section">
            <section className="camera-stage">
              <header className="camera-stage-header">
                <div className="camera-stage-title">
                  <Typography.Title level={4} style={{ margin: 0 }}>
                    {selected.name}
                  </Typography.Title>
                  <div className="camera-stage-meta">
                    <Tag
                      color={
                        selected.stream?.state === 'running'
                          ? 'green'
                          : undefined
                      }
                    >
                      {t(cameraStateLabel(selected))}
                    </Tag>
                    <Typography.Text type="secondary">
                      {selected.stream
                        ? `${selected.stream.width} × ${selected.stream.height}`
                        : t('noStream')}
                    </Typography.Text>
                  </div>
                </div>
                <div className="camera-stage-actions">
                  {ready && (
                    <Segmented
                      className="rv-segmented"
                      aria-label={
                        language === 'zh' ? '画面类型' : 'Camera view'
                      }
                      value={cameraView}
                      onChange={(value) => setCameraView(value as CameraView)}
                      options={[
                        {
                          value: 'raw',
                          label: language === 'zh' ? '原始画面' : 'Original',
                        },
                        {
                          value: 'corrected',
                          label: language === 'zh' ? '校正画面' : 'Corrected',
                        },
                      ]}
                    />
                  )}
                  <Tooltip title={t('refresh')}>
                    <Button
                      type="text"
                      aria-label={t('refresh')}
                      icon={<RefreshCw size={16} />}
                      loading={status === 'loading'}
                      onClick={() => {
                        setPreviewRevision((value) => value + 1);
                        void refresh();
                      }}
                    />
                  </Tooltip>
                  <Tooltip title={cameraActionLabel}>
                    <Button
                      type="text"
                      aria-label={cameraActionLabel}
                      icon={
                        running ? <StopCircle size={16} /> : <Play size={16} />
                      }
                      loading={starting || pendingId === selected.id}
                      onClick={() => {
                        setPreviewError(undefined);
                        void (running ? stop(selected.id) : start(selected.id));
                      }}
                    />
                  </Tooltip>
                </div>
              </header>
              <div className="camera-stage-preview">
                {selected.stream?.state === 'running' &&
                previewError === previewKey ? (
                  <Empty
                    description={
                      language === 'zh'
                        ? '画面加载失败，请刷新重试'
                        : 'Preview unavailable. Refresh to retry.'
                    }
                  />
                ) : selected.stream?.state === 'running' ? (
                  <img
                    key={previewKey}
                    className="stream-preview"
                    src={cameraPreviewUrl(selected.id, cameraView)}
                    onError={() => setPreviewError(previewKey)}
                    alt={selected.name}
                  />
                ) : starting ? (
                  <Spin aria-label={t('cameraStarting')} />
                ) : (
                  <>
                    <VideoOff size={40} strokeWidth={1.25} />
                    <span>{t('noStream')}</span>
                  </>
                )}
              </div>
              {(error || selected.error || selected.stream?.error) && (
                <Typography.Text type="danger" role="alert">
                  {error || selected.error || selected.stream?.error}
                </Typography.Text>
              )}
              <CameraRail
                entries={cameras}
                selectedId={selectedId}
                onSelect={select}
              />
            </section>
          </section>
          <aside className="workstation-playground">
            <div className="task-panel">
              {ready ? (
                <TaskWorkspace cameraId={selected.id} />
              ) : readiness?.status === 'required' ? (
                <RobotReadinessCard
                  camera={selected}
                  onOpenSetup={() => setCalibrationId(selected.id)}
                />
              ) : readiness?.status === 'error' ? (
                <Alert
                  type="error"
                  showIcon
                  message={
                    language === 'zh'
                      ? '无法检查设备标定'
                      : 'Unable to check calibration'
                  }
                  description={readiness.error}
                  action={
                    <Button
                      onClick={() =>
                        setConfigurationRevision((value) => value + 1)
                      }
                    >
                      {language === 'zh' ? '重试' : 'Retry'}
                    </Button>
                  }
                />
              ) : (
                <Spin
                  aria-label={
                    language === 'zh' ? '检查设备标定' : 'Checking calibration'
                  }
                />
              )}
            </div>
          </aside>
        </main>
      ) : (
        <section className="camera-empty">
          <Empty
            description={
              status === 'loading' ? t('loadingCameras') : t('noCameras')
            }
          />
          <Button
            icon={<RefreshCw size={16} />}
            loading={status === 'loading'}
            onClick={() => void refresh()}
          >
            {t('refresh')}
          </Button>
          {error && <Typography.Text type="danger">{error}</Typography.Text>}
        </section>
      )}
      <Drawer
        rootClassName="robot-drawer robot-settings-drawer"
        title={language === 'zh' ? '机械臂配置' : 'Robot settings'}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        width={440}
        footer={
          <Button danger block icon={<Unplug size={16} />} onClick={disconnect}>
            {t('disconnect')}
          </Button>
        }
      >
        <div className="robot-panel">
          <div className="robot-panel-heading">
            <Cable size={19} />
            <div className="robot-panel-identity">
              <Typography.Text strong>{arm.adapter?.name}</Typography.Text>
              <Typography.Text type="secondary">{host}</Typography.Text>
            </div>
            <Tag color="green">{t('connected')}</Tag>
          </div>
          {(selected || ConnectionForm) && (
            <section className="robot-settings-group">
              <Typography.Text type="secondary">
                {language === 'zh' ? '连接与标定' : 'Connection & calibration'}
              </Typography.Text>
              {selected && (
                <Button
                  icon={<ScanLine size={19} />}
                  onClick={() => {
                    setSettingsOpen(false);
                    setCalibrationId(selected.id);
                  }}
                >
                  {language === 'zh' ? '屏幕标定' : 'Screen Calibration'}
                </Button>
              )}
              {selected && cameras.length > 1 && (
                <Button
                  icon={<ArrowRightLeft size={18} />}
                  onClick={() => setTransferId(selected.id)}
                >
                  {t('transferTitle')}
                </Button>
              )}
              {ConnectionForm && (
                <Button
                  icon={<Cable size={18} />}
                  onClick={() => setConnectionOpen(true)}
                >
                  {language === 'zh' ? '连接配置' : 'Connection settings'}
                </Button>
              )}
            </section>
          )}
          <section className="robot-settings-group">
            <Typography.Text type="secondary">
              {language === 'zh' ? '运动与记录' : 'Motion & history'}
            </Typography.Text>
            <ControllerMotionSettings arm={arm} />
            <ActionAudit />
            {selected && (
              <DeviceSettings
                key={`${selected.id}:${configurationRevision}`}
                id={selected.id}
              />
            )}
          </section>
        </div>
      </Drawer>
      <Modal
        open={connectionOpen}
        onCancel={() => {
          if (!arm.busy) setConnectionOpen(false);
        }}
        footer={null}
        className="robot-settings-detail"
        width={680}
        title={
          <>
            <Cable size={18} />
            {language === 'zh' ? '连接配置' : 'Connection settings'}
          </>
        }
      >
        {ConnectionForm && (
          <ConnectionForm
            arm={arm}
            footer={null}
            onContinue={() => setConnectionOpen(false)}
          />
        )}
      </Modal>
      {transferId && (
        <DeviceTransfer
          key={transferId}
          id={transferId}
          cameras={cameras}
          onClose={() => setTransferId(undefined)}
        />
      )}
    </>
  );
}
