import type { EventEmitter } from 'node:events';
import type {
  CameraBackendName,
  CameraLabel,
} from '@midscene/robotics-shared/camera/profile';

export type {
  CameraBackendName,
  CameraLabel,
  CameraProfile,
} from '@midscene/robotics-shared/camera/profile';

export interface CameraDevice {
  id: string;
  name: string;
  backend: CameraBackendName;
  /** Defaults to `color` when a non-RealSense backend does not declare one. */
  kind?: CameraKind;
  /** The paired color/depth endpoint for a RealSense sensor. */
  pairedDeviceId?: string;
  /** Capture modes reported by a vendor SDK. */
  captureModes?: CameraCaptureMode[];
  /** Vendor SDK controls that can be changed for this device. */
  controls?: CameraControlCapability[];
  /** DirectShow enumeration index, used by the Windows hardware-control bridge. */
  controlIndex?: number;
  /** Live AVFoundation device type; absent when the backend cannot report it. */
  deviceType?: string;
  /** Discovered macOS capture mode, preferring resolutions up to 1080p. */
  defaultCaptureSettings?: { width: number; height: number; fps: number };
}

export type CameraKind = 'color' | 'depth';

export interface CameraIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

export interface CameraCaptureMode {
  width: number;
  height: number;
  fps: number;
  /** Pinhole intrinsics for the RGB frame used by this capture mode. */
  intrinsics?: CameraIntrinsics;
}

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

export type CameraControlProperty =
  | 'exposure'
  | 'focus'
  | 'gain'
  | 'brightness'
  | 'contrast'
  | 'whiteBalance';
export type CameraControlMode = 'auto' | 'manual';

export interface CameraControlValue {
  property: CameraControlProperty;
  value: number;
  mode: CameraControlMode;
  min: number;
  max: number;
  step: number;
  default: number;
  supportsAuto: boolean;
  supportsManual: boolean;
}

export interface CameraHardwareControl {
  readonly deviceId: string;
  read(): Promise<Partial<Record<CameraControlProperty, CameraControlValue>>>;
  set(
    property: CameraControlProperty,
    value: number,
    mode: CameraControlMode,
  ): Promise<void>;
  close(): Promise<void>;
}

export interface CameraStreamOptions {
  deviceId: string;
  width?: number;
  height?: number;
  fps?: number;
  kind?: CameraKind;
  /** Mirror top-to-bottom, the reference project's `vertical_flip`. */
  verticalFlip?: boolean;
  /** Mirror left-to-right, the reference project's `horizontal_flip`. */
  horizontalFlip?: boolean;
  /** Depth SDK option values keyed by the backend capability key. */
  depthControls?: Record<string, number>;
}

export interface ResolvedCameraStreamOptions {
  deviceId: string;
  width: number;
  height: number;
  fps: number;
  /** Defaults to `color` when a backend is opened directly without one. */
  kind?: CameraKind;
  verticalFlip: boolean;
  horizontalFlip: boolean;
  depthControls?: Record<string, number>;
}

export interface DepthFrame {
  id: number;
  capturedAt: number;
  width: number;
  height: number;
  /** Metres represented by one unit in `data`. */
  depthScaleMeters: number;
  /** Row-major little-endian uint16 values. Zero means no measurement. */
  data: Buffer;
  /** Pixel frame the depth map was aligned to. */
  alignedTo?: 'color';
}

export interface CameraFrame {
  capture?: ResolvedCameraStreamOptions;
  id: number;
  capturedAt: number;
  jpeg: Buffer;
  /** RGB JPEG captured in the same composite frame as aligned depth. */
  alignedColorJpeg?: Buffer;
  depth?: DepthFrame;
}

/** A frame emitted by a backend before stream metadata is attached. */
export interface CameraSourceFrame {
  jpeg: Buffer;
  alignedColorJpeg?: Buffer;
  depth?: Omit<DepthFrame, 'id' | 'capturedAt'>;
}

export interface CameraSource extends EventEmitter {
  close(): Promise<void>;
}

export interface CameraBackend {
  listDevices(): Promise<CameraDevice[]>;
  openStream(
    options: ResolvedCameraStreamOptions,
    signal?: AbortSignal,
  ): Promise<CameraSource>;
  /** Optional platform bridge for camera imaging controls. */
  openHardwareControl?(
    deviceId: string,
  ): Promise<CameraHardwareControl | undefined>;
}

export type CameraStreamState = 'starting' | 'running' | 'failed' | 'stopped';

export interface CameraStreamInfo {
  id: string;
  deviceId: string;
  width: number;
  height: number;
  fps: number;
  /** Defaults to `color` for streams created by older clients. */
  kind?: CameraKind;
  state: CameraStreamState;
  frameId: number;
  lastFrameAt?: number;
  error?: string;
  /** A frame has been received at least once for this stream. */
  hasFrame: boolean;
  /** Milliseconds since the latest frame was captured. */
  frameAgeMs?: number;
  /** Measured frame rate over the recent frame window. */
  actualFps?: number;
  depth?: {
    scaleMeters: number;
    width: number;
    height: number;
    alignedTo?: 'color';
  };
}

export const CAMERA_LABELS: readonly CameraLabel[] = [
  'front',
  'back',
  'left',
  'right',
  'top',
  'bottom',
];
