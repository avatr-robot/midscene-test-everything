import type {
  CalibrationPageLayout,
  CameraMappingAccuracy,
} from '../../assisted-contracts.js';
import type { CalibrationImagingStatus } from '../../assisted-contracts.js';
import type {
  CameraCorrection,
  VisionBinding,
  VisionSnapshot,
} from '../../contracts.js';

export interface CalibrationVisionOptions {
  cameraId: string;
  width: number;
  height: number;
}

interface DetectedMarkerMapping {
  webToImage: number[];
  markerErrorPx: number;
  accuracy?: CameraMappingAccuracy;
}
/** In-process seam shared by SDK calibration and the Playground host. */
export interface CalibrationVision {
  rawFrame?(): Promise<Buffer>;
  withMarkerImaging?<T>(capture: () => Promise<T>): Promise<T>;
  calibrateImaging?(): Promise<CalibrationImagingStatus>;
  imagingStatus?(): CalibrationImagingStatus;
  releaseImaging?(): Promise<void>;
  getCorrection?(): CameraCorrection | undefined;
  /** Optional for injected providers; built-in cameras verify current outlines. */
  assertPerspectiveCurrent?(): Promise<void>;
  binding(options: CalibrationVisionOptions): Promise<VisionBinding>;
  snapshot(options: CalibrationVisionOptions): Promise<VisionSnapshot>;
  detectMarkers(
    jpeg: Buffer,
    markers: CalibrationPageLayout['markers'],
  ): Promise<DetectedMarkerMapping>;
  detectMarkersInSource?(
    binding: VisionBinding,
    layout: CalibrationPageLayout,
  ): Promise<DetectedMarkerMapping>;
}
