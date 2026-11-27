import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { RobotArmError, listCameras } from '@midscene/arm-kit';
import type { CalibrationHost } from '@midscene/arm-kit/internal/calibration-server/host';
import { sameLayout } from '@midscene/arm-kit/internal/calibration/phone/session';
import { pageOrderedQuad } from '@midscene/arm-kit/internal/calibration/screen-position';
import { measureScreenVisibility } from '@midscene/arm-kit/internal/camera/screen-visibility';
import { findVisibilityRegion } from '@midscene/arm-kit/internal/camera/visibility-region';
import type {
  DualCameraScreenAssociations,
  ScreenAssociationResult,
  SideScreenRegion,
} from '@midscene/robotics-shared/assisted-contracts';
import type {
  CameraCorrection,
  ScreenVisibilityProbePattern,
} from '@midscene/robotics-shared/contracts';
import type { DeviceEntry, PlaygroundDevices } from './devices.js';

type Camera = DeviceEntry['camera'];
type Screen = ReturnType<PlaygroundDevices['screens']>[number];
type SavedAssociations = {
  key: string;
  screens: ScreenAssociationResult[];
};

const MIN_PATTERN_CENTER_MATCH = 0.6;

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class DualCameraScreens {
  private running = false;

  constructor(private readonly devices: PlaygroundDevices) {}

  async sideCamera(overheadId: string) {
    const { cameras } = this.devices;
    const overhead = await cameras.cameraPreferences(overheadId);
    if (overhead?.label !== 'top') return;
    const known = await listCameras({ cachedOnly: true, includeBuiltIn: true });
    const candidates = await Promise.all(
      known
        .filter(({ id, kind }) => id !== overheadId && kind !== 'depth')
        .map(async (camera) => ({
          camera,
          settings: await cameras.cameraPreferences(camera.id),
        })),
    );
    const sides = candidates.filter(
      ({ settings }) => settings?.label === 'front',
    );
    if (sides.length !== 1) return;
    const { camera, settings } = sides[0]!;
    return { id: camera.id, name: settings?.name ?? camera.name };
  }

  private async context(overheadId: string) {
    const { cameras } = this.devices;
    const [sideCamera, overhead] = await Promise.all([
      this.sideCamera(overheadId),
      cameras.cameraPreferences(overheadId),
    ]);
    const screens = this.devices
      .screens()
      .filter((screen) => screen.cameraId === overheadId && screen.correction)
      .sort((a, b) => a.id.localeCompare(b.id));
    const side = sideCamera && (await cameras.cameraPreferences(sideCamera.id));
    const capture = (settings: typeof overhead) =>
      settings && {
        width: settings.width,
        height: settings.height,
        fps: settings.fps,
        label: settings.label,
        verticalFlip: settings.verticalFlip,
        horizontalFlip: settings.horizontalFlip,
      };
    const key = hash({
      overheadId,
      sideId: sideCamera?.id,
      overhead: capture(overhead),
      side: capture(side),
      screens: screens.map(({ id, pageKey, correction }) => ({
        id,
        pageKey,
        correction,
      })),
    });
    return { sideCamera, screens, key };
  }

  private file(overheadId: string) {
    return join(
      this.devices.cameras.dataDirectory,
      `${hash(overheadId)}.screen-associations.json`,
    );
  }

  private async readSaved(overheadId: string, key: string) {
    let saved: SavedAssociations | undefined;
    try {
      saved = JSON.parse(await readFile(this.file(overheadId), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return saved?.key === key ? saved.screens : [];
  }

  async read(overheadId: string): Promise<DualCameraScreenAssociations> {
    const { sideCamera, screens, key } = await this.context(overheadId);
    const previous = await this.readSaved(overheadId, key);
    return {
      sideCamera,
      screens: screens.map(
        ({ id }) =>
          previous.find(({ screenId }) => screenId === id) ?? {
            screenId: id,
            status: 'pending',
          },
      ),
    };
  }

  /**
   * Resolve the first screen in calibration order for the eye-level camera's
   * focus pass. Wait briefly because the association may still be refreshing
   * while the overhead camera starts its exposure/focus calibration.
   */
  async focusTarget(overheadId: string, timeoutMs = 120_000) {
    const { sideCamera, screens, key } = await this.context(overheadId);
    if (!sideCamera) return undefined;
    let planOrder: string[] = [];
    try {
      planOrder = (await this.devices.batch.plan(overheadId)).screens.map(
        (screen) => screen.screenId,
      );
    } catch {
      // Installation teaching is not required for camera-only focus setup.
    }
    const ordered = eyeLevelFocusOrder(screens, planOrder);
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (true) {
      const saved = await this.readSaved(overheadId, key);
      const first = ordered[0];
      if (first) {
        const match = saved.find((entry) => entry.screenId === first.id);
        if (match?.status === 'associated')
          return {
            sideCameraId: sideCamera.id,
            sideCameraName: sideCamera.name,
            screenId: first.id,
            screenName: first.name,
            correction: sideRegionCorrection(match.region),
          };
      }
      if (Date.now() >= deadline) {
        // The first calibration target is the required focus target. If its
        // association never finishes, keep the pass useful with any mapped
        // screen rather than leaving the eye-level camera on autofocus.
        for (const screen of ordered) {
          const match = saved.find((entry) => entry.screenId === screen.id);
          if (match?.status !== 'associated') continue;
          return {
            sideCameraId: sideCamera.id,
            sideCameraName: sideCamera.name,
            screenId: screen.id,
            screenName: screen.name,
            correction: sideRegionCorrection(match.region),
          };
        }
        return undefined;
      }
      await delay(250);
    }
  }

  async associate(
    overheadId: string,
    screenIds: readonly string[],
    signal: AbortSignal,
    assertIdle: () => void,
  ): Promise<DualCameraScreenAssociations> {
    if (this.running)
      throw new RobotArmError(
        'BUSY',
        'Screen association is already running.',
        409,
      );
    this.running = true;
    const check = () => {
      signal.throwIfAborted();
      assertIdle();
    };
    try {
      check();
      const context = await this.context(overheadId);
      const { sideCamera, screens, key } = context;
      if (!sideCamera)
        throw new RobotArmError(
          'VISION_UNAVAILABLE',
          'Set the screen camera to Overhead and assign exactly one Eye-level camera.',
          409,
        );
      if (!screens.length)
        throw new RobotArmError(
          'MAPPING_REQUIRED',
          'Save at least one overhead screen outline before associating the cameras.',
          409,
        );
      const requested = new Set(screenIds);
      if (screenIds.some((id) => !screens.some((screen) => screen.id === id)))
        throw new RobotArmError(
          'STALE_CONTEXT',
          'Cameras or screen mappings changed during association.',
          409,
        );
      const previous = await this.readSaved(overheadId, key);
      const { cameras } = this.devices;
      const owner = `screen-association:${randomUUID()}`;
      const overhead = await cameras.acquire(overheadId, owner);
      try {
        const side = await cameras.acquire(sideCamera.id, owner);
        try {
          const results: ScreenAssociationResult[] = [];
          for (const screen of screens) {
            check();
            if (!requested.has(screen.id)) {
              results.push(
                previous.find(({ screenId }) => screenId === screen.id) ?? {
                  screenId: screen.id,
                  status: 'pending',
                },
              );
              continue;
            }
            const host = await this.devices.ensureHost(screen.id);
            if (host.service.phoneStatus().state !== 'connected') {
              await this.devices.markerCalibration.resumeBoundPage(host);
              const deadline = Date.now() + 2_000;
              while (
                host.service.phoneStatus().state !== 'connected' &&
                Date.now() < deadline
              ) {
                check();
                await delay(50, undefined, { signal });
              }
            }
            if (host.service.phoneStatus().state !== 'connected') {
              results.push({ screenId: screen.id, status: 'phone-offline' });
              continue;
            }
            results.push(
              await this.probe(screen, host, overhead, side, signal, check),
            );
          }
          const associated = results.filter(
            (row) => row.status === 'associated',
          );
          // One observed region cannot be claimed by two different phones.
          const unique = results.map((row): ScreenAssociationResult => {
            if (
              row.status === 'associated' &&
              requested.has(row.screenId) &&
              associated.some(
                (other) =>
                  other.screenId !== row.screenId &&
                  sameRegion(row.region, other.region),
              )
            )
              return { screenId: row.screenId, status: 'ambiguous' };
            return row;
          });
          const assertContext = async () => {
            check();
            if ((await this.context(overheadId)).key !== key)
              throw new RobotArmError(
                'STALE_CONTEXT',
                'Cameras or screen mappings changed during association.',
                409,
              );
            check();
          };
          await assertContext();
          await mkdir(cameras.dataDirectory, { recursive: true });
          const file = this.file(overheadId);
          const tmp = `${file}.${randomUUID()}`;
          try {
            await writeFile(tmp, JSON.stringify({ key, screens: unique }), {
              mode: 0o600,
            });
            await assertContext();
            await rename(tmp, file);
          } finally {
            await rm(tmp, { force: true });
          }
          return { sideCamera, screens: unique };
        } finally {
          await cameras.release(sideCamera.id, owner);
        }
      } finally {
        await cameras.release(overheadId, owner);
      }
    } finally {
      this.running = false;
    }
  }

  private async probe(
    screen: Screen,
    host: CalibrationHost,
    overhead: Camera,
    side: Camera,
    signal: AbortSignal,
    check: () => void,
  ): Promise<ScreenAssociationResult> {
    const initial = await this.probePattern(
      screen,
      host,
      overhead,
      side,
      signal,
      check,
      'checkerboard',
    );
    if (initial.status !== 'overhead-mismatch') return initial;
    const contrast = await this.probePattern(
      screen,
      host,
      overhead,
      side,
      signal,
      check,
      'offset-contrast',
    );
    if (contrast.status !== 'overhead-mismatch') return contrast;
    return {
      ...contrast,
      patternMatch: Math.max(
        initial.patternMatch ?? 0,
        contrast.patternMatch ?? 0,
      ),
    };
  }

  private async probePattern(
    screen: Screen,
    { service }: CalibrationHost,
    overhead: Camera,
    side: Camera,
    signal: AbortSignal,
    check: () => void,
    pattern: ScreenVisibilityProbePattern,
  ): Promise<ScreenAssociationResult> {
    const screenId = screen.id;
    const correction = screen.correction!;
    let page: ReturnType<typeof service.visibilityObservation>;
    const topFrames: Buffer[] = [];
    const sideFrames: Buffer[] = [];
    for (const phase of [0, 1, 0] as const) {
      check();
      if (service.phoneStatus().state !== 'connected')
        return { screenId, status: 'phone-offline' };
      const request = service.showVisibilityProbe(phase, pattern);
      try {
        const deadline = Date.now() + 4_000;
        let observation = service.visibilityObservation(request);
        while (!observation && Date.now() < deadline) {
          check();
          await delay(50, undefined, { signal });
          observation = service.visibilityObservation(request);
        }
        if (!observation) return { screenId, status: 'phone-offline' };
        if (
          page &&
          (page.pageId !== observation.pageId ||
            page.browserInstanceId !== observation.browserInstanceId ||
            !sameLayout(page.layout, observation.layout))
        )
          return { screenId, status: 'phone-offline' };
        page = observation;
        await delay(300, undefined, { signal });
        const [a, b] = await Promise.all([
          overhead.stream.getFrame({ fresh: true, timeoutMs: 2_000 }),
          side.stream.getFrame({ fresh: true, timeoutMs: 2_000 }),
        ]);
        check();
        if (!service.visibilityObservation(request))
          return { screenId, status: 'phone-offline' };
        if (Math.abs(a.capturedAt - b.capturedAt) > 300)
          throw new RobotArmError(
            'VISION_UNAVAILABLE',
            'The two cameras did not produce matching fresh frames.',
            409,
          );
        topFrames.push(a.jpeg);
        sideFrames.push(b.jpeg);
      } finally {
        service.clearVisibilityProbe(request);
      }
    }
    const evidence = await measureScreenVisibility(
      topFrames,
      [
        {
          id: screenId,
          points: pageOrderedQuad(correction.points, correction.rotation),
          sourceWidth: correction.sourceWidth,
          sourceHeight: correction.sourceHeight,
          layout: page?.layout,
          firstRowHeight: page?.visibilityFirstRowHeight,
        },
      ],
      { pattern, includeUndetected: true, reportPatternCenterMatch: true },
    );
    const patternMatch = evidence.screens[0]?.patternCenterMatch ?? 0;
    // Verify the displayed pattern inside the saved outline. Full-screen
    // visibility is a separate requirement used for parking verification.
    if (!(patternMatch >= MIN_PATTERN_CENTER_MATCH))
      return { screenId, status: 'overhead-mismatch', patternMatch };
    const detected = await findVisibilityRegion([
      sideFrames[0]!,
      sideFrames[1]!,
      sideFrames[2]!,
    ]);
    return { screenId, ...detected };
  }
}

export function eyeLevelFocusOrder<T extends { id: string; name: string }>(
  screens: readonly T[],
  planOrder: readonly string[] = [],
) {
  return [
    ...planOrder.flatMap((id) => {
      const screen = screens.find((entry) => entry.id === id);
      return screen ? [screen] : [];
    }),
    ...screens
      .filter((screen) => !planOrder.includes(screen.id))
      .sort((left, right) => left.name.localeCompare(right.name)),
  ];
}

function sideRegionCorrection(region: SideScreenRegion): CameraCorrection {
  return {
    points: {
      topLeft: { x: region.left, y: region.top },
      topRight: { x: region.right, y: region.top },
      bottomRight: { x: region.right, y: region.bottom },
      bottomLeft: { x: region.left, y: region.bottom },
    },
    sourceWidth: region.sourceWidth,
    sourceHeight: region.sourceHeight,
    rotation: 0,
  };
}

function sameRegion(a: SideScreenRegion, b: SideScreenRegion) {
  if (a.sourceWidth !== b.sourceWidth || a.sourceHeight !== b.sourceHeight)
    return false;
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return (
    width > 0 &&
    height > 0 &&
    width * height >
      0.55 *
        Math.min(
          (a.right - a.left) * (a.bottom - a.top),
          (b.right - b.left) * (b.bottom - b.top),
        )
  );
}
