import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { DepthFrame } from './types.js';

const MAGIC = Buffer.from('RSP1');
const HEADER_BYTES = 28;
const RECORD_DEPTH = 1;
const RECORD_DEPTH_PREVIEW = 2;
const RECORD_COLOR_PREVIEW = 3;
const MAX_RECORD_BYTES = 64 * 1024 * 1024;
const MAX_DIMENSION = 7680;

export interface RealsenseCombinedFrame {
  colorJpeg: Buffer;
  depthJpeg: Buffer;
  depth: Omit<DepthFrame, 'id' | 'capturedAt'>;
}

interface PendingFrame {
  frameId: number;
  width: number;
  height: number;
  depthScaleMeters: number;
  depth?: Buffer;
  depthJpeg?: Buffer;
  colorJpeg?: Buffer;
}

/** Parses the framed stdout protocol emitted by the RealSense helper. */
export class RealsenseFrameParser {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private pending?: PendingFrame;

  push(chunk: Buffer): RealsenseCombinedFrame[] {
    this.buffer =
      this.buffer.length === 0
        ? chunk
        : Buffer.concat(
            [this.buffer, chunk],
            this.buffer.length + chunk.length,
          );
    const frames: RealsenseCombinedFrame[] = [];
    while (this.buffer.length >= HEADER_BYTES) {
      if (!this.buffer.subarray(0, 4).equals(MAGIC)) {
        throw new Error('RealSense helper returned an invalid frame header');
      }
      const recordType = this.buffer.readUInt32LE(4);
      const frameId = this.buffer.readUInt32LE(8);
      const width = this.buffer.readUInt32LE(12);
      const height = this.buffer.readUInt32LE(16);
      const depthScaleMeters = this.buffer.readFloatLE(20);
      const payloadBytes = this.buffer.readUInt32LE(24);
      if (
        width === 0 ||
        height === 0 ||
        width > MAX_DIMENSION ||
        height > MAX_DIMENSION ||
        payloadBytes > MAX_RECORD_BYTES ||
        !Number.isFinite(depthScaleMeters) ||
        depthScaleMeters <= 0 ||
        depthScaleMeters > 1
      ) {
        throw new Error('RealSense helper returned invalid frame metadata');
      }
      if (this.buffer.length < HEADER_BYTES + payloadBytes) break;
      const payload = Buffer.from(
        this.buffer.subarray(HEADER_BYTES, HEADER_BYTES + payloadBytes),
      );
      this.buffer = this.buffer.subarray(HEADER_BYTES + payloadBytes);

      if (this.pending && this.pending.frameId !== frameId) {
        this.pending = undefined;
      }
      this.pending ??= { frameId, width, height, depthScaleMeters };

      if (recordType === RECORD_DEPTH) {
        if (payload.length !== width * height * 2) {
          throw new Error(
            `RealSense depth payload size mismatch: expected ${width * height * 2}, received ${payload.length}`,
          );
        }
        this.pending.depth = payload;
      } else if (
        recordType === RECORD_DEPTH_PREVIEW ||
        recordType === RECORD_COLOR_PREVIEW
      ) {
        if (payload.length === 0) {
          throw new Error('RealSense helper returned an empty preview');
        }
        if (recordType === RECORD_DEPTH_PREVIEW) {
          this.pending.depthJpeg = payload;
        } else {
          this.pending.colorJpeg = payload;
        }
      } else {
        throw new Error(`Unknown RealSense record type: ${recordType}`);
      }

      const pending = this.pending;
      if (!pending.depth || !pending.depthJpeg || !pending.colorJpeg) continue;
      this.pending = undefined;
      frames.push({
        colorJpeg: pending.colorJpeg,
        depthJpeg: pending.depthJpeg,
        depth: {
          width: pending.width,
          height: pending.height,
          depthScaleMeters: pending.depthScaleMeters,
          data: pending.depth,
          alignedTo: 'color',
        },
      });
    }
    return frames;
  }
}

/** Owns one RealSense color + aligned-depth helper process. */
export class RealsenseProcessCameraSource extends EventEmitter {
  private readonly parser = new RealsenseFrameParser();
  private closePromise?: Promise<void>;
  private intentionalClose = false;
  private stderrTail = '';

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly processName = 'RealSense capture helper',
  ) {
    super();
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        for (const frame of this.parser.push(chunk)) this.emit('frame', frame);
      } catch (error) {
        this.emit(
          'error',
          error instanceof Error ? error : new Error(String(error)),
        );
        child.kill('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString('utf8')}`.slice(
        -8_192,
      );
    });
    child.on('error', (error) => this.emit('error', error));
    child.on('exit', (code, signal) => {
      if (this.intentionalClose) return;
      const details = this.stderrTail.trim();
      if (details) {
        this.emit(
          'error',
          new Error(
            `${this.processName} exited (code=${code}, signal=${signal}): ${details}`,
          ),
        );
      } else {
        this.emit('exit', { code, signal });
      }
    });
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.intentionalClose = true;
    this.closePromise = new Promise<void>((resolve) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        resolve();
        return;
      }
      const forceTimer = setTimeout(() => this.child.kill('SIGKILL'), 2_000);
      forceTimer.unref();
      this.child.once('exit', () => {
        clearTimeout(forceTimer);
        resolve();
      });
      this.child.kill('SIGTERM');
    });
    return this.closePromise;
  }
}
