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
export interface CameraEntry extends CameraScreen {
  kind?: CameraKind;
  pairedDeviceId?: string;
  captureModes?: CameraCaptureMode[];
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
