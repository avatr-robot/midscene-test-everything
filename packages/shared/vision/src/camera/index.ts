import { CompositeCameraBackend } from './composite-camera-backend.js';
import { DeviceRegistry } from './device-registry.js';
import { FfmpegCameraBackend } from './ffmpeg-camera-backend.js';
import {
  MacosCameraBackend,
  type MacosCameraBackendOptions,
} from './macos-camera-backend.js';
import { RealsenseCameraBackend } from './realsense-camera-backend.js';
import type { CameraDevice } from './types.js';

let registry: DeviceRegistry | undefined;
export function cameraBackend(
  options?: MacosCameraBackendOptions,
): DeviceRegistry {
  registry ??= new DeviceRegistry(
    new CompositeCameraBackend([
      new RealsenseCameraBackend(),
      process.platform === 'darwin'
        ? new MacosCameraBackend(options)
        : new FfmpegCameraBackend(),
    ]),
  );
  return registry;
}
export async function listCameras(
  options: {
    refresh?: boolean;
    cachedOnly?: boolean;
    includeBuiltIn?: boolean;
  } = {},
): Promise<CameraDevice[]> {
  const cameras = await cameraBackend().listDevices({
    refresh: options.refresh,
    cachedOnly: options.cachedOnly,
  });
  return options.includeBuiltIn
    ? cameras
    : cameras.filter(
        (camera) =>
          camera.deviceType !== 'AVCaptureDeviceTypeBuiltInWideAngleCamera' &&
          !/facetime|built.?in|内建/i.test(camera.name),
      );
}
export { CameraStreamManager } from './camera-stream-manager.js';
export { CompositeCameraBackend } from './composite-camera-backend.js';
export {
  RealsenseCameraBackend,
  type RealsenseCameraBackendOptions,
} from './realsense-camera-backend.js';
export {
  RealsenseCaptureGroup,
  RealsenseStreamSource,
} from './realsense-capture-group.js';
export {
  type RealsenseCombinedFrame,
  RealsenseFrameParser,
  RealsenseProcessCameraSource,
} from './realsense-process-camera-source.js';
export {
  cameraKind,
  isRealsenseCaptureEndpointName,
  isRealsenseColorEndpointName,
  isRealsenseDepthEndpointName,
} from './camera-kind.js';
export type {
  CameraCaptureMode,
  CameraDevice,
  CameraBackend,
  CameraFrame,
  CameraIntrinsics,
  CameraKind,
  CameraSourceFrame,
  CameraStreamInfo,
  DepthFrame,
} from './types.js';
