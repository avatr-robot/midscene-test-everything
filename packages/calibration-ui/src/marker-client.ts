import type {
  LanAddress,
  MarkerCalibrationAddTargetResult,
  MarkerCalibrationCreateResult,
  MarkerCalibrationDetectionResponse,
  MarkerCalibrationSession,
  ScreenDeviceSummary,
  TargetDisplayCreateInput,
  TargetDisplaySession,
} from '@midscene/arm-kit-shared/marker-contracts';
import { t } from './i18n';
export type {
  ScreenDeviceSummary,
  TargetDisplaySession,
  LanAddress,
} from '@midscene/arm-kit-shared/marker-contracts';
export class RobotVisionApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export async function markerRequest<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok)
    throw new RobotVisionApiError(
      t(value.error?.message ?? value.error ?? 'Screen request failed'),
      value.code,
      value.details,
    );
  return value;
}
/** Local transport for the original marker-calibration UI. */
export class RobotVisionClient {
  constructor(readonly cameraId: string) {}
  private request<T>(action: string, body: unknown) {
    return markerRequest<T>('/api/marker-calibrations', {
      cameraId: this.cameraId,
      action,
      ...(body as object),
    });
  }
  createMarkerCalibration(
    _streamId: string,
    names?: string[],
    screenId?: string,
    screenIds?: string[],
  ) {
    return this.request<MarkerCalibrationCreateResult>('create', {
      names,
      screenIds: screenIds ?? (screenId ? [screenId] : undefined),
    });
  }
  markerCalibrationStatus(id: string, token: string) {
    return this.request<MarkerCalibrationSession>('status', { id, token });
  }
  cancelMarkerCalibration(id: string, token: string) {
    return this.request<void>('cancel', { id, token });
  }
  addMarkerCalibrationTarget(id: string, token: string, name: string) {
    return this.request<MarkerCalibrationAddTargetResult>('add', {
      id,
      token,
      name,
    });
  }
  removeMarkerCalibrationTarget(id: string, targetId: string, token: string) {
    return this.request<MarkerCalibrationSession>('remove', {
      id,
      token,
      targetId,
    });
  }
  detectMarkerCalibration(
    id: string,
    token: string,
    targetIds?: string[],
    options?: { temporal?: boolean },
  ) {
    return this.request<MarkerCalibrationDetectionResponse>('detect', {
      id,
      token,
      targetIds,
      ...options,
    });
  }
  applyMarkerCalibration(id: string, token: string) {
    return this.request<{ screenIds: string[] }>('apply', { id, token });
  }
}
export function screenDeviceUrl(publicUrl: string, address?: string) {
  const url = new URL(publicUrl);
  if (address) url.hostname = address;
  return url.href;
}
export class ScreenCalibClient {
  constructor(readonly cameraId?: string) {}
  private request<T>(action: string, body: unknown = {}) {
    return markerRequest<T>('/api/screen-pages', {
      cameraId: this.cameraId,
      action,
      ...(body as object),
    });
  }
  installationConnection() {
    return this.listScreenDevices();
  }
  listScreenDevices() {
    return this.request<{
      devices: ScreenDeviceSummary[];
      addresses: LanAddress[];
      publicUrl: string;
      publicUrlConfigured?: boolean;
      pairing?: { path: string; code: string };
    }>('list');
  }
  listTargetDisplays() {
    return this.request<TargetDisplaySession[]>('displays');
  }
  createTargetDisplay(input: TargetDisplayCreateInput) {
    return this.request<TargetDisplaySession>('create-display', input);
  }
  closeTargetDisplay(id: string) {
    return this.request<void>('close-display', { id });
  }
  assignScreenDevice(
    id: string,
    input: {
      role: 'markers' | 'mapping';
      targetDisplayId?: string;
      cameraId?: string;
    },
  ) {
    return this.request<{ device: ScreenDeviceSummary }>('assign', {
      id,
      ...input,
    });
  }
  releaseScreenDevice(id: string) {
    return this.request<void>('release', { id });
  }
  restoreScreenDeviceHome(id: string) {
    return this.request<void>('release', { id, keepBinding: true });
  }
  renameScreen(cameraId: string, id: string, name: string) {
    return this.request<void>('rename-screen', { cameraId, id, name });
  }
  renameScreenDevice(id: string, name: string) {
    return this.request<void>('rename', { id, name });
  }
  createScreenBindLink(input: {
    visionSessionId: string;
    targets: { id: string; token: string }[];
    language: string;
  }) {
    return this.request<{ path: string; expiresAt: number }>(
      'bind-link',
      input,
    );
  }
}
