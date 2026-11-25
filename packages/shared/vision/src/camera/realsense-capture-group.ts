import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  type RealsenseCombinedFrame,
  RealsenseProcessCameraSource,
} from './realsense-process-camera-source.js';
import type {
  CameraKind,
  CameraSource,
  CameraSourceFrame,
  ResolvedCameraStreamOptions,
} from './types.js';

type SpawnProcess = typeof spawn;

const DEFAULT_CAPTURE = { width: 1280, height: 720, fps: 30 } as const;

interface RealsenseHelperCommand {
  pythonPath: string;
  helperPath: string;
  spawnProcess: SpawnProcess;
}

interface GroupMember {
  options: ResolvedCameraStreamOptions;
  source: RealsenseStreamSource;
}

interface CaptureConfig {
  serial: string;
  colorWidth: number;
  colorHeight: number;
  colorFps: number;
  depthWidth: number;
  depthHeight: number;
  depthFps: number;
  horizontalFlip: boolean;
  verticalFlip: boolean;
  depthControls?: Record<string, number>;
}

const configKey = (config: CaptureConfig): string =>
  JSON.stringify({
    ...config,
    depthControls: Object.entries(config.depthControls ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  });

/**
 * One RealSense helper process captures color and depth together. That is what
 * makes `rs.align(depth -> color)` possible while exposing two logical streams.
 */
export class RealsenseCaptureGroup {
  private readonly members = new Map<CameraKind, GroupMember>();
  private process?: RealsenseProcessCameraSource;
  private activeConfig?: string;
  private reconcileQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly serial: string,
    private readonly command: RealsenseHelperCommand,
  ) {}

  async open(
    kind: CameraKind,
    options: ResolvedCameraStreamOptions,
  ): Promise<CameraSource> {
    if (this.members.has(kind)) {
      throw new Error(`RealSense ${this.serial} already has a ${kind} stream`);
    }
    const source = new RealsenseStreamSource(this, kind);
    this.members.set(kind, { options, source });
    try {
      await this.enqueueReconcile();
      return source;
    } catch (error) {
      this.members.delete(kind);
      throw error;
    }
  }

  deliver(frame: RealsenseCombinedFrame): void {
    for (const member of this.members.values()) member.source.deliver(frame);
  }

  fail(error: Error): void {
    for (const member of this.members.values()) member.source.fail(error);
  }

  exited(exit: { code: number | null; signal: string | null }): void {
    for (const member of this.members.values()) member.source.exited(exit);
  }

  async close(kind: CameraKind, source: RealsenseStreamSource): Promise<void> {
    if (this.members.get(kind)?.source !== source) return;
    this.members.delete(kind);
    if (this.members.size > 0) return;
    const child = this.process;
    this.process = undefined;
    this.activeConfig = undefined;
    await child?.close();
  }

  private enqueueReconcile(): Promise<void> {
    const next = this.reconcileQueue.then(() => this.reconcile());
    this.reconcileQueue = next.catch(() => undefined);
    return next;
  }

  private async reconcile(): Promise<void> {
    if (this.members.size === 0) return;
    const desired = this.desiredConfig();
    if (this.process && this.activeConfig === configKey(desired)) return;

    const previous = this.process;
    this.process = undefined;
    this.activeConfig = undefined;
    await previous?.close();

    const child = this.command.spawnProcess(
      this.command.pythonPath,
      [
        this.command.helperPath,
        'stream',
        '--serial',
        desired.serial,
        '--depth-width',
        String(desired.depthWidth),
        '--depth-height',
        String(desired.depthHeight),
        '--depth-fps',
        String(desired.depthFps),
        '--color-width',
        String(desired.colorWidth),
        '--color-height',
        String(desired.colorHeight),
        '--color-fps',
        String(desired.colorFps),
        ...(desired.horizontalFlip ? ['--horizontal-flip'] : []),
        ...(desired.verticalFlip ? ['--vertical-flip'] : []),
        ...Object.entries(desired.depthControls ?? {})
          .sort(([a], [b]) => a.localeCompare(b))
          .flatMap(([key, value]) => ['--control', `${key}=${value}`]),
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    const process = new RealsenseProcessCameraSource(child);
    this.process = process;
    this.activeConfig = configKey(desired);
    process.on('frame', (frame: RealsenseCombinedFrame) => this.deliver(frame));
    process.on('error', (error: Error) => this.fail(error));
    process.on(
      'exit',
      (exit: { code: number | null; signal: string | null }) => {
        if (this.process === process) {
          this.process = undefined;
          this.activeConfig = undefined;
        }
        this.exited(exit);
      },
    );
  }

  private desiredConfig(): CaptureConfig {
    const color = this.members.get('color')?.options;
    const depth = this.members.get('depth')?.options;
    const orientation = color ?? depth;
    return {
      serial: this.serial,
      colorWidth: color?.width ?? DEFAULT_CAPTURE.width,
      colorHeight: color?.height ?? DEFAULT_CAPTURE.height,
      colorFps: color?.fps ?? DEFAULT_CAPTURE.fps,
      depthWidth: depth?.width ?? DEFAULT_CAPTURE.width,
      depthHeight: depth?.height ?? DEFAULT_CAPTURE.height,
      depthFps: depth?.fps ?? DEFAULT_CAPTURE.fps,
      horizontalFlip: orientation?.horizontalFlip === true,
      verticalFlip: orientation?.verticalFlip === true,
      ...(depth?.depthControls && Object.keys(depth.depthControls).length > 0
        ? { depthControls: depth.depthControls }
        : {}),
    };
  }
}

export class RealsenseStreamSource
  extends EventEmitter
  implements CameraSource
{
  private pendingError?: Error;
  private closed = false;

  constructor(
    private readonly group: RealsenseCaptureGroup,
    private readonly kind: CameraKind,
  ) {
    super();
  }

  override on(
    event: string | symbol,
    listener: (...args: any[]) => void,
  ): this {
    super.on(event, listener);
    if (event === 'error' && this.pendingError) {
      const error = this.pendingError;
      this.pendingError = undefined;
      queueMicrotask(() => {
        if (!this.closed) this.emit('error', error);
      });
    }
    return this;
  }

  deliver(frame: RealsenseCombinedFrame): void {
    const payload: CameraSourceFrame =
      this.kind === 'depth'
        ? {
            jpeg: frame.depthJpeg,
            alignedColorJpeg: frame.colorJpeg,
            depth: frame.depth,
          }
        : { jpeg: frame.colorJpeg };
    this.emit('frame', payload);
  }

  fail(error: Error): void {
    if (this.listenerCount('error') > 0) this.emit('error', error);
    else this.pendingError = error;
  }

  exited(exit: { code: number | null; signal: string | null }): void {
    this.emit('exit', exit);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.group.close(this.kind, this);
    this.removeAllListeners();
  }
}
