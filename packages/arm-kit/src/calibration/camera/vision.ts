import type {
  CalibrationPageLayout,
  CameraMappingAccuracy,
} from '../../assisted-contracts.js';
import type { VisionBinding, VisionSnapshot } from '../../contracts.js';

export interface CalibrationVisionOptions {
  cameraId: string;
  width: number;
  height: number;
}
/** In-process seam shared by SDK calibration and the Playground host. */
export interface CalibrationVision {
  /** Optional for injected providers; built-in cameras verify current outlines. */
  assertPerspectiveCurrent?(): Promise<void>;
  binding(options: CalibrationVisionOptions): Promise<VisionBinding>;
  snapshot(options: CalibrationVisionOptions): Promise<VisionSnapshot>;
  detectMarkers(
    jpeg: Buffer,
    markers: CalibrationPageLayout['markers'],
  ): Promise<{
    webToImage: number[];
    markerErrorPx: number;
    accuracy?: CameraMappingAccuracy;
  }>;
}
