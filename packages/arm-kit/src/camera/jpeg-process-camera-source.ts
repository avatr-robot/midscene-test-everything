import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { JpegStreamParser } from './jpeg-stream-parser.js';
import type { CameraSource } from './types.js';

/** Turns a native process's concatenated JPEG output into camera frames. */
export class JpegProcessCameraSource
  extends EventEmitter
  implements CameraSource
{
  private readonly parser = new JpegStreamParser();
  private closePromise?: Promise<void>;
  private intentionalClose = false;
  private stderrTail = '';

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly processName: string,
  ) {
    super();
    child.stdout.on('data', (chunk: Buffer) => {
      for (const frame of this.parser.push(chunk)) this.emit('frame', frame);
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
