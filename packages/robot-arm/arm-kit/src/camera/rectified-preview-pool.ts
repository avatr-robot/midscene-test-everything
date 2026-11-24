import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import {
  type RectifiedPreviewJob,
  type RectifiedPreviewRequest,
  transformRectifiedPreview,
} from './rectified-preview-transform.js';

interface PreviewWorker {
  worker: Worker;
  job?: PendingJob;
}

interface PendingJob {
  id: number;
  jpeg: Uint8Array;
  request: RectifiedPreviewRequest;
  resolve: (jpeg: Buffer) => void;
  reject: (error: Error) => void;
}

interface WorkerReply {
  id: number;
  jpeg?: Uint8Array;
  error?: string;
}

const MAX_WORKERS = 4;

/**
 * Rectification is CPU-bound. A small pool preserves the preview's full
 * resolution and interpolation while keeping the HTTP server responsive.
 */
class RectifiedPreviewPool {
  private readonly workers: PreviewWorker[] = [];
  private queue: PendingJob[] = [];
  private nextJobId = 0;
  private workerUrl?: URL;

  transform(jpeg: Buffer, request: RectifiedPreviewRequest) {
    if (availableParallelism() < 2) {
      return transformRectifiedPreview(jpeg, request);
    }
    this.ensureWorkers();
    const id = ++this.nextJobId;
    return new Promise<Buffer>((resolve, reject) => {
      this.queue.push({
        id,
        jpeg: Uint8Array.from(jpeg),
        request,
        resolve,
        reject,
      });
      this.dispatch();
    });
  }

  async close() {
    const workers = this.workers.splice(0);
    const error = new Error('Preview transform pool closed');
    for (const job of this.queue.splice(0)) job.reject(error);
    for (const entry of workers) entry.job?.reject(error);
    await Promise.allSettled(workers.map((entry) => entry.worker.terminate()));
  }

  private ensureWorkers() {
    if (this.workers.length) return;
    this.workerUrl ??= this.resolveWorkerUrl();
    const count = Math.max(
      1,
      Math.min(MAX_WORKERS, availableParallelism() - 1),
    );
    for (let index = 0; index < count; index += 1)
      this.workers.push(this.createWorker());
  }

  private resolveWorkerUrl() {
    return import.meta.url.endsWith('.ts')
      ? new URL(
          '../../dist/camera/rectified-preview-worker.js',
          import.meta.url,
        )
      : new URL('./rectified-preview-worker.js', import.meta.url);
  }

  private createWorker(): PreviewWorker {
    const worker = new Worker(this.workerUrl!);
    const entry: PreviewWorker = { worker };
    worker.unref();
    worker.on('message', (reply: WorkerReply) => this.receive(entry, reply));
    worker.on('error', (error) => this.fail(entry, error));
    worker.on('exit', (code) => {
      if (code !== 0) this.fail(entry, new Error('Preview worker exited'));
    });
    return entry;
  }

  private receive(entry: PreviewWorker, reply: WorkerReply) {
    const job = entry.job;
    if (!job || job.id !== reply.id) return;
    entry.job = undefined;
    if (reply.error || !reply.jpeg)
      job.reject(new Error(reply.error ?? 'Preview worker returned no image'));
    else
      job.resolve(
        Buffer.from(
          reply.jpeg.buffer,
          reply.jpeg.byteOffset,
          reply.jpeg.byteLength,
        ),
      );
    this.dispatch();
  }

  private fail(entry: PreviewWorker, error: Error) {
    const index = this.workers.indexOf(entry);
    if (index < 0) return;
    entry.job?.reject(error);
    entry.job = undefined;
    this.workers.splice(index, 1);
    if (this.queue.length) this.workers.push(this.createWorker());
  }

  private dispatch() {
    for (const entry of this.workers) {
      if (entry.job) continue;
      const job = this.queue.shift();
      if (!job) return;
      entry.job = job;
      const message: RectifiedPreviewJob & { id: number } = {
        id: job.id,
        jpeg: job.jpeg,
        ...job.request,
      };
      entry.worker.postMessage(message, [job.jpeg.buffer as ArrayBuffer]);
    }
  }
}

export const rectifiedPreviewPool = new RectifiedPreviewPool();
