import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PerspectiveTarget } from '@midscene/robotics-shared/camera/vision-types';
import type { CameraCorrection } from '@midscene/robotics-shared/contracts';

export type CameraSnapshotView = 'raw' | 'corrected';

interface SnapshotCamera {
  prepareCaptureExposure(): Promise<void>;
  rawFrame(): Promise<Buffer>;
  rectifiedFrame(jpeg: Buffer): Promise<Buffer>;
  getCorrection(): CameraCorrection | undefined;
  getRectifiedPreviewTarget(): PerspectiveTarget | undefined;
}

interface SnapshotImageManifest {
  file: string;
  width: number;
  height: number;
  bytes: number;
}

interface CameraSnapshotManifest {
  version: 1;
  id: string;
  capturedAt: string;
  cameraId: string;
  screenId: string;
  screenName: string;
  raw: SnapshotImageManifest;
  corrected: SnapshotImageManifest;
}

export interface CameraSnapshotImage extends SnapshotImageManifest {
  path: string;
  url: string;
}

export interface CameraSnapshot
  extends Omit<CameraSnapshotManifest, 'version' | 'raw' | 'corrected'> {
  raw: CameraSnapshotImage;
  corrected: CameraSnapshotImage;
}

/** Persist one raw frame and its selected-screen correction as separate files. */
export class CameraSnapshots {
  private readonly root: string;
  private readonly latestRoot: string;

  constructor(cameraDataDirectory: string) {
    this.root = join(cameraDataDirectory, 'snapshots');
    this.latestRoot = join(this.root, 'latest');
  }

  async capture({
    camera,
    cameraId,
    screenId,
    screenName,
  }: {
    camera: SnapshotCamera;
    cameraId: string;
    screenId: string;
    screenName: string;
  }): Promise<CameraSnapshot> {
    const correction = camera.getCorrection();
    const target = camera.getRectifiedPreviewTarget();
    if (!correction || !target)
      throw Object.assign(
        new Error(
          'Save perspective correction for this screen before taking a photo',
        ),
        { status: 409 },
      );

    // Camera imaging measures exposure from the selected screen's perspective
    // correction, which is the area inside the green preview outline.
    await camera.prepareCaptureExposure();
    const raw = await camera.rawFrame();
    const corrected = await camera.rectifiedFrame(raw);
    const capturedAt = new Date().toISOString();
    const id = `${capturedAt.replace(/\D/g, '')}-${randomUUID()}`;
    const directory = join(this.root, id);
    const rawFile = join(directory, 'raw.jpg');
    const correctedFile = join(directory, 'corrected.jpg');
    const manifestFile = join(directory, 'snapshot.json');
    const manifest: CameraSnapshotManifest = {
      version: 1,
      id,
      capturedAt,
      cameraId,
      screenId,
      screenName,
      raw: {
        file: 'raw.jpg',
        width: correction.sourceWidth,
        height: correction.sourceHeight,
        bytes: raw.length,
      },
      corrected: {
        file: 'corrected.jpg',
        width: target.width,
        height: target.height,
        bytes: corrected.length,
      },
    };

    try {
      await mkdir(directory, { recursive: true });
      await Promise.all([
        writeFile(rawFile, raw, { mode: 0o600 }),
        writeFile(correctedFile, corrected, { mode: 0o600 }),
      ]);
      await writeFile(manifestFile, JSON.stringify(manifest, null, 2), {
        mode: 0o600,
      });
      await this.writeLatestPointer(cameraId, screenId, id);
      return this.materialize(manifest);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async latest(
    cameraId: string,
    screenId: string,
  ): Promise<CameraSnapshot | undefined> {
    try {
      const pointer = JSON.parse(
        await readFile(this.latestFile(cameraId, screenId), 'utf8'),
      ) as { id?: unknown };
      if (typeof pointer.id !== 'string') return;
      return this.readManifest(pointer.id);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }

  async image(id: string, view: CameraSnapshotView): Promise<Buffer> {
    const manifest = await this.readManifest(id);
    return readFile(manifest[view].path);
  }

  private async readManifest(id: string): Promise<CameraSnapshot> {
    if (!/^[a-zA-Z0-9-]+$/.test(id))
      throw Object.assign(new Error('Invalid camera snapshot id'), {
        status: 400,
      });
    const manifest = JSON.parse(
      await readFile(join(this.root, id, 'snapshot.json'), 'utf8'),
    ) as CameraSnapshotManifest;
    if (manifest.version !== 1 || manifest.id !== id)
      throw new Error('Camera snapshot manifest is incompatible');
    return this.materialize(manifest);
  }

  private materialize(manifest: CameraSnapshotManifest): CameraSnapshot {
    const directory = join(this.root, manifest.id);
    const image = (
      value: SnapshotImageManifest,
      view: CameraSnapshotView,
    ): CameraSnapshotImage => ({
      ...value,
      path: join(directory, value.file),
      url: `/api/cameras/snapshots/${encodeURIComponent(manifest.id)}/${view}`,
    });
    return {
      id: manifest.id,
      capturedAt: manifest.capturedAt,
      cameraId: manifest.cameraId,
      screenId: manifest.screenId,
      screenName: manifest.screenName,
      raw: image(manifest.raw, 'raw'),
      corrected: image(manifest.corrected, 'corrected'),
    };
  }

  private latestFile(cameraId: string, screenId: string) {
    return join(
      this.latestRoot,
      `${createHash('sha256').update(`${cameraId}\0${screenId}`).digest('hex')}.json`,
    );
  }

  private async writeLatestPointer(
    cameraId: string,
    screenId: string,
    id: string,
  ) {
    const file = this.latestFile(cameraId, screenId);
    const temporary = `${file}.${randomUUID()}.tmp`;
    await mkdir(this.latestRoot, { recursive: true });
    try {
      await writeFile(temporary, JSON.stringify({ id }), { mode: 0o600 });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
