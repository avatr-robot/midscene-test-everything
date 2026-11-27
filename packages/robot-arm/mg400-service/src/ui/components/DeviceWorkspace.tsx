import {
  Alert,
  App,
  Button,
  Empty,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { Drawer, Tooltip } from 'antd';
import {
  ArrowRightLeft,
  Cable,
  Camera,
  ChevronDown,
  ChevronUp,
  Edit3,
  Play,
  RefreshCw,
  ScanLine,
  Settings2,
  StopCircle,
  Unplug,
  VideoOff,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  PerspectiveObservationCard,
  type ScreenOutlineEntry,
  identifyScreen,
  usePerspectiveValidity,
} from '../calibration';
import {
  type CameraView,
  cameraPreviewContext,
  cameraPreviewUrl,
} from '../camera-preview';
import {
  CAMERA_VIEWPOINT_OPTIONS,
  type CameraCaptureSettings,
  type CameraEntry,
  type CameraProfileUpdate,
  type CameraViewpoint,
  activateCameraImaging,
  cameraForScreenCalibration,
  cameraRailEntries,
  cameraScreenNeedsCalibration,
  cameraStateLabel,
  cameraViewpointAssignments,
  cameraViewpointCandidates,
  cameraViewpointOf,
  inferCameraViewpoints,
  selectCameraScreen,
  updateCameraCaptureSettings,
  useCameras,
} from '../cameras';
import { useConnection } from '../connection';
import { updateDepthControls } from '../depth-api';
import { useViews } from '../extensions';
import { useDepthProbe } from '../hooks/useDepthProbe';
import { useDeviceReadiness } from '../hooks/useDeviceReadiness';
import { usePreviewControl } from '../hooks/usePreviewControl';
import { useRobotArm } from '../hooks/useRobotArm';
import { usePreferences, useT } from '../i18n';
import { PreviewControl } from '../preview/PreviewControl';
import type { PreviewScreenGeometry } from '../preview/projection';
import { depthFusionResolutionMismatch } from '../utils/depth-fusion';
import { CameraPerspectiveActions } from './CameraPerspectiveActions';
import { CameraProfileEditor } from './CameraProfileEditor';
import { CameraRail } from './CameraRail';
import { CameraStagePreview } from './CameraStagePreview';
import { DepthCameraPreview } from './DepthCameraPreview';
import { DepthFusionControl } from './DepthFusionControl';
import { DepthPointCloudView } from './DepthPointCloudView';
import { DepthProbeOverlay } from './DepthProbeOverlay';
import { DeviceCalibration } from './DeviceCalibration';
import { DeviceTransfer } from './DeviceTransfer';
import { RobotConnectionDialog } from './RobotConnectionDialog';
import { TwinPanel, type TwinViewPreset } from './TwinPanel';
import { ActionAudit } from './robot-arm/ActionAudit';
import { ConnectSettings } from './robot-arm/ConnectSettings';
import { ControllerMotionSettings } from './robot-arm/ControllerMotionSettings';
import { DeviceSettings } from './robot-arm/DeviceSettings';
import { RobotStatusBar } from './robot-arm/RobotStatusBar';
import { loadVlmModelSettings } from './robot-arm/vlm-model-settings';
import './CameraStage.less';

export function DeviceWorkspace({ connected }: { connected: boolean }) {
  const t = useT();
  const { message } = App.useApp();
  const { ConnectionForm } = useViews();
  const arm = useRobotArm();
  const [enabledControlContext, setEnabledControlContext] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const language = usePreferences((state) => state.language);
  const [configurationRevision, setConfigurationRevision] = useState(0);
  const [wizard, setWizard] = useState<{
    id: string;
    cameraId: string;
    step: 0 | 1;
    reviewInstallationOnOpen: boolean;
    session: string;
  }>();
  const [wizardScreen, setWizardScreen] = useState<string>();
  const [transferId, setTransferId] = useState<string>();
  const [preferredView, setCameraView] = useState<CameraView>('raw');
  const [depthViewMode, setDepthViewMode] = useState<'2d' | '3d'>('2d');
  const [depthFusionEnabled, setDepthFusionEnabled] = useState(false);
  const [depthFusionOpacity, setDepthFusionOpacity] = useState(0.45);
  const [cameraSettingsOpen, setCameraSettingsOpen] = useState(false);
  const [cameraSettingsSaving, setCameraSettingsSaving] = useState(false);
  const [cameraViewpointSaving, setCameraViewpointSaving] = useState(false);
  const [cameraViewpointDetecting, setCameraViewpointDetecting] =
    useState(false);
  const [cameraSettingsError, setCameraSettingsError] = useState<string>();
  const [twinView, setTwinView] = useState<TwinViewPreset>('default');
  const [previewError, setPreviewError] = useState<string>();
  const [previewRevision, setPreviewRevision] = useState(0);
  const [imagingSwitchError, setImagingSwitchError] = useState<string>();
  const cameraRailId = useId();
  const [cameraRailExpanded, setCameraRailExpanded] = useState(true);
  const cameraRailAction = t(
    cameraRailExpanded ? 'collapseCameraRail' : 'expandCameraRail',
  );
  const {
    cameras,
    deviceSession,
    selectedId,
    select,
    status,
    refresh,
    start,
    stop,
    pendingId,
    error,
  } = useCameras();
  const { host, disconnect, setupSession, check, control } = useConnection();
  const closeCalibration = useCallback(
    (screenId?: string) => {
      if (screenId) setPreferredScreenId(screenId);
      setWizard(undefined);
      setWizardScreen(undefined);
      setConfigurationRevision((value) => value + 1);
      // Closing the wizard must not probe the camera devices: the stream is
      // already running and enumeration can disturb the capture process.
      void refresh(false);
      void check();
    },
    [check, refresh],
  );
  const [pausedCamera, setPausedCamera] = useState<string>();
  const [frame, setFrame] = useState<{
    key: string;
    width: number;
    height: number;
    image: HTMLImageElement;
  }>();
  const [preferredScreenId, setPreferredScreenId] = useState<string>();
  useEffect(() => {
    void refresh(false);
    const onFocus = () => void refresh(false);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh, connected, setupSession]);
  useEffect(() => {
    if (connected) setConnectionOpen(false);
    else setPreferredScreenId(undefined);
  }, [connected]);
  useEffect(() => {
    setSettingsOpen(false);
    setTransferId(undefined);
    setWizardScreen(undefined);
    setWizard(undefined);
    setPausedCamera(undefined);
    setPreferredScreenId(undefined);
    setDepthViewMode('2d');
    setDepthFusionEnabled(false);
    setCameraSettingsOpen(false);
    setCameraSettingsError(undefined);
  }, [setupSession]);
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
  const depthCamera = selected?.kind === 'depth';
  const viewpointCameras = useMemo(
    () => cameraViewpointCandidates(cameras),
    [cameras],
  );
  const selectedViewpoint = cameraViewpointOf(selected?.label);
  const pairedColorCamera = depthCamera
    ? cameras.find((camera) => camera.id === selected?.pairedDeviceId)
    : undefined;
  const depthFusionAvailable =
    selected?.stream?.state === 'running' &&
    pairedColorCamera?.stream?.state === 'running';
  const depthFusionMismatch =
    depthFusionAvailable &&
    depthFusionResolutionMismatch(selected, pairedColorCamera);
  const depthFusionBlockedReason = depthFusionMismatch
    ? language === 'zh'
      ? `分辨率不一致：RGB ${depthFusionMismatch.color.width}×${depthFusionMismatch.color.height}，深度 ${depthFusionMismatch.depth.width}×${depthFusionMismatch.depth.height}。请先调整为相同分辨率。`
      : `Resolution mismatch: RGB ${depthFusionMismatch.color.width}×${depthFusionMismatch.color.height}, depth ${depthFusionMismatch.depth.width}×${depthFusionMismatch.depth.height}. Use the same resolution before fusion.`
    : undefined;
  const depthFusionActive =
    depthFusionEnabled && depthFusionAvailable && !depthFusionBlockedReason;
  const railCameras = cameraRailEntries(cameras, selected, depthFusionActive);
  useEffect(() => {
    if (depthFusionEnabled && !depthFusionActive) setDepthFusionEnabled(false);
  }, [depthFusionActive, depthFusionEnabled]);
  useEffect(() => {
    setDepthViewMode('2d');
    setDepthFusionEnabled(false);
    setCameraSettingsOpen(false);
    setCameraSettingsError(undefined);
  }, [selected?.id]);
  const depthProbe = useDepthProbe(selected, selected?.stream);
  const streamState = selected?.stream?.state;
  const robotReady =
    connected && Boolean(setupSession && setupSession === deviceSession);
  useEffect(() => {
    if (
      !connected ||
      !setupSession ||
      deviceSession === undefined ||
      robotReady ||
      status !== 'ready'
    )
      return;
    const timer = setTimeout(() => void refresh(false), 1000);
    return () => clearTimeout(timer);
  }, [connected, setupSession, deviceSession, robotReady, status, refresh]);
  const availableScreens = robotReady ? (selected?.screens ?? []) : [];
  const transferTargets = cameras.flatMap((camera) =>
    camera.stream?.state === 'running' ? (camera.screens ?? []) : [],
  );
  const activeScreen = depthCamera
    ? undefined
    : (selectCameraScreen(availableScreens, [
        preferredScreenId,
        selected?.previewScreenId,
        selectedId ?? undefined,
      ]) ?? (!connected ? selected : undefined));
  const calibrationCamera = cameraForScreenCalibration(cameras, selectedId);
  const calibrationScreen = selectCameraScreen(
    robotReady ? (calibrationCamera?.screens ?? []) : [],
    [
      preferredScreenId,
      activeScreen?.id,
      calibrationCamera?.previewScreenId,
      calibrationCamera?.id,
    ],
  );
  const deviceId =
    !depthCamera && robotReady && streamState === 'running'
      ? (activeScreen?.id ?? selectedId ?? undefined)
      : undefined;
  const controlScreens = useMemo<PreviewScreenGeometry[]>(
    () =>
      availableScreens.flatMap((screen) => {
        const control = screen.control;
        if (
          !screen.correction ||
          !control?.ready ||
          !control.pixelWidth ||
          !control.pixelHeight
        )
          return [];
        return [
          {
            id: screen.id,
            name: screen.name,
            correction: screen.correction,
            target: screen.perspectiveTarget,
            pixelWidth: control.pixelWidth,
            pixelHeight: control.pixelHeight,
            calibrationId: control.calibrationId,
            active: screen.id === activeScreen?.id,
            ready: true,
          },
        ];
      }),
    [activeScreen?.id, availableScreens],
  );
  // A missed status poll during motion must not unmount the current attempt.
  const activeWizard = wizard?.session === setupSession ? wizard : undefined;
  const openCalibration = (
    step: 0 | 1 = 0,
    reviewInstallationOnOpen = false,
  ) => {
    if (!calibrationCamera || !setupSession) return;
    const screenId = calibrationScreen?.id ?? calibrationCamera.id;
    setWizardScreen(screenId);
    setWizard({
      id: screenId,
      cameraId: calibrationCamera.id,
      step,
      reviewInstallationOnOpen,
      session: setupSession,
    });
  };
  const openCameraCorrection = () => openCalibration(1);
  const controlScreen = activeWizard ? wizardScreen : deviceId;
  const standalone = !connected && deviceSession === null;
  useEffect(() => {
    if (!standalone || !selectedId || pausedCamera === selectedId) return;
    const abort = new AbortController();
    // The preview itself reports startup errors. This extra owner only
    // bridges the instant between detaching one MJPEG image and loading another.
    void fetch(`/api/cameras/lease?id=${encodeURIComponent(selectedId)}`, {
      signal: abort.signal,
    })
      .then((response) => response.arrayBuffer())
      .catch(() => {});
    return () => abort.abort();
  }, [standalone, selectedId, pausedCamera]);
  const previewTarget = activeScreen?.perspectiveTarget;
  const cameraView = previewTarget ? preferredView : 'raw';
  const { previewId, previewKey, controlContext } = cameraPreviewContext({
    cameraId: selectedId,
    screenId: activeScreen?.id,
    view: cameraView,
    revision: previewRevision,
    standalone,
    connected,
    session: setupSession,
    screens: controlScreens,
  });
  const running = standalone
    ? Boolean(
        selected &&
          pausedCamera !== selected.id &&
          frame?.key === previewKey &&
          previewError !== previewKey,
      )
    : streamState === 'running';
  const previewEnabled = standalone ? selected?.id !== pausedCamera : running;
  const activeScreenMapped = Boolean(
    activeScreen && !cameraScreenNeedsCalibration(activeScreen),
  );
  useEffect(() => {
    setImagingSwitchError(undefined);
    if (
      !running ||
      !selectedId ||
      !activeScreen?.id ||
      !activeScreenMapped ||
      activeWizard
    )
      return;
    let cancelled = false;
    void activateCameraImaging(selectedId, activeScreen.id)
      .then((imaging) => {
        if (
          !cancelled &&
          (imaging?.state === 'unconfigured' || imaging?.state === 'error')
        )
          setImagingSwitchError(
            imaging.message ?? 'Calibrate camera imaging for this screen',
          );
      })
      .catch((error) => {
        if (!cancelled)
          setImagingSwitchError(
            error instanceof Error ? error.message : String(error),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [activeScreen?.id, activeScreenMapped, activeWizard, running, selectedId]);
  const starting = !standalone && streamState === 'starting';
  const cameraActionLabel = t(
    starting ? 'cameraStarting' : previewEnabled ? 'stopCamera' : 'startCamera',
  );
  const camera =
    selected && standalone
      ? {
          ...selected,
          stream: {
            state: !previewEnabled
              ? 'stopped'
              : previewError === previewKey
                ? 'failed'
                : running
                  ? 'running'
                  : 'starting',
            width: running ? (frame?.width ?? 0) : 0,
            height: running ? (frame?.height ?? 0) : 0,
            hasFrame: running,
          },
        }
      : selected;
  const readiness = useDeviceReadiness(
    running ? deviceId : undefined,
    JSON.stringify([
      setupSession,
      selectedId,
      configurationRevision,
      previewRevision,
    ]),
  );
  const perspective = usePerspectiveValidity(
    `/api/devices/${encodeURIComponent(deviceId ?? '')}/calibration`,
    Boolean(deviceId && running && activeScreen?.correction && !activeWizard),
    JSON.stringify([setupSession, configurationRevision, previewRevision]),
  );
  const perspectiveBlocked = perspective.summary?.state === 'invalid';
  const switchingScreen = Boolean(readiness && readiness.id !== deviceId);
  const ready = !switchingScreen && readiness?.status === 'ready';
  const runtimeState = arm.state;
  const robotState = runtimeState?.state;
  const activeViewBlocked = cameraView === 'corrected' && perspectiveBlocked;
  const robotControlReady = Boolean(
    connected &&
      robotReady &&
      running &&
      previewError !== previewKey &&
      !activeViewBlocked &&
      !control?.remoteBusy &&
      !control?.positionUnknown &&
      arm.capabilities?.screenActions.includes('tap') &&
      arm.capabilities?.screenActions.includes('swipe') &&
      robotState?.connected &&
      robotState.enabled &&
      !robotState.moving &&
      !robotState.dragMode &&
      !runtimeState?.recoveryRequired &&
      !runtimeState?.softwarePaused &&
      !robotState.faults.length &&
      runtimeState?.operation?.status !== 'running',
  );
  const visibleControlScreens =
    cameraView === 'corrected'
      ? controlScreens.filter((screen) => screen.id === activeScreen?.id)
      : controlScreens;
  const controlAvailable =
    !activeWizard && robotControlReady && visibleControlScreens.length > 0;
  const controlEnabled = enabledControlContext === controlContext;
  const controlUnavailableReason = !connected
    ? language === 'zh'
      ? '连接机械臂后才能控制屏幕'
      : 'Connect the robot before controlling a screen'
    : !robotReady
      ? language === 'zh'
        ? '正在核对机械臂与相机，暂不可控制'
        : 'Checking the robot and camera connection'
      : !running
        ? language === 'zh'
          ? '启动相机后才能控制屏幕'
          : 'Start the camera before controlling a screen'
        : activeViewBlocked
          ? language === 'zh'
            ? '屏幕轮廓已失效，请重新标定相机映射'
            : 'The screen outline is stale. Recalibrate the camera mapping'
          : !visibleControlScreens.length
            ? language === 'zh'
              ? '当前画面没有已完成标定和映射的屏幕'
              : 'No screen with accepted calibration and mapping is in view'
            : !ready
              ? language === 'zh'
                ? '屏幕标定尚未就绪'
                : 'Screen calibration is not ready'
              : control?.positionUnknown
                ? language === 'zh'
                  ? '机械臂位置未知，请先恢复或重新标定'
                  : 'The arm position is unknown. Recover or recalibrate first'
                : !robotState?.enabled
                  ? language === 'zh'
                    ? '请先使能机械臂并确认工具负载'
                    : 'Enable the robot and confirm its tool payload first'
                  : control?.remoteBusy
                    ? language === 'zh'
                      ? '机械臂正在执行远程动作'
                      : 'The arm is running a remote action'
                    : robotState?.moving || robotState?.dragMode
                      ? language === 'zh'
                        ? '机械臂正在运动，暂不可控制'
                        : 'The arm is moving; control is paused'
                      : runtimeState?.recoveryRequired ||
                          runtimeState?.softwarePaused ||
                          robotState?.faults.length
                        ? language === 'zh'
                          ? '请先处理机械臂报警或恢复状态'
                          : 'Clear the robot fault or recovery state first'
                        : undefined;
  const refreshAfterControl = useCallback(async () => {
    setConfigurationRevision((value) => value + 1);
    // A status poll already in flight may still describe the completed motion.
    await Promise.all([refresh(false), check(true)]);
  }, [check, refresh]);
  const saveCameraSettings = useCallback(
    async (update: CameraProfileUpdate) => {
      if (!selectedId) return;
      setCameraSettingsSaving(true);
      setCameraSettingsError(undefined);
      try {
        await updateCameraCaptureSettings(selectedId, update);
        if (update.depthControls)
          await updateDepthControls(selectedId, update.depthControls);
        setPreviewRevision((value) => value + 1);
        await refresh(false);
        setCameraSettingsOpen(false);
      } catch (error) {
        setCameraSettingsError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setCameraSettingsSaving(false);
      }
    },
    [refresh, selectedId],
  );
  const persistCameraViewpoints = useCallback(
    async (
      assignments: ReadonlyArray<{ id: string; label: CameraViewpoint }>,
    ) => {
      setCameraViewpointSaving(true);
      try {
        await Promise.all(
          assignments.map(async (assignment) => {
            const camera = cameras.find(
              (candidate) => candidate.id === assignment.id,
            );
            if (!camera)
              throw new Error(
                language === 'zh' ? '找不到相机' : 'Camera not found',
              );
            await updateCameraCaptureSettings(
              camera.id,
              cameraViewpointUpdate(camera, assignment.label),
            );
          }),
        );
        await refresh(false);
        message.success(
          language === 'zh' ? '相机位置已更新' : 'Camera viewpoints updated',
        );
      } catch (error) {
        await refresh(false).catch(() => undefined);
        throw error;
      } finally {
        setCameraViewpointSaving(false);
      }
    },
    [cameras, language, message, refresh],
  );
  const assignCameraViewpoint = useCallback(
    async (viewpoint: CameraViewpoint) => {
      if (!selectedId || cameraViewpointSaving || cameraViewpointDetecting)
        return;
      const assignments = cameraViewpointAssignments(
        viewpointCameras,
        selectedId,
        viewpoint,
      );
      if (assignments.length !== 2) {
        message.warning(
          language === 'zh'
            ? '需要两台运行中的彩色相机才能分配平视和俯视位置'
            : 'Two running color cameras are required to assign eye-level and overhead views',
        );
        return;
      }
      try {
        await persistCameraViewpoints(assignments);
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
      }
    },
    [
      cameraViewpointDetecting,
      cameraViewpointSaving,
      language,
      message,
      persistCameraViewpoints,
      selectedId,
      viewpointCameras,
    ],
  );
  const detectCameraViewpoints = useCallback(async () => {
    if (cameraViewpointDetecting || cameraViewpointSaving) return;
    const model = loadVlmModelSettings();
    if (!model) {
      message.warning(
        language === 'zh'
          ? '请先在模型配置中填写完整的 VLM 接口'
          : 'Configure a complete VLM interface first',
      );
      return;
    }
    if (viewpointCameras.length !== 2) {
      message.warning(
        language === 'zh'
          ? '需要恰好两台运行中的彩色相机'
          : 'Exactly two running color cameras are required',
      );
      return;
    }
    setCameraViewpointDetecting(true);
    try {
      const cameraIds = [
        viewpointCameras[0]!.id,
        viewpointCameras[1]!.id,
      ] as const;
      const result = await inferCameraViewpoints(cameraIds, model);
      await persistCameraViewpoints([
        { id: result.overheadCameraId, label: 'top' },
        { id: result.eyeLevelCameraId, label: 'front' },
      ]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCameraViewpointDetecting(false);
    }
  }, [
    cameraViewpointDetecting,
    cameraViewpointSaving,
    language,
    message,
    persistCameraViewpoints,
    viewpointCameras,
  ]);
  const previewControl = usePreviewControl({
    contextKey: JSON.stringify([controlContext, cameraView]),
    onCompleted: refreshAfterControl,
  });
  useEffect(() => {
    if (
      !controlEnabled ||
      activeWizard ||
      (!controlAvailable && !previewControl.busy)
    )
      setEnabledControlContext(undefined);
  }, [controlEnabled, controlAvailable, previewControl.busy, activeWizard]);
  /*
   * The raw view draws every screen the camera holds a perspective for, the way
   * the workstation stage did. The corrected view is already rectified, so an
   * outline there would double up with the transformed image.
   */
  const stageOutlines: ScreenOutlineEntry[] =
    cameraView === 'raw'
      ? (standalone && selected ? [selected] : availableScreens).flatMap(
          (screen) => {
            // A saved perspective is not an applied one: only paint what the
            // camera is actually rectifying right now.
            if (!screen.correction || screen.hasCorrection === false) return [];
            return [
              {
                id: screen.id,
                name: screen.name,
                correction: screen.correction,
                previewPositions:
                  screen.id === activeScreen?.id && !perspectiveBlocked
                    ? screen.previewPositions
                    : undefined,
                active: screen.id === activeScreen?.id,
                validity:
                  screen.id === deviceId
                    ? perspective.summary?.state
                    : undefined,
              },
            ];
          },
        )
      : [];
  return (
    <>
      {connected && arm.adapter?.connectionIdentity.startsWith('mock://') && (
        <Alert
          banner
          showIcon
          type="warning"
          message={
            language === 'zh'
              ? '模拟机械臂：不会连接或移动真实控制器，标定结果不能当作实测结果。'
              : 'Simulated arm: no controller is connected and no motion is sent. Calibration here is not physical evidence.'
          }
        />
      )}
      {(connected || (camera && selected)) && !activeWizard && (
        <div className="arm-manager-notices">
          {connected && (
            <Alert
              closable
              showIcon
              type={ready && !perspectiveBlocked ? 'success' : 'info'}
              message={
                <>
                  {ready &&
                    !perspectiveBlocked &&
                    (language === 'zh'
                      ? '设备已就绪，可通过 Midscene Connect 连接。'
                      : 'Device ready to connect with Midscene Connect. ')}
                  {language === 'zh'
                    ? '在「机械臂配置 → Midscene Connect」查看服务地址和 Token。'
                    : 'Find the service URL and token under Robot settings → Midscene Connect.'}
                </>
              }
            />
          )}
          {!depthCamera &&
            camera &&
            selected &&
            !switchingScreen &&
            ((connected && !robotReady) ||
            (!connected &&
              deviceSession === undefined &&
              status === 'ready') ? (
              <Alert
                showIcon
                type="warning"
                message={
                  language === 'zh'
                    ? '设备会话尚未同步'
                    : 'Device session is out of sync'
                }
                action={
                  <Button
                    size="small"
                    loading={status === 'loading'}
                    onClick={() => void Promise.all([check(), refresh(false)])}
                  >
                    {t('refresh')}
                  </Button>
                }
              />
            ) : !connected || !running || !deviceId ? (
              <Alert
                showIcon
                type="info"
                message={
                  connected
                    ? language === 'zh'
                      ? '启动相机后即可继续标定。'
                      : 'Start the camera to continue calibration.'
                    : language === 'zh'
                      ? '可先预览相机，连接机械臂后继续标定。'
                      : 'You can preview the camera before connecting the arm for calibration.'
                }
                action={
                  <Button
                    size="small"
                    disabled={connected && (starting || Boolean(pendingId))}
                    onClick={() =>
                      connected
                        ? void start(selected.id)
                        : setConnectionOpen(true)
                    }
                  >
                    {connected ? t('startCamera') : t('connect')}
                  </Button>
                }
              />
            ) : perspectiveBlocked || readiness?.status === 'required' ? (
              <Alert
                showIcon
                type="warning"
                message={
                  perspectiveBlocked
                    ? language === 'zh'
                      ? '屏幕映射已失效，请重新校正。'
                      : 'The screen mapping needs correction.'
                    : language === 'zh'
                      ? '请完成屏幕标定。'
                      : 'Complete screen calibration.'
                }
                action={
                  <Button
                    size="small"
                    onClick={
                      perspectiveBlocked
                        ? openCameraCorrection
                        : () => openCalibration(0, true)
                    }
                  >
                    {language === 'zh' ? '进入标定' : 'Open calibration'}
                  </Button>
                }
              />
            ) : readiness?.status === 'error' ? (
              <Alert
                showIcon
                type="error"
                message={
                  language === 'zh'
                    ? '无法检查设备标定'
                    : 'Unable to check calibration'
                }
                description={readiness.error}
                action={
                  <Button
                    size="small"
                    onClick={() =>
                      setConfigurationRevision((value) => value + 1)
                    }
                  >
                    {language === 'zh' ? '重试' : 'Retry'}
                  </Button>
                }
              />
            ) : null)}
          {imagingSwitchError && (
            <Alert
              showIcon
              type="warning"
              message={
                language === 'zh'
                  ? '相机参数未能切换到当前屏幕'
                  : 'Camera parameters did not switch to this screen'
              }
              description={imagingSwitchError}
            />
          )}
        </div>
      )}
      {connected && (
        <RobotStatusBar
          control={
            <Tooltip
              title={
                activeWizard
                  ? language === 'zh'
                    ? '点击标定向导右上角的「关闭」，返回相机画面后开启控制。'
                    : 'Close the calibration wizard to enable control in the camera preview.'
                  : controlAvailable
                    ? language === 'zh'
                      ? '点击屏幕为点击，按住 500ms 为长按，拖动为滑动。释放后执行。'
                      : 'Click to tap, hold for at least 500 ms to long press, or drag to swipe. Gestures execute on release.'
                    : controlUnavailableReason
              }
            >
              <Space>
                <span>{language === 'zh' ? '控制' : 'Control'}</span>
                <Switch
                  aria-label={language === 'zh' ? '控制屏幕' : 'Control screen'}
                  checked={controlEnabled}
                  disabled={!controlAvailable || previewControl.busy}
                  onChange={(enabled) =>
                    setEnabledControlContext(
                      enabled ? controlContext : undefined,
                    )
                  }
                />
              </Space>
            </Tooltip>
          }
          key={setupSession}
          cameraId={controlScreen}
          onConfigure={() => {
            if (!activeWizard) openCalibration();
          }}
          preparing={!ready}
          settings={
            <Button
              type="text"
              disabled={Boolean(activeWizard)}
              icon={<Settings2 size={16} />}
              onClick={() => setSettingsOpen(true)}
            >
              {language === 'zh' ? '机械臂配置' : 'Robot settings'}
            </Button>
          }
        />
      )}
      {activeWizard ? (
        <DeviceCalibration
          id={activeWizard.id}
          cameraId={activeWizard.cameraId}
          onScreenChange={setWizardScreen}
          onClose={closeCalibration}
          initialStep={activeWizard.step}
          reviewInstallationOnOpen={activeWizard.reviewInstallationOnOpen}
        />
      ) : camera && selected ? (
        <main className="app-workspace streams-section">
          <header className="camera-stage-header workspace-toolbar">
            <div className="workspace-toolbar-left">
              <div className="camera-stage-title">
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {selected.name}
                </Typography.Title>
                <div className="camera-stage-meta">
                  <Tag
                    color={
                      camera.stream?.state === 'running' ? 'green' : undefined
                    }
                  >
                    {t(cameraStateLabel(camera))}
                  </Tag>
                  {!depthCamera && viewpointCameras.length > 1 && (
                    <Select
                      className="camera-viewpoint-select"
                      aria-label={
                        language === 'zh' ? '相机位置' : 'Camera viewpoint'
                      }
                      value={selectedViewpoint}
                      placeholder={
                        language === 'zh' ? '标记位置' : 'Set viewpoint'
                      }
                      disabled={cameraViewpointDetecting}
                      loading={cameraViewpointSaving}
                      onChange={(viewpoint) =>
                        void assignCameraViewpoint(viewpoint)
                      }
                      popupMatchSelectWidth={false}
                      options={CAMERA_VIEWPOINT_OPTIONS.map((option) => ({
                        value: option.value,
                        label:
                          language === 'zh'
                            ? option.label
                            : option.value === 'front'
                              ? 'Eye level'
                              : 'Overhead',
                      }))}
                    />
                  )}
                  {!depthCamera && viewpointCameras.length > 1 && (
                    <Tooltip
                      title={
                        language === 'zh'
                          ? '自动判断相机位置'
                          : 'Auto-detect camera viewpoints'
                      }
                    >
                      <span className="camera-viewpoint-detect-wrap">
                        <Button
                          className="camera-viewpoint-detect"
                          type="text"
                          size="small"
                          aria-label={
                            language === 'zh'
                              ? '自动判断相机位置'
                              : 'Auto-detect camera viewpoints'
                          }
                          disabled={
                            cameraViewpointSaving ||
                            viewpointCameras.length !== 2
                          }
                          loading={cameraViewpointDetecting}
                          icon={<Camera size={16} />}
                          onClick={() => void detectCameraViewpoints()}
                        />
                      </span>
                    </Tooltip>
                  )}
                  {depthCamera && (
                    <Tag color="cyan">
                      {language === 'zh' ? '深度' : 'Depth'}
                    </Tag>
                  )}
                  <Typography.Text type="secondary">
                    {camera.stream?.width
                      ? `${camera.stream.width} × ${camera.stream.height}`
                      : t('noStream')}
                  </Typography.Text>
                </div>
              </div>
              {availableScreens.length > 1 && activeScreen && (
                <Select
                  className="camera-screen-select"
                  aria-label={language === 'zh' ? '标定屏幕' : 'Screen'}
                  value={activeScreen.id}
                  loading={switchingScreen}
                  onChange={(id) => {
                    setPreferredScreenId(id);
                    identifyScreen(selected.id, id);
                  }}
                  options={availableScreens.map((screen) => {
                    const uncalibrated = cameraScreenNeedsCalibration(screen);
                    return {
                      value: screen.id,
                      disabled: uncalibrated,
                      label: (
                        <span className="camera-screen-option">
                          <span className="camera-screen-option-name">
                            {screen.name}
                          </span>
                          {uncalibrated && (
                            <span className="camera-screen-option-status">
                              {t('uncalibrated')}
                            </span>
                          )}
                        </span>
                      ),
                    };
                  })}
                />
              )}
            </div>
            <div className="camera-stage-actions">
              {depthCamera &&
                (pairedColorCamera?.stream?.state === 'running' ||
                  depthFusionEnabled) && (
                  <DepthFusionControl
                    available={depthFusionAvailable}
                    blockedReason={depthFusionBlockedReason}
                    enabled={depthFusionActive}
                    onChange={setDepthFusionEnabled}
                    onOpacityChange={setDepthFusionOpacity}
                    opacity={depthFusionOpacity}
                  />
                )}
              {depthCamera && (
                <Segmented
                  className="rv-segmented"
                  aria-label={language === 'zh' ? '深度视图' : 'Depth view'}
                  disabled={!previewEnabled}
                  value={depthViewMode}
                  onChange={(value) => setDepthViewMode(value as '2d' | '3d')}
                  options={[
                    { value: '2d', label: '2D' },
                    { value: '3d', label: '3D' },
                  ]}
                />
              )}
              <Tooltip
                title={language === 'zh' ? '相机配置' : 'Camera profile'}
              >
                <Button
                  type="text"
                  aria-label={language === 'zh' ? '相机配置' : 'Camera profile'}
                  icon={<Edit3 size={16} />}
                  onClick={() => setCameraSettingsOpen(true)}
                />
              </Tooltip>
              {activeScreen && (standalone || (connected && setupSession)) && (
                <CameraPerspectiveActions
                  key={JSON.stringify([
                    selected.id,
                    activeScreen.id,
                    standalone,
                    setupSession,
                  ])}
                  cameraId={selected.id}
                  screen={activeScreen}
                  robot={
                    connected && setupSession
                      ? {
                          session: setupSession,
                          detect: openCameraCorrection,
                        }
                      : undefined
                  }
                  disabled={!previewEnabled}
                  onChanged={async (view) => {
                    setCameraView(view);
                    setPreviewRevision((n) => n + 1);
                    await refresh(false);
                  }}
                />
              )}
              {previewTarget && (
                <Segmented
                  className="rv-segmented"
                  aria-label={language === 'zh' ? '画面类型' : 'Camera view'}
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
                    // Reload the preview, not the device list: probing while
                    // this camera is capturing can disturb the stream.
                    void refresh(false);
                  }}
                />
              </Tooltip>
              <Tooltip title={cameraActionLabel}>
                <Button
                  type="text"
                  aria-label={cameraActionLabel}
                  icon={
                    previewEnabled ? (
                      <StopCircle size={16} />
                    ) : (
                      <Play size={16} />
                    )
                  }
                  loading={starting || pendingId === selected.id}
                  onClick={() => {
                    setPreviewError(undefined);
                    if (standalone) {
                      setPausedCamera(previewEnabled ? selected.id : undefined);
                      setPreviewRevision((n) => n + 1);
                    } else if (connected)
                      void (running ? stop(selected.id) : start(selected.id));
                  }}
                />
              </Tooltip>
              <span className="workspace-toolbar-divider" aria-hidden="true" />
              <Segmented
                className="rv-segmented"
                aria-label={language === 'zh' ? '3D 视角' : '3D view'}
                value={twinView}
                onChange={(value) => setTwinView(value as TwinViewPreset)}
                options={[
                  {
                    value: 'default',
                    label: language === 'zh' ? '默认视角' : 'Default',
                  },
                  {
                    value: 'camera',
                    label: language === 'zh' ? '相机视角' : 'Camera',
                  },
                  {
                    value: 'screen',
                    label: language === 'zh' ? '聚焦屏幕' : 'Screen',
                  },
                ]}
              />
            </div>
          </header>
          <div className="workspace-views">
            <section className="camera-stage">
              {!depthCamera && (
                <PerspectiveObservationCard
                  observation={perspective}
                  screenName={activeScreen?.name ?? selected.name}
                  onRecalibrate={openCameraCorrection}
                />
              )}
              <div className="camera-frame">
                <CameraStagePreview
                  actions={
                    <Button
                      size="small"
                      aria-controls={cameraRailId}
                      aria-expanded={cameraRailExpanded}
                      aria-label={cameraRailAction}
                      title={cameraRailAction}
                      icon={
                        cameraRailExpanded ? (
                          <ChevronUp size={16} />
                        ) : (
                          <ChevronDown size={16} />
                        )
                      }
                      onClick={() => setCameraRailExpanded((value) => !value)}
                    />
                  }
                  available={Boolean(
                    previewEnabled && previewError !== previewKey,
                  )}
                  outlines={stageOutlines}
                  frameSize={
                    depthCamera &&
                    selected.stream?.width &&
                    selected.stream.height
                      ? {
                          width: selected.stream.width,
                          height: selected.stream.height,
                        }
                      : cameraView === 'corrected'
                        ? previewTarget
                        : undefined
                  }
                >
                  {previewEnabled && previewError === previewKey ? (
                    <Empty
                      description={
                        language === 'zh'
                          ? '画面加载失败，请刷新重试'
                          : 'Preview unavailable. Refresh to retry.'
                      }
                    />
                  ) : depthCamera && depthViewMode === '3d' ? (
                    <DepthPointCloudView cameraId={selected.id} />
                  ) : previewEnabled && previewId ? (
                    depthCamera ? (
                      <>
                        <DepthCameraPreview
                          alt={
                            depthFusionActive
                              ? `${selected.name} · RGB + Depth`
                              : selected.name
                          }
                          depthWidth={selected.stream?.depth?.width}
                          depthHeight={selected.stream?.depth?.height}
                          imageRef={(image) => {
                            if (!image) return;
                            setFrame((previous) =>
                              previous?.key === previewKey &&
                              previous.image === image
                                ? previous
                                : {
                                    key: previewKey,
                                    width:
                                      image.naturalWidth ||
                                      selected.stream?.width ||
                                      0,
                                    height:
                                      image.naturalHeight ||
                                      selected.stream?.height ||
                                      0,
                                    image,
                                  },
                            );
                          }}
                          onError={() => setPreviewError(previewKey)}
                          onLoad={(image) => {
                            const width = image.naturalWidth;
                            const height = image.naturalHeight;
                            if (width && height)
                              setFrame({
                                key: previewKey,
                                width,
                                height,
                                image,
                              });
                          }}
                          onPointerSample={depthProbe.onPointerSample}
                          overlayOpacity={depthFusionOpacity}
                          overlaySrc={
                            depthFusionActive
                              ? `${cameraPreviewUrl(
                                  selected.id,
                                  'raw',
                                  'depth-overlay',
                                )}&revision=${encodeURIComponent(previewKey)}`
                              : undefined
                          }
                          src={
                            depthFusionActive
                              ? `${cameraPreviewUrl(
                                  pairedColorCamera.id,
                                  'raw',
                                  'depth-fusion',
                                )}&revision=${encodeURIComponent(previewKey)}`
                              : `${cameraPreviewUrl(
                                  selected.id,
                                  'raw',
                                  'depth-stage',
                                )}&revision=${encodeURIComponent(previewKey)}`
                          }
                        />
                        <DepthProbeOverlay sample={depthProbe.sample} />
                      </>
                    ) : (
                      <PreviewControl
                        key={previewKey}
                        activeScreenId={activeScreen?.id}
                        alt={
                          cameraView === 'corrected'
                            ? (activeScreen?.name ?? selected.name)
                            : selected.name
                        }
                        available={controlAvailable}
                        longPressEnabled={Boolean(
                          arm.capabilities?.screenActions.includes('longPress'),
                        )}
                        className="stream-preview"
                        control={previewControl}
                        enabled={controlEnabled}
                        onError={() => setPreviewError(previewKey)}
                        onLoad={(event) => {
                          const image = event.currentTarget;
                          const { naturalWidth: width, naturalHeight: height } =
                            image;
                          if (width && height)
                            setFrame((previous) =>
                              previous?.key === previewKey &&
                              previous.image === image &&
                              previous.width === width &&
                              previous.height === height
                                ? previous
                                : { key: previewKey, width, height, image },
                            );
                        }}
                        screens={controlScreens}
                        src={`${cameraPreviewUrl(previewId, cameraView)}&revision=${encodeURIComponent(previewKey)}`}
                        view={cameraView}
                      />
                    )
                  ) : starting ? (
                    <Spin aria-label={t('cameraStarting')} />
                  ) : (
                    <>
                      <VideoOff size={40} strokeWidth={1.25} />
                      <span>{t('noStream')}</span>
                    </>
                  )}
                </CameraStagePreview>
                <CameraRail
                  id={cameraRailId}
                  expanded={cameraRailExpanded}
                  entries={
                    standalone
                      ? railCameras.map((entry) =>
                          entry.id === camera.id ? camera : entry,
                        )
                      : railCameras
                  }
                  selectedId={selectedId}
                  selectedImage={
                    depthViewMode !== '3d' &&
                    previewEnabled &&
                    previewError !== previewKey &&
                    frame?.key === previewKey
                      ? frame.image
                      : undefined
                  }
                  onSelect={select}
                />
              </div>
              {(error || selected.error || selected.stream?.error) && (
                <Typography.Text type="danger" role="alert">
                  {error || selected.error || selected.stream?.error}
                </Typography.Text>
              )}
            </section>
            <TwinPanel
              key={JSON.stringify([
                setupSession,
                previewRevision,
                cameras
                  .filter((entry) => entry.stream?.state === 'running')
                  .map((entry) => entry.id),
              ])}
              connected={robotReady}
              viewPreset={twinView}
            />
          </div>
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
          {!connected && (
            <Button
              icon={<Cable size={16} />}
              onClick={() => setConnectionOpen(true)}
            >
              {t('connect')}
            </Button>
          )}
          {error && <Typography.Text type="danger">{error}</Typography.Text>}
        </section>
      )}
      <CameraProfileEditor
        camera={cameraSettingsOpen ? (selected ?? null) : null}
        error={cameraSettingsError}
        fallbackSettings={{ width: 1280, height: 720, fps: 30 }}
        saving={cameraSettingsSaving}
        onCancel={() => setCameraSettingsOpen(false)}
        onSave={(settings) => void saveCameraSettings(settings)}
      />
      {connected && (
        <Drawer
          rootClassName="robot-drawer robot-settings-drawer"
          title={language === 'zh' ? '机械臂配置' : 'Robot settings'}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          width={440}
          footer={
            <Button
              danger
              block
              icon={<Unplug size={16} />}
              onClick={disconnect}
            >
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
                  {language === 'zh'
                    ? '连接与标定'
                    : 'Connection & calibration'}
                </Typography.Text>
                {running && deviceId && (
                  <Button
                    icon={<ScanLine size={19} />}
                    onClick={() => {
                      setSettingsOpen(false);
                      openCalibration();
                    }}
                  >
                    {language === 'zh' ? '屏幕标定' : 'Screen Calibration'}
                  </Button>
                )}
                {running && deviceId && transferTargets.length > 1 && (
                  <Button
                    icon={<ArrowRightLeft size={18} />}
                    onClick={() => {
                      setTransferId(deviceId);
                    }}
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
            {settingsOpen && <ConnectSettings language={language} />}
            <section className="robot-settings-group">
              <Typography.Text type="secondary">
                {language === 'zh' ? '运动与记录' : 'Motion & history'}
              </Typography.Text>
              <ControllerMotionSettings arm={arm} />
              <ActionAudit />
              {running && deviceId && (
                <DeviceSettings
                  key={`${deviceId}:${configurationRevision}`}
                  id={deviceId!}
                  onRecorded={() => void refresh(false)}
                />
              )}
            </section>
          </div>
        </Drawer>
      )}
      <RobotConnectionDialog
        open={connectionOpen}
        onClose={() => setConnectionOpen(false)}
        title={language === 'zh' ? '连接配置' : 'Connection settings'}
      />
      {connected && transferId && (
        <DeviceTransfer
          key={transferId}
          id={transferId}
          cameras={transferTargets}
          onClose={() => {
            setTransferId(undefined);
          }}
        />
      )}
    </>
  );
}

function cameraViewpointUpdate(
  camera: CameraEntry,
  label: CameraViewpoint,
): CameraProfileUpdate {
  const fallback = camera.captureModes?.[0];
  return {
    name: camera.name,
    label,
    width:
      camera.stream?.width ??
      camera.captureSettings?.width ??
      fallback?.width ??
      640,
    height:
      camera.stream?.height ??
      camera.captureSettings?.height ??
      fallback?.height ??
      480,
    fps:
      camera.stream?.fps ?? camera.captureSettings?.fps ?? fallback?.fps ?? 30,
    verticalFlip: camera.verticalFlip === true,
    horizontalFlip: camera.horizontalFlip === true,
  };
}
