import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CalibrationVision,
  CalibrationVisionOptions,
} from '../calibration/camera/vision.js';
import {
  type CameraCorrection,
  RobotArmError,
  type VisionBinding,
  type VisionSnapshot,
} from '../contracts.js';
import { detectCalibrationMarkers } from './calibration-markers.js';
import { CameraStreamManager } from './camera-stream-manager.js';
import type { CameraStream } from './camera-stream.js';
import { cameraBackend } from './index.js';
import { jpegSize } from './jpeg-size.js';
import { PerspectiveTransformer } from './perspective-transformer.js';
import type { CameraBackend, CameraDevice } from './types.js';
import { validateQuad } from './vision-geometry.js';

export type { CameraCorrection } from '../contracts.js';
/** Camera, current image correction and identity used by Device and calibration. */
export class CameraSession implements CalibrationVision {
  private correction?: CameraCorrection;
  private writeChain = Promise.resolve();
  private readonly transformer = new PerspectiveTransformer();
  constructor(
    readonly camera: CameraDevice,
    readonly stream: CameraStream,
    private readonly directory: string,
  ) {}
  private get correctionFile() {
    return path.join(
      this.directory,
      `${createHash('sha256').update(this.camera.id).digest('hex')}.json`,
    );
  }
  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.correctionFile, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const data = JSON.parse(raw);
    if (data.cameraId !== this.camera.id)
      throw new Error('Stored camera identity does not match');
    this.validate(data.correction);
    this.correction = data.correction;
  }
  getCorrection(): CameraCorrection | undefined {
    return this.correction && structuredClone(this.correction);
  }
  private validate(correction: CameraCorrection): void {
    if (
      !correction ||
      !Number.isInteger(correction.sourceWidth) ||
      !Number.isInteger(correction.sourceHeight) ||
      correction.sourceWidth < 1 ||
      correction.sourceHeight < 1 ||
      ![0, 90, 180, 270].includes(correction.rotation)
    )
      throw new Error('Invalid camera correction');
    validateQuad(correction.points);
    for (const point of Object.values(correction.points))
      if (
        point.x < 0 ||
        point.x >= correction.sourceWidth ||
        point.y < 0 ||
        point.y >= correction.sourceHeight
      )
        throw new Error('Camera corner lies outside the source image');
  }
  setCorrection(input: CameraCorrection): Promise<void> {
    this.validate(input);
    const correction = structuredClone(input);
    const operation = this.writeChain.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const temporary = `${this.correctionFile}.${randomUUID()}.tmp`;
      await writeFile(
        temporary,
        JSON.stringify({ cameraId: this.camera.id, correction }),
        { mode: 0o600 },
      );
      await rename(temporary, this.correctionFile);
      this.correction = correction;
    });
    this.writeChain = operation.catch(() => undefined);
    return operation;
  }
  async rawFrame(): Promise<Buffer> {
    const info = this.stream.getInfo();
    if (info.state !== 'running' && info.state !== 'starting')
      throw new RobotArmError(
        'VISION_UNAVAILABLE',
        info.error ?? 'Camera is not running',
      );
    return (await this.stream.getFrame({ fresh: true, timeoutMs: 5000 })).jpeg;
  }
  async binding(options: CalibrationVisionOptions): Promise<VisionBinding> {
    if (options.cameraId !== this.camera.id)
      throw new RobotArmError(
        'VISION_BINDING_CHANGED',
        'Camera identity changed',
      );
    if (
      ![options.width, options.height].every(
        (n) => Number.isInteger(n) && n > 0 && n <= 4096,
      )
    )
      throw new Error('Invalid screenshot dimensions');
    const correction = this.correction;
    if (!correction)
      throw new RobotArmError(
        'MAPPING_REQUIRED',
        'Correct the camera image before calibration',
      );
    const capture = this.stream.getOptions();
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          this.camera.id,
          correction,
          capture,
          options.width,
          options.height,
        ]),
      )
      .digest('hex');
    return {
      cameraId: this.camera.id,
      cameraName: this.camera.name,
      perspectiveProfileKey: this.camera.id,
      fingerprint,
      width: options.width,
      height: options.height,
    };
  }
  async correctedFrame(
    correction: CameraCorrection,
    options: { width: number; height: number },
  ) {
    this.validate(correction);
    const jpeg = await this.rawFrame();
    const size = jpegSize(jpeg);
    if (
      size.width !== correction.sourceWidth ||
      size.height !== correction.sourceHeight
    )
      throw new RobotArmError(
        'VISION_BINDING_CHANGED',
        'Camera image dimensions changed; repeat correction',
      );
    return this.transformer.transform(jpeg, {
      points: correction.points,
      rotation: correction.rotation,
      targetWidth: options.width,
      targetHeight: options.height,
    });
  }
  async snapshot(options: CalibrationVisionOptions): Promise<VisionSnapshot> {
    const before = await this.binding(options);
    const correction = this.getCorrection()!;
    const image = await this.correctedFrame(correction, options);
    const after = await this.binding(options);
    if (before.fingerprint !== after.fingerprint)
      throw new RobotArmError(
        'VISION_BINDING_CHANGED',
        'Camera correction changed during screenshot',
      );
    return {
      base64: image.toString('base64'),
      width: options.width,
      height: options.height,
      binding: after,
    };
  }
  detectMarkers: CalibrationVision['detectMarkers'] = detectCalibrationMarkers;
}

/** Reference-counted camera leases: releasing one Device never closes another's camera. */
export class CameraSessionManager {
  private readonly streams: CameraStreamManager;
  private readonly sessions = new Map<string, CameraSession>();
  private readonly operations = new Map<string, Promise<unknown>>();
  private closing?: Promise<void>;
  private readonly owners = new Map<string, Set<string>>();
  private closed = false;
  constructor(
    private readonly backend: CameraBackend = cameraBackend(),
    private readonly directory = path.resolve(
      process.env.MIDSCENE_ARM_DATA_DIR || '.midscene/arm-kit',
      'cameras',
    ),
  ) {
    this.streams = new CameraStreamManager(backend);
  }
  private serialize<T>(
    cameraId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const pending = (this.operations.get(cameraId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(operation);
    this.operations.set(cameraId, pending);
    void pending
      .finally(() => {
        if (this.operations.get(cameraId) === pending)
          this.operations.delete(cameraId);
      })
      .catch(() => undefined);
    return pending;
  }
  acquire(cameraId: string, ownerId: string): Promise<CameraSession> {
    return this.serialize(cameraId, async () => {
      if (this.closed) throw new Error('Camera manager is closed');
      const owners = this.owners.get(cameraId) ?? new Set<string>();
      if (owners.has(ownerId))
        throw new Error('Device already owns this camera');
      let session = this.sessions.get(cameraId);
      if (!session) {
        session = await this.open(cameraId);
        if (this.closed) {
          await this.streams.delete(session.stream.id);
          throw new Error('Camera manager is closed');
        }
        this.sessions.set(cameraId, session);
      }
      owners.add(ownerId);
      this.owners.set(cameraId, owners);
      return session;
    });
  }
  private async open(id: string): Promise<CameraSession> {
    const camera = (await this.backend.listDevices()).find(
      (entry) => entry.id === id,
    );
    if (!camera) throw new Error(`Camera not found: ${id}`);
    const stream = await this.streams.create({
      deviceId: id,
      ...camera.defaultCaptureSettings,
    });
    try {
      const session = new CameraSession(camera, stream, this.directory);
      await session.load();
      return session;
    } catch (error) {
      await this.streams.delete(stream.id);
      throw error;
    }
  }
  release(cameraId: string, ownerId: string): Promise<void> {
    return this.serialize(cameraId, async () => {
      const owners = this.owners.get(cameraId);
      if (!owners?.delete(ownerId) || owners.size) return;
      const session = this.sessions.get(cameraId);
      if (session) await this.streams.delete(session.stream.id);
      this.owners.delete(cameraId);
      this.sessions.delete(cameraId);
    });
  }
  close(): Promise<void> {
    this.closed = true;
    this.closing ??= (async () => {
      await Promise.allSettled(this.operations.values());
      await this.streams.close();
      this.sessions.clear();
      this.owners.clear();
    })();
    return this.closing;
  }
}
