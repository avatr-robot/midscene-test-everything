import type {
  CalibrationImagingStatus,
  CalibrationPreviewPositions,
} from '@midscene/robotics-shared/assisted-contracts';
import type { PerspectiveTarget } from '@midscene/robotics-shared/camera/vision-types';
import type { CameraCorrection } from '@midscene/robotics-shared/contracts';
import { create } from 'zustand';

export type ScreenControlReason =
  | 'CALIBRATION_REQUIRED'
  | 'SCREEN_MAPPING_REQUIRED'
  | 'MAPPING_REQUIRED'
  | 'CONFIGURATION_UNAVAILABLE';
export interface CameraScreenControl {
  id: string;
  calibrationId?: string;
  calibrationAccepted: boolean;
  pixelWidth?: number;
  pixelHeight?: number;
  ready: boolean;
  reason?: ScreenControlReason;
}
export interface CameraScreen {
  id: string;
  name: string;
  hasCorrection?: boolean;
  correction?: CameraCorrection;
  previewPositions?: CalibrationPreviewPositions;
  perspectiveTarget?: PerspectiveTarget;
  /** Per-screen readiness for manual camera-view control. */
  control?: CameraScreenControl;
}
export type CameraKind = 'color' | 'depth';
export interface CameraControlChoice {
  value: number;
  label: string;
}
export interface CameraControlCapability {
  key: string;
  label: string;
  description?: string;
  type: 'boolean' | 'number' | 'select';
  choices?: CameraControlChoice[];
  min: number;
  max: number;
  step: number;
  default: number;
  value: number;
}
export interface CameraCaptureMode {
  width: number;
  height: number;
  fps: number;
}
export interface CaptureResolution {
  key: string;
  width: number;
  height: number;
}
export interface CameraCaptureSettings {
  width: number;
  height: number;
  fps: number;
}
export type CameraLabel =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom';
export type CameraViewpoint = 'front' | 'top';
export const CAMERA_VIEWPOINT_OPTIONS: {
  value: CameraViewpoint;
  label: string;
}[] = [
  { value: 'front', label: '平视' },
  { value: 'top', label: '俯视' },
];
export interface CameraProfileUpdate extends CameraCaptureSettings {
  name: string;
  label: CameraLabel | null;
  verticalFlip: boolean;
  horizontalFlip: boolean;
  depthControls?: Record<string, number>;
}
export const CAMERA_LABEL_OPTIONS: { value: CameraLabel; label: string }[] = [
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
];
export type FlipMode = 'none' | 'vertical' | 'horizontal' | 'both';
export const FLIP_OPTIONS: { value: FlipMode; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'vertical', label: 'Vertical' },
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'both', label: 'Both' },
];
export const WIDTH_RANGE = { min: 160, max: 7680 };
export const HEIGHT_RANGE = { min: 120, max: 4320 };
export const FPS_RANGE = { min: 1, max: 120 };

export function cameraViewpointOf(
  label: CameraLabel | null | undefined,
): CameraViewpoint | undefined {
  return label === 'front' || label === 'top' ? label : undefined;
}

export function cameraViewpointCandidates<
  T extends {
    kind?: CameraKind;
    stream?: { state: string };
  },
>(cameras: readonly T[]): T[] {
  return cameras.filter(
    (camera) =>
      camera.kind !== 'depth' &&
      (camera.stream?.state === 'running' ||
        camera.stream?.state === 'starting'),
  );
}

export function cameraViewpointAssignments(
  cameras: readonly Pick<CameraEntry, 'id' | 'kind' | 'label'>[],
  selectedId: string,
  viewpoint: CameraViewpoint,
): Array<{ id: string; label: CameraViewpoint }> {
  const selected = cameras.find((camera) => camera.id === selectedId);
  if (!selected) return [];
  const other = cameras.find(
    (camera) =>
      camera.id !== selectedId &&
      camera.kind !== 'depth' &&
      cameraViewpointOf(camera.label) ===
        (viewpoint === 'top' ? 'front' : 'top'),
  );
  const fallback = cameras.find(
    (camera) => camera.id !== selectedId && camera.kind !== 'depth',
  );
  const counterpart = other ?? fallback;
  if (!counterpart) return [];
  return [
    { id: selectedId, label: viewpoint },
    {
      id: counterpart.id,
      label: viewpoint === 'top' ? 'front' : 'top',
    },
  ];
}

export function captureResolutionKey(
  settings: Pick<CameraCaptureSettings, 'width' | 'height'>,
) {
  return `${settings.width}x${settings.height}`;
}

export function captureResolutions(
  modes: readonly CameraCaptureMode[] | undefined,
): CaptureResolution[] {
  const resolutions = new Map<string, CaptureResolution>();
  for (const mode of modes ?? []) {
    const key = captureResolutionKey(mode);
    resolutions.set(key, { key, width: mode.width, height: mode.height });
  }
  return [...resolutions.values()].sort(
    (left, right) => right.width - left.width || right.height - left.height,
  );
}

export function captureFrameRates(
  modes: readonly CameraCaptureMode[] | undefined,
  settings: Pick<CameraCaptureSettings, 'width' | 'height'>,
): number[] {
  const key = captureResolutionKey(settings);
  return [
    ...new Set(
      (modes ?? [])
        .filter((mode) => captureResolutionKey(mode) === key)
        .map((mode) => mode.fps),
    ),
  ].sort((left, right) => right - left);
}

export function resolveSupportedCaptureSettings(
  settings: CameraCaptureSettings,
  modes: readonly CameraCaptureMode[] | undefined,
): CameraCaptureSettings {
  if (!modes?.length) return settings;
  const resolutions = captureResolutions(modes);
  const selected =
    resolutions.find(
      (candidate) => candidate.key === captureResolutionKey(settings),
    ) ??
    resolutions.reduce<CaptureResolution | undefined>((nearest, candidate) => {
      if (!nearest) return candidate;
      const distance =
        Math.abs(candidate.width - settings.width) +
        Math.abs(candidate.height - settings.height);
      const nearestDistance =
        Math.abs(nearest.width - settings.width) +
        Math.abs(nearest.height - settings.height);
      return distance < nearestDistance ? candidate : nearest;
    }, undefined);
  if (!selected) return settings;
  const frameRates = captureFrameRates(modes, selected);
  return {
    width: selected.width,
    height: selected.height,
    fps: frameRates.includes(settings.fps)
      ? settings.fps
      : (frameRates[0] ?? settings.fps),
  };
}

export function flipModeOf(
  camera: Pick<CameraEntry, 'verticalFlip' | 'horizontalFlip'>,
): FlipMode {
  if (camera.verticalFlip && camera.horizontalFlip) return 'both';
  if (camera.verticalFlip) return 'vertical';
  if (camera.horizontalFlip) return 'horizontal';
  return 'none';
}

export function flipFlagsOf(mode: FlipMode) {
  return {
    verticalFlip: mode === 'vertical' || mode === 'both',
    horizontalFlip: mode === 'horizontal' || mode === 'both',
  };
}
export interface CameraEntry extends CameraScreen {
  deviceName?: string;
  label?: CameraLabel;
  profileKey?: string;
  verticalFlip?: boolean;
  horizontalFlip?: boolean;
  online?: boolean;
  kind?: CameraKind;
  pairedDeviceId?: string;
  captureModes?: CameraCaptureMode[];
  captureSettings?: CameraCaptureSettings;
  controls?: CameraControlCapability[];
  depthControls?: Record<string, number>;
  previewScreenId?: string;
  screens?: CameraScreen[];
  error?: string;
  imaging?: CalibrationImagingStatus;
  stream?: {
    state: string;
    width: number;
    height: number;
    fps?: number;
    actualFps?: number;
    hasFrame: boolean;
    error?: string;
    depth?: {
      scaleMeters: number;
      width: number;
      height: number;
      alignedTo?: 'color';
    };
  };
}

export function cameraScreenNeedsCalibration(screen: CameraScreen) {
  return screen.hasCorrection !== true;
}

export function selectCameraScreen(
  screens: readonly CameraScreen[],
  preferredIds: readonly (string | undefined)[],
) {
  const calibrated = screens.filter(
    (screen) => !cameraScreenNeedsCalibration(screen),
  );
  const candidates = calibrated.length > 0 ? calibrated : screens;
  for (const id of preferredIds) {
    const screen = candidates.find((candidate) => candidate.id === id);
    if (screen) return screen;
  }
  return candidates[0];
}

export function cameraStateLabel(camera: CameraEntry) {
  switch (camera.stream?.state) {
    case 'running':
      return 'running';
    case 'starting':
      return 'cameraStarting';
    case 'failed':
      return 'cameraFailed';
    default:
      return camera.error ? 'cameraFailed' : 'stopped';
  }
}

/** The RGB endpoint is folded into the depth card while fusion is active. */
export function cameraRailEntries(
  cameras: CameraEntry[],
  selected: CameraEntry | undefined,
  depthFusionEnabled: boolean,
) {
  if (
    !depthFusionEnabled ||
    selected?.kind !== 'depth' ||
    !selected.pairedDeviceId
  )
    return cameras;
  return cameras.filter((camera) => camera.id !== selected.pairedDeviceId);
}
type CameraStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
// Camera records are discovered by the Node host, never manually created in UI.
// Preserve the original listCameras response shape at this migration boundary.
let listRevision = 0;
export const useCameras = create<{
  cameras: CameraEntry[];
  deviceSession?: string | null;
  selectedId: string | null;
  status: CameraStatus;
  select: (id: string) => void;
  error?: string;
  pendingId?: string;
  start: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  refresh: (discover?: boolean) => Promise<void>;
}>((set, get) => ({
  cameras: [],
  selectedId: (() => {
    try {
      return sessionStorage.getItem('arm-playground-device');
    } catch {
      return null;
    }
  })(),
  status: 'idle',
  start: async (id) => {
    if (get().pendingId) return;
    set({ pendingId: id, error: undefined });
    try {
      await cameraRequest('start', id);
      // The stream just opened; do not probe the device list again.
      await get().refresh(false);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ pendingId: undefined });
    }
  },
  stop: async (id) => {
    if (get().pendingId) return;
    set({ pendingId: id, error: undefined });
    try {
      await cameraRequest('stop', id);
      await get().refresh(false);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ pendingId: undefined });
    }
  },
  select: (selectedId) => {
    set({ selectedId });
    try {
      sessionStorage.setItem('arm-playground-device', selectedId);
    } catch {
      // Selection still works when browser storage is unavailable.
    }
  },
  refresh: async (discover = true) => {
    const revision = ++listRevision;
    set({ status: 'loading' });
    try {
      const response = await fetch(
        discover ? '/api/cameras?refresh=true' : '/api/cameras',
        {
          // Device enumeration can take several seconds while cameras stream.
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (revision !== listRevision) return;
      if (
        response.status === 404 ||
        response.headers.get('content-type')?.includes('text/html')
      ) {
        set({ status: 'unavailable', cameras: [], selectedId: null });
        return;
      }
      if (!response.ok) throw new Error('Camera discovery failed');
      const data: unknown = await response.json();
      if (
        !data ||
        typeof data !== 'object' ||
        !('cameras' in data) ||
        !Array.isArray(data.cameras) ||
        !data.cameras.every(
          (camera: unknown) =>
            camera &&
            typeof camera === 'object' &&
            'id' in camera &&
            typeof camera.id === 'string' &&
            'name' in camera &&
            typeof camera.name === 'string',
        )
      )
        throw new Error('Invalid camera list');
      if (revision !== listRevision) return;
      const cameras = data.cameras as CameraEntry[];
      set({
        cameras,
        deviceSession:
          'deviceSession' in data &&
          (typeof data.deviceSession === 'string' ||
            data.deviceSession === null)
            ? data.deviceSession
            : undefined,
        error:
          'error' in data && typeof data.error === 'string'
            ? data.error
            : undefined,
        status: 'ready',
        selectedId: cameras.some((camera) => camera.id === get().selectedId)
          ? get().selectedId
          : (cameras[0]?.id ?? null),
      });
    } catch (error) {
      if (revision !== listRevision) return;
      set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));

async function cameraRequest(action: 'start' | 'stop', id: string) {
  const response = await fetch(`/api/cameras/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Camera request failed');
}

export async function activateCameraImaging(
  cameraId: string,
  screenId: string,
) {
  const response = await fetch('/api/cameras/imaging/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: cameraId, screenId }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json()) as {
    error?: string;
    imaging?: CalibrationImagingStatus;
  };
  if (!response.ok)
    throw new Error(data.error || 'Camera imaging switch failed');
  return data.imaging;
}

export async function updateCameraCaptureSettings(
  cameraId: string,
  settings: CameraProfileUpdate,
): Promise<{
  settings: CameraCaptureSettings &
    Partial<Pick<CameraEntry, 'verticalFlip' | 'horizontalFlip'>> & {
      name?: string;
      label?: CameraLabel;
    };
  stream?: CameraEntry['stream'];
}> {
  const response = await fetch('/api/cameras/capture-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: cameraId, ...settings }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json()) as {
    error?: string;
    settings?: CameraCaptureSettings & {
      name?: string;
      label?: CameraLabel;
      verticalFlip?: boolean;
      horizontalFlip?: boolean;
    };
    stream?: CameraEntry['stream'];
  };
  if (!response.ok || !data.settings)
    throw new Error(data.error || 'Camera settings update failed');
  return { settings: data.settings, stream: data.stream };
}

export interface CameraViewpointInferenceResult {
  overheadCameraId: string;
  eyeLevelCameraId: string;
  confidence: number;
  reason?: string;
}

export async function inferCameraViewpoints(
  cameraIds: readonly [string, string],
  model: {
    provider: string;
    modelName: string;
    modelFamily: string;
    baseUrl: string;
    apiKey: string;
  },
): Promise<CameraViewpointInferenceResult> {
  const response = await fetch('/api/cameras/viewpoints/infer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cameraIds, model }),
    signal: AbortSignal.timeout(60_000),
  });
  const data =
    (await response.json()) as Partial<CameraViewpointInferenceResult> & {
      error?: string;
    };
  if (!response.ok)
    throw new Error(data.error || 'Camera viewpoint inference failed');
  if (
    typeof data.overheadCameraId !== 'string' ||
    typeof data.eyeLevelCameraId !== 'string' ||
    !cameraIds.includes(data.overheadCameraId) ||
    !cameraIds.includes(data.eyeLevelCameraId) ||
    data.overheadCameraId === data.eyeLevelCameraId
  )
    throw new Error(
      'Camera viewpoint inference returned an invalid camera mapping',
    );
  return {
    overheadCameraId: data.overheadCameraId,
    eyeLevelCameraId: data.eyeLevelCameraId,
    confidence:
      typeof data.confidence === 'number' && Number.isFinite(data.confidence)
        ? Math.min(1, Math.max(0, data.confidence))
        : 0.5,
    ...(typeof data.reason === 'string' && data.reason.trim()
      ? { reason: data.reason.trim() }
      : {}),
  };
}
