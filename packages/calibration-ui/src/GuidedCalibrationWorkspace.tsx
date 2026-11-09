import { armUiTheme } from '@midscene/arm-kit-shared';
import type {
  CalibrationBatchState,
  WorkstationScreenState,
} from '@midscene/arm-kit-shared/assisted-contracts';
import type { CameraCorrection } from '@midscene/arm-kit-shared/contracts';
import type {
  DetectionFrame,
  MarkerCalibrationCreateResult,
  MarkerCalibrationDetectionResponse,
  MarkerCalibrationTarget,
} from '@midscene/arm-kit-shared/marker-contracts';
import {
  Alert,
  App,
  Button,
  ConfigProvider,
  Modal,
  Select,
  Space,
  Spin,
  Steps,
  Typography,
} from 'antd';
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CalibrationSetup } from './CalibrationSetup';
import {
  CalibrationPowerButton,
  type Configuration,
} from './CalibrationWorkspace';
import { CameraCornerEditor } from './CameraCornerEditor';
import { CorrectedPreview } from './CorrectedPreview';
import { BatchClient } from './batch-client';
import { createCalibrationClient } from './client';
import { MarkerCalibrationDialog } from './components/MarkerCalibrationDialog';
import { MultiScreenCalibrationReviewDialog } from './components/MultiScreenCalibrationReviewDialog';
import { PerspectiveObservationCard } from './components/PerspectiveObservationCard';
import {
  CalibrationBatchPanel,
  type CalibrationBatchPanelHandle,
} from './components/robot-arm/CalibrationBatchPanel';
import { ExplorationProgress } from './components/robot-arm/ExplorationProgress';
import { InstallationTeaching } from './components/robot-arm/InstallationTeaching';
import { PhoneConnectDialog } from './components/robot-arm/PhoneConnectDialog';
import { WebCalibrationWorkspace } from './components/robot-arm/WebCalibrationWorkspace';
import { useAssistedCalibration } from './hooks/useAssistedCalibration';
import { useCameraPhoneReadiness } from './hooks/useCameraPhoneReadiness';
import { usePerspectiveValidity } from './hooks/usePerspectiveValidity';
import { CalibrationLanguageProvider, t, useLanguage } from './i18n';
import {
  RobotVisionClient,
  ScreenCalibClient,
  markerRequest,
} from './marker-client';
import { TeachingClient } from './teaching-client';
import './styles.less';
import './standalone/page.less';
import './migrated-calibration.less';
interface BoundScreen {
  id: string;
  cameraId: string;
  name: string;
  pageKey?: string;
  hasCorrection?: boolean;
  markerSlot?: number;
}

/** The original camera → teaching → calibration flow inside the host's wizard. */
export function GuidedCalibrationWorkspace({
  id,
  cameraId,
  onClose,
  initialStep = 0,
}: { id: string; cameraId: string; onClose(): void; initialStep?: 0 | 1 }) {
  return (
    <ConfigProvider theme={armUiTheme}>
      <App className="guided-calibration-root">
        <CalibrationLanguageProvider>
          <GuidedContent
            id={id}
            cameraId={cameraId}
            onClose={onClose}
            initialStep={initialStep}
          />
        </CalibrationLanguageProvider>
      </App>
    </ConfigProvider>
  );
}
function GuidedContent({
  id,
  cameraId,
  onClose,
  initialStep,
}: { id: string; cameraId: string; onClose(): void; initialStep: 0 | 1 }) {
  useLanguage();
  const [selectedId, setSelectedId] = useState(id);
  const [step, setStep] = useState<number>(initialStep);
  const initialStepPending = useRef(initialStep === 1);
  const [config, setConfig] = useState<Configuration>();
  const [screens, setScreens] = useState<BoundScreen[]>([]);
  const [states, setStates] = useState<WorkstationScreenState[]>([]);
  const [error, setError] = useState<string>();
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const [phonesOpen, setPhonesOpen] = useState(false);
  const [markerOpen, setMarkerOpen] = useState(initialStep === 1);
  const [retryId, setRetryId] = useState<string>();
  const [markerSession, setMarkerSession] =
    useState<MarkerCalibrationCreateResult>();
  const [review, setReview] = useState<MarkerCalibrationDetectionResponse>();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewing, setReviewing] = useState<{
    target: MarkerCalibrationTarget;
    frame?: DetectionFrame;
  }>();
  const [applying, setApplying] = useState(false);
  const [batch, setBatch] = useState<CalibrationBatchState | null>();
  const [batchActive, setBatchActive] = useState(false);
  const [singleActive, setSingleActive] = useState(false);
  const [singleQueued, setSingleQueued] = useState(false);
  const singlePending = useRef(false);
  const batchPanel = useRef<CalibrationBatchPanelHandle>(null);
  const batchClient = useMemo(() => new BatchClient(cameraId), [cameraId]);
  const markerClient = useMemo(
    () => new RobotVisionClient(cameraId),
    [cameraId],
  );
  const pageClient = useMemo(() => new ScreenCalibClient(cameraId), [cameraId]);
  const base = `/api/devices/${encodeURIComponent(selectedId)}/calibration`;
  const client = useMemo(
    () => createCalibrationClient({ baseUrl: base }),
    [base],
  );
  const controller = useAssistedCalibration(client, selectedId, !batchActive);
  const teaching = useMemo(
    () =>
      config?.input
        ? new TeachingClient(base, {
            ...config.input,
            screenProfileId: selectedId,
          })
        : undefined,
    [
      base,
      config?.input?.robotProfileId,
      config?.input?.toolProfileId,
      cameraId,
      selectedId,
    ],
  );
  const savedScreens = screens.filter(
    (s) => s.cameraId === cameraId && s.hasCorrection,
  );
  const phoneCameras = useMemo(
    () => [
      {
        id: cameraId,
        name: config?.camera.name ?? cameraId,
        online: true,
        screenCount: savedScreens.length,
        screens: savedScreens,
        screenBindings: savedScreens,
      },
    ],
    [
      cameraId,
      config?.camera.name,
      savedScreens.map((s) => `${s.id}:${s.name}`).join('|'),
    ],
  );
  const phoneReadiness = useCameraPhoneReadiness({
    active: true,
    api: pageClient,
    cameras: phoneCameras,
    cameraId,
  });
  const knownScreens = screens.filter(
    (s) =>
      s.cameraId === cameraId &&
      (s.hasCorrection || s.markerSlot !== undefined),
  );
  const savedIds = knownScreens
    .map((s) => `${s.id}:${s.name}:${s.pageKey}`)
    .join('|');
  const existing = useMemo(
    () =>
      knownScreens.map((s) => ({ id: s.id, name: s.name, pageKey: s.pageKey })),
    [savedIds],
  );
  const currentBase = useRef(base);
  currentBase.current = base;
  const refresh = useCallback(async () => {
    const [next, listed, nextStates, running, singleStatus] = await Promise.all(
      [
        markerRequest<Configuration>(`${base}/configuration`),
        markerRequest<{ screens: BoundScreen[] }>('/api/screens'),
        batchClient.screens(),
        batchClient.calibrationBatch(),
        markerRequest<{ phase: string; error?: string }>(`${base}/status`),
      ],
    );
    if (currentBase.current !== base) return;
    setConfig(next);
    if (initialStepPending.current) {
      initialStepPending.current = false;
      if (!next.input) {
        setStep(0);
        setMarkerOpen(false);
      }
    }
    setScreens(listed.screens);
    setStates(nextStates);
    setBatch(running);
    if (singlePending.current && singleStatus.phase !== 'queued') {
      singlePending.current = false;
      setSingleQueued(false);
      if (['running', 'completed'].includes(singleStatus.phase))
        setSingleActive(true);
      else setError(singleStatus.error ?? t('Calibration cancelled'));
    }
  }, [base, batchClient]);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await markerRequest(`${base}/open`, {});
        if (alive) await refresh();
      } catch (cause) {
        if (alive)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (alive) timer = setTimeout(() => void poll(), 1500);
      }
    };
    setConfig(undefined);
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [base, refresh]);
  const markerKey = useMemo(
    () => ({ id: cameraId, deviceId: cameraId }),
    [cameraId],
  );
  const current = batch?.items[batch.currentIndex];
  const activeId = batchActive && current ? current.deviceId : selectedId;
  const perspective = usePerspectiveValidity(
    `/api/devices/${encodeURIComponent(activeId)}/calibration`,
    Boolean(config?.correction),
    config?.correctionKey,
  );
  const outlineBlocked = perspective.summary?.state === 'invalid';
  const single = useMemo(
    () =>
      createCalibrationClient({
        baseUrl: `/api/devices/${encodeURIComponent(activeId)}/calibration`,
      }),
    [activeId],
  );
  const progress = useAssistedCalibration(
    single,
    activeId,
    step === 3 && batchActive,
  );
  const beforeLeave = useRef<(() => Promise<void>) | null>(null);
  const registerLeave = useCallback((handler: (() => Promise<void>) | null) => {
    beforeLeave.current = handler;
  }, []);
  const close = async () => {
    try {
      if (batchActive && batch)
        await batchClient.calibrationBatchCommand(batch.id, {
          revision: batch.revision,
          action: 'stop',
        });
      await beforeLeave.current?.();
      if (config?.armState?.state.dragMode && teaching)
        await teaching.exitDrag();
      await markerRequest(`${base}/cancel`, {});
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const detected = useCallback(
    async (_session: unknown, result: MarkerCalibrationDetectionResponse) => {
      setReview(result);
      setReviewOpen(true);
      setRetryId(undefined);
    },
    [],
  );
  const markerClosed = useCallback(() => setMarkerOpen(false), []);
  const startSingle = async () => {
    setSingleQueued(true);
    try {
      await markerRequest(`${base}/start`, {});
      singlePending.current = true;
    } catch (error) {
      singlePending.current = false;
      setSingleQueued(false);
      throw error;
    }
    await refresh();
  };
  const titles = [
    'Touch Tool',
    'Camera Mapping',
    'Teach Installation',
    'Screen Calibration',
  ];
  const canVisit = (next: number) =>
    !batchActive &&
    !singleActive &&
    !singleQueued &&
    !config?.armState?.state.moving &&
    !config?.armState?.state.dragMode &&
    (next === 0 || Boolean(config?.input)) &&
    (next < 2 || Boolean(config?.correction)) &&
    (next < 2 || !outlineBlocked) &&
    (next < 3 || Boolean(controller.setup.teaching));
  const selected = screens.find((s) => s.id === selectedId);
  return (
    <main className="calibration-page is-embedded guided-calibration">
      <header className="calibration-shell-header">
        <div className="calibration-shell-heading">
          <div>
            <Typography.Text type="secondary">
              {t('Calibration')}
            </Typography.Text>
            <Typography.Title level={2}>{t(titles[step])}</Typography.Title>
          </div>
          <Space>
            {step > 0 && (
              <Button onClick={() => setPhonesOpen(true)}>
                {t('View Phone Page')}
              </Button>
            )}
            <Button onClick={() => void close()}>{t('Close')}</Button>
          </Space>
        </div>
        <Steps
          size="small"
          current={step}
          items={titles.map((title, index) => ({
            title: t(title),
            disabled: !canVisit(index),
          }))}
          onChange={(next) => {
            if (canVisit(next)) {
              setStep(next);
              if (next === 1) setMarkerOpen(true);
            }
          }}
        />
      </header>
      <div className="calibration-shell-body">
        <div className="guided-calibration-layout">
          <div className="guided-calibration-flow">
            <PerspectiveObservationCard
              observation={perspective}
              screenName={screens.find((s) => s.id === activeId)?.name}
              onRecalibrate={
                batchActive || singleActive || singleQueued
                  ? undefined
                  : () => {
                      setStep(1);
                      setMarkerOpen(true);
                    }
              }
            />
            {error && (
              <Alert
                type="error"
                showIcon
                message={error}
                closable
                onClose={() => setError(undefined)}
              />
            )}
            {!config ? (
              <Spin />
            ) : (
              <>
                {step === 0 && (
                  <CalibrationSetup
                    capabilities={config.capabilities}
                    initial={config.measuredSetup}
                    footer={footer}
                    onSave={async (value) => {
                      await markerRequest(`${base}/configuration`, value);
                      await refresh();
                      setStep(1);
                      setMarkerOpen(true);
                    }}
                  />
                )}
                {step === 1 &&
                  (markerOpen ? (
                    <GuidedMarkerCalibration
                      variant="inline"
                      footerContainer={footer}
                      api={markerClient}
                      screenCalib={pageClient}
                      stream={markerKey}
                      displayName={config.camera.name}
                      autoCreateScreen
                      autoAddTarget={false}
                      firstScreenCalibration={!savedScreens.length}
                      existingScreens={retryId ? undefined : existing}
                      focusTargetId={retryId}
                      resumeSession={retryId ? markerSession : undefined}
                      includeSucceededTargets={Boolean(retryId)}
                      keepSessionOnClose
                      onClose={markerClosed}
                      onDetected={detected}
                      onSessionCreated={setMarkerSession}
                      existingScreenNames={screens
                        .filter((s) => s.cameraId === cameraId)
                        .map((s) => s.name)}
                    />
                  ) : (
                    <>
                      <Space wrap>
                        <Button
                          onClick={() => {
                            setRetryId(undefined);
                            setMarkerOpen(true);
                          }}
                        >
                          {t(
                            savedScreens.length
                              ? 'Recalibrate All Screens'
                              : 'Pair Phone',
                          )}
                        </Button>
                        <Button
                          onClick={async () => {
                            try {
                              const created =
                                await markerClient.createMarkerCalibration(
                                  cameraId,
                                  [
                                    `Screen ${screens.filter((s) => s.cameraId === cameraId).length + 1}`,
                                  ],
                                );
                              setMarkerSession(created);
                              setRetryId(created.targets[0].id);
                              setMarkerOpen(true);
                            } catch (cause) {
                              setError(
                                cause instanceof Error
                                  ? cause.message
                                  : String(cause),
                              );
                            }
                          }}
                        >
                          {t('Add Screen')}
                        </Button>
                        {review && (
                          <Button onClick={() => setReviewOpen(true)}>
                            {t('Review and Apply')}
                          </Button>
                        )}
                        <Select
                          aria-label={t('Calibration Screen')}
                          value={selectedId}
                          style={{ minWidth: 180 }}
                          options={savedScreens.map((s) => ({
                            value: s.id,
                            label: s.name,
                          }))}
                          onChange={setSelectedId}
                        />
                      </Space>
                      <div className="robot-setup-task-layout">
                        <div>
                          {savedScreens.map((s) => (
                            <div
                              className="robot-calibration-screen"
                              key={s.id}
                            >
                              <Typography.Text strong>{s.name}</Typography.Text>
                              <Typography.Text type="secondary">
                                {t('Perspective preset ready')}
                              </Typography.Text>
                            </div>
                          ))}
                        </div>
                      </div>
                      {footer && (
                        <WizardFooter container={footer}>
                          <Button
                            type="primary"
                            disabled={
                              !config.correction ||
                              !controller.setup.phoneConnected
                            }
                            onClick={() => setStep(2)}
                          >
                            {t('Next Step')}
                          </Button>
                        </WizardFooter>
                      )}
                    </>
                  ))}
                {step === 2 && teaching && (
                  <>
                    <Space className="guided-teaching-toolbar">
                      {controller.setup.teaching && (
                        <Button onClick={() => setStep(3)}>
                          {t('Next Step')}
                        </Button>
                      )}
                      {!config.ready && (
                        <CalibrationPowerButton
                          config={config}
                          apply={async (action) => {
                            await markerRequest(`${base}/${action}`, {
                              confirmed: true,
                            });
                            await refresh();
                          }}
                        />
                      )}
                      <Select
                        aria-label={t('Calibration Screen')}
                        value={selectedId}
                        options={savedScreens.map((s) => ({
                          value: s.id,
                          label: s.name,
                        }))}
                        style={{ minWidth: 180 }}
                        disabled={Boolean(
                          config.armState?.state.dragMode ||
                            config.armState?.state.moving,
                        )}
                        onChange={setSelectedId}
                      />
                    </Space>
                    <InstallationTeaching
                      api={teaching}
                      binding={teaching.binding}
                      screenName={selected?.name}
                      disabled={
                        Boolean(config.armState?.state.moving) || outlineBlocked
                      }
                      footer={footer}
                      externalPreview
                      onSaved={() => {
                        setStep(3);
                        void refresh();
                      }}
                    />
                  </>
                )}
                {step === 3 && (
                  <>
                    {singleQueued && (
                      <Alert
                        type="info"
                        showIcon
                        message={t('Waiting for the Controller queue')}
                      />
                    )}
                    <CalibrationBatchPanel
                      ref={batchPanel}
                      api={batchClient}
                      cameraId={cameraId}
                      screens={states}
                      disabled={
                        !config.ready ||
                        outlineBlocked ||
                        controller.busy ||
                        singleActive ||
                        singleQueued
                      }
                      onActiveChange={setBatchActive}
                      onChanged={refresh}
                    />
                    {batchActive && current && (
                      <ActiveBatchScreen controller={progress} />
                    )}
                    {!batchActive && singleActive && (
                      <WebCalibrationWorkspace
                        controller={controller}
                        footer={footer}
                        result={config.result}
                        readyToCapture={config.ready && !outlineBlocked}
                        readyToStart={config.ready && !outlineBlocked}
                        onActivated={refresh}
                        externalPreview
                        onBeforeLeaveChange={registerLeave}
                        onReturn={onClose}
                      />
                    )}
                    {!batchActive && !singleActive && footer && (
                      <WizardFooter container={footer}>
                        <Button
                          disabled={singleQueued}
                          onClick={() => setStep(2)}
                        >
                          {t('Previous Step')}
                        </Button>
                        {savedScreens.length > 1 ? (
                          <Button
                            type="primary"
                            disabled={!config.ready || outlineBlocked}
                            onClick={() => batchPanel.current?.open()}
                          >
                            {t('Start automatic calibration')}
                          </Button>
                        ) : (
                          <Button
                            type="primary"
                            loading={singleQueued}
                            disabled={
                              !config.ready || outlineBlocked || singleQueued
                            }
                            onClick={() =>
                              void startSingle().catch((cause) =>
                                setError(
                                  cause instanceof Error
                                    ? cause.message
                                    : String(cause),
                                ),
                              )
                            }
                          >
                            {t('Start automatic calibration')}
                          </Button>
                        )}
                      </WizardFooter>
                    )}
                  </>
                )}
              </>
            )}
          </div>
          {config && (
            <aside className="guided-camera" aria-label={t('Live Preview')}>
              <Typography.Text strong>
                {t('Live Preview')} · {config.camera.name}
              </Typography.Text>
              <div className="guided-preview-frame">
                <img
                  className="calibration-preview"
                  src={`/api/devices/${encodeURIComponent(activeId)}/calibration/camera/preview`}
                  data-testid="calibration-live-camera"
                  alt={config.camera.name}
                />
                {perspective.summary?.state === 'invalid' &&
                  config.deviceId === activeId &&
                  config.correction && (
                    <svg
                      className="guided-outline"
                      viewBox={`0 0 ${config.correction.sourceWidth} ${config.correction.sourceHeight}`}
                      role="img"
                      aria-label={t('Saved screen outline')}
                    >
                      <title>{t('Saved screen outline')}</title>
                      <polygon
                        points={[
                          'topLeft',
                          'topRight',
                          'bottomRight',
                          'bottomLeft',
                        ]
                          .map((key) => {
                            const p =
                              config.correction!.points[
                                key as keyof CameraCorrection['points']
                              ];
                            return `${p.x},${p.y}`;
                          })
                          .join(' ')}
                        fill="none"
                        stroke="#f43f5e"
                        strokeWidth="3"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                  )}
              </div>
              {step === 2 && (
                <Typography.Text type="secondary">
                  {t('Check the whole arm directly before recording.')}
                </Typography.Text>
              )}
            </aside>
          )}
        </div>
      </div>
      <footer className="calibration-shell-footer">
        <div className="arm-calibration-footer" ref={setFooter} />
      </footer>
      <PhoneConnectDialog
        open={phonesOpen}
        onClose={() => setPhonesOpen(false)}
        readiness={phoneReadiness}
        cameras={phoneCameras}
        onConnect={(id, camera) => {
          void pageClient
            .assignScreenDevice(id, { role: 'mapping', cameraId: camera })
            .catch((cause) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            );
        }}
        onAssignCamera={(id, camera) => {
          void pageClient
            .assignScreenDevice(id, { role: 'mapping', cameraId: camera })
            .catch((cause) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            );
        }}
        onRestoreHome={(id) => pageClient.restoreScreenDeviceHome(id)}
        onRenamePage={async (id, name) => {
          await pageClient.renameScreenDevice(id, name);
          await refresh();
        }}
        onRenameScreens={async (camera, names) => {
          for (const [id, name] of Object.entries(names))
            await pageClient.renameScreen(camera, id, name);
          await refresh();
        }}
      />
      <MultiScreenCalibrationReviewDialog
        session={review?.session}
        frames={review?.frames ?? {}}
        open={reviewOpen}
        applying={applying}
        retryingTargetId={retryId}
        onClose={() => setReviewOpen(false)}
        onReview={(target, frame) => setReviewing({ target, frame })}
        onRetry={(target) => {
          setReviewOpen(false);
          setRetryId(target.id);
          setMarkerOpen(true);
        }}
        onApply={() => {
          if (!review || !markerSession) return;
          setApplying(true);
          void markerClient
            .applyMarkerCalibration(review.session.id, markerSession.token)
            .then(async () => {
              await refresh();
              setReviewOpen(false);
              setMarkerOpen(false);
            })
            .catch((cause) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
            .finally(() => setApplying(false));
        }}
      />
      <Modal
        open={Boolean(reviewing)}
        width="min(960px, 94vw)"
        footer={null}
        title={reviewing?.target.name}
        onCancel={() => setReviewing(undefined)}
      >
        {reviewing?.target.result &&
          reviewing.frame?.jpegBase64 &&
          (() => {
            const result = reviewing.target.result!;
            const correction: CameraCorrection = {
              points: result.points,
              sourceWidth: result.imageWidth,
              sourceHeight: result.imageHeight,
              rotation: result.rotation,
            };
            const src = `data:image/jpeg;base64,${reviewing.frame!.jpegBase64}`;
            return (
              <div className="robot-setup-task-layout">
                <CameraCornerEditor disabled value={correction} src={src} />
                <CorrectedPreview
                  correction={correction}
                  size={{
                    width: result.screenWidthPx,
                    height: result.screenHeightPx,
                  }}
                  src={src}
                />
              </div>
            );
          })()}
      </Modal>
    </main>
  );
}
import { createPortal } from 'react-dom';
function GuidedMarkerCalibration(
  props: ComponentProps<typeof MarkerCalibrationDialog>,
) {
  const [initial] = useState({
    existing: props.existingScreens,
    first: props.firstScreenCalibration,
  });
  return (
    <MarkerCalibrationDialog
      {...props}
      existingScreens={initial.existing}
      firstScreenCalibration={initial.first}
    />
  );
}
function WizardFooter({
  container,
  children,
}: { container: HTMLElement; children: ReactNode }) {
  return createPortal(
    <div className="robot-web-actions">{children}</div>,
    container,
  );
}
function ActiveBatchScreen({
  controller,
}: {
  controller: ReturnType<typeof useAssistedCalibration>;
}) {
  const session = controller.session;
  return (
    <div className="guided-batch-progress">
      <div>
        {session && <ExplorationProgress session={session} />}
        {session?.explorationQuality && (
          <Typography.Paragraph>
            {t('Grid RMS {0} mm · Holdout maximum {1} mm · Coverage {2}%', [
              session.explorationQuality.gridRmsMm.toFixed(2),
              session.explorationQuality.holdoutMaxMm.toFixed(2),
              Math.round(session.explorationQuality.coverage * 100),
            ])}
          </Typography.Paragraph>
        )}
        {session &&
          ['return-ready', 'positioning-safe'].includes(session.stage) && (
            <Typography.Paragraph>
              {t(
                'Boundary verification is complete. Record a Safe Position clear of the screen and camera; release the robot before recording.',
              )}
            </Typography.Paragraph>
          )}
        {controller.connectionError && (
          <Alert type="error" message={controller.connectionError} />
        )}
      </div>
    </div>
  );
}
