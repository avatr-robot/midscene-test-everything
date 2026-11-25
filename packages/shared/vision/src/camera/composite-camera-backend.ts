import { RobotVisionError } from './errors.js';
import type {
  CameraBackend,
  CameraDevice,
  CameraSource,
  ResolvedCameraStreamOptions,
} from './types.js';

type CameraBackendLog = (message: string, ...args: unknown[]) => void;

/**
 * Routes each device to the backend that can capture it. A missing optional
 * backend, such as RealSense without pyrealsense2 installed, does not hide the
 * conventional cameras discovered by the other backends.
 */
export class CompositeCameraBackend implements CameraBackend {
  private readonly deviceBackends = new Map<string, CameraBackend>();
  private readonly loggedFailures = new Set<CameraBackend>();

  constructor(
    private readonly backends: readonly CameraBackend[],
    private readonly logger?: CameraBackendLog,
  ) {
    if (backends.length === 0)
      throw new Error('CompositeCameraBackend needs at least one backend');
  }

  async listDevices(): Promise<CameraDevice[]> {
    const results = await Promise.allSettled(
      this.backends.map((backend) => backend.listDevices()),
    );
    const devices: CameraDevice[] = [];
    const nextRoutes = new Map<string, CameraBackend>();
    let firstError: unknown;
    for (const [index, result] of results.entries()) {
      const backend = this.backends[index]!;
      if (result.status === 'rejected') {
        firstError ??= result.reason;
        if (!this.loggedFailures.has(backend)) {
          this.loggedFailures.add(backend);
          this.logger?.('Camera backend enumeration failed', {
            backend: backend.constructor.name,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          });
        }
        continue;
      }
      this.loggedFailures.delete(backend);
      for (const device of result.value) {
        if (nextRoutes.has(device.id)) {
          this.logger?.('Duplicate camera device ignored', {
            deviceId: device.id,
            backend: backend.constructor.name,
          });
          continue;
        }
        nextRoutes.set(device.id, backend);
        devices.push(device);
      }
    }
    if (devices.length === 0 && firstError) throw firstError;
    this.deviceBackends.clear();
    for (const [id, backend] of nextRoutes)
      this.deviceBackends.set(id, backend);
    return devices;
  }

  async openStream(
    options: ResolvedCameraStreamOptions,
  ): Promise<CameraSource> {
    let backend = this.deviceBackends.get(options.deviceId);
    if (!backend) {
      await this.listDevices();
      backend = this.deviceBackends.get(options.deviceId);
    }
    if (!backend) {
      throw new RobotVisionError(
        'DEVICE_NOT_FOUND',
        `Camera device not found: ${options.deviceId}`,
      );
    }
    return backend.openStream(options);
  }
}
