import { randomInt, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type CameraCorrection, RobotArmError } from '@midscene/arm-kit';
import type {
  CalibrationPageReply,
  CalibrationPageUpdate,
} from '@midscene/arm-kit-shared/assisted-contracts';
import {
  MARKER_CALIBRATION_PROTOCOL,
  MAX_MARKER_CALIBRATION_TARGETS,
  type MarkerCalibrationCreateResult,
  type MarkerCalibrationDetectionResponse,
  type MarkerCalibrationTarget,
  type ScreenDeviceSummary,
  type TargetDisplaySession,
} from '@midscene/arm-kit-shared/marker-contracts';
import type { CalibrationHost } from '@midscene/arm-kit/internal/calibration-server/host';
import { PhoneSocketServer } from '@midscene/arm-kit/internal/calibration-server/phone-socket';
import {
  calibrationPhonePage,
  phoneMarkerElements,
} from '@midscene/arm-kit/internal/calibration/phone/page';
import {
  CalibrationPhoneSession,
  sameLayout,
} from '@midscene/arm-kit/internal/calibration/phone/session';
import { recognizeScreenMarkers } from '@midscene/arm-kit/internal/camera/calibration-markers';
import { controllerRuntime } from '@midscene/arm-kit/internal/controller-runtime';
import type { PlaygroundDevices } from './devices.js';

type SavedPage = {
  id: string;
  pageKey: string;
  token: string;
  name: string;
  cameraId: string;
  targetId?: string;
};
interface MarkerSession extends MarkerCalibrationCreateResult {
  cameraId: string;
  requests: Map<string, string>;
  frames: MarkerCalibrationDetectionResponse['frames'];
  corrections: Map<string, CameraCorrection>;
  observations: Map<string, CalibrationPageUpdate>;
  detecting: boolean;
}
/** A phone credential stays stable while its role moves between home, markers and mapping. */
class ScreenPage {
  readonly phoneSocket: PhoneSocketServer;
  private readonly home = new CalibrationPhoneSession();
  host?: CalibrationHost;
  redirect = false;
  mode: 'waiting' | 'markers' | 'mapping' = 'waiting';
  targetDisplayId?: string;
  last?: CalibrationPageUpdate;
  private listeners = new Set<() => void>();
  private unsubscribe?: () => void;
  constructor(
    readonly saved: SavedPage,
    private readonly codes: (id: string) => number[],
  ) {
    this.phoneSocket = new PhoneSocketServer({
      receivePhone: (update) => {
        this.last = update;
        if (this.host) this.host.service.receivePhone(update);
        else this.home.receive(update);
      },
      phoneHeartbeat: () => {
        if (this.host) this.host.service.phoneHeartbeat();
        else this.home.lastSeen = Date.now();
      },
      disconnectPhone: () => {
        if (this.host) this.host.service.disconnectPhone();
        else this.home.lastSeen = 0;
      },
      phoneView: () => this.view(),
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
    });
  }
  private view(): CalibrationPageReply {
    const value =
      this.mode === 'waiting'
        ? { view: 'touch-preview' as const, anchors: [] }
        : this.host!.service.phoneView();
    return {
      ...value,
      pairingToken: this.redirect ? this.saved.token : undefined,
    };
  }
  assign(
    host: CalibrationHost | undefined,
    mode: ScreenPage['mode'],
    displayId?: string,
  ) {
    if (this.host && this.host !== host) this.host.service.disconnectPhone();
    this.unsubscribe?.();
    this.host = host;
    this.mode = mode;
    this.targetDisplayId = displayId;
    this.unsubscribe = host?.service.subscribe(() => this.changed());
    this.redirect = true;
    this.changed();
  }
  changed() {
    for (const listener of this.listeners) listener();
  }
  summary(): ScreenDeviceSummary {
    const status = this.host?.service.phoneStatus();
    const connected = this.host
      ? status?.state === 'connected'
      : this.home.presence() === 'connected';
    const layout =
      this.host?.service.setup().layout ?? this.home.update?.layout;
    const view = this.host?.service.phoneView();
    const update = this.last ?? this.host?.service.phoneObservation();
    return {
      id: this.saved.id,
      pageKey: this.saved.pageKey,
      name: this.saved.name,
      label: this.saved.id.replaceAll('-', '').slice(0, 6).toUpperCase(),
      cameraId: this.saved.cameraId,
      screenId: this.saved.targetId,
      mode: this.mode,
      language: 'zh',
      width: layout?.width ?? 0,
      height: layout?.height ?? 0,
      visible: Boolean(connected && update?.visible),
      fullscreen: Boolean(
        connected &&
          !status?.displayRequirement &&
          (update?.displayMode === 'fullscreen' ||
            update?.displayMode === 'standalone'),
      ),
      markersReady: Boolean(
        connected &&
          update?.markersPainted &&
          update.markerRequest === view?.markerRequest,
      ),
      pageInstanceId: update?.pageId,
      targetDisplayId: this.targetDisplayId,
    };
  }
  async handlePhone(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (
      req.method !== 'GET' ||
      !['/phone-calibration', '/phone-calibration/'].includes(path)
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    this.redirect = false;
    const pageId = this.host
      ? this.host.service.openPhonePage()
      : this.home.openPage();
    const codes = this.saved.targetId
      ? this.codes(this.saved.targetId)
      : undefined;
    if (req.headers.accept === 'application/json') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(
        JSON.stringify({
          pageId,
          pageKey: this.saved.pageKey,
          markers: phoneMarkerElements(codes),
        }),
      );
    } else {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      });
      const identity = `<script>try{localStorage.setItem('midscene-screen-page-key',${JSON.stringify(this.saved.pageKey)})}catch{}</script>`;
      res.end(
        calibrationPhonePage(pageId, codes).replace(
          '<head>',
          `<head>${identity}`,
        ),
      );
    }
  }
  close() {
    this.unsubscribe?.();
    this.phoneSocket.close();
  }
}

/** Port of the original camera/target/page workflow, without another Vision service. */
export class ScreenCalibration {
  private sessions = new Map<string, MarkerSession>();
  private displays = new Map<string, TargetDisplaySession>();
  private pages = new Map<string, ScreenPage>();
  private pageHosts = new Set<string>();
  private tickets = new Map<
    string,
    { sessionId: string; targetIds: string[]; expiresAt: number }
  >();
  private connectionTickets = new Map<
    string,
    { cameraId: string; code: string; expiresAt: number }
  >();
  private serial: Promise<unknown> = Promise.resolve();
  constructor(private readonly devices: PlaygroundDevices) {}
  private get store() {
    return controllerRuntime(this.devices.arm).profileStore;
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const task = this.serial.then(work);
    this.serial = task.catch(() => undefined);
    return task;
  }
  private screen(id: string) {
    const target = this.devices.screens().find((t) => t.id === id);
    if (!target)
      throw new RobotArmError('INVALID_ARGUMENT', 'Screen not found');
    return target;
  }
  private async adoptExistingPages() {
    for (const [id, entry] of this.devices.entries) {
      if (
        !entry.host ||
        this.pageHosts.has(id) ||
        entry.host.service.phoneStatus().state !== 'connected' ||
        this.store.list().screenPages?.some((p) => p.targetId === id)
      )
        continue;
      const target = this.screen(id);
      const url = entry.host.service.phoneStatus().links[0]?.url;
      const token = url && new URL(url).searchParams.get('token');
      if (!token) continue;
      await this.ensureTarget(id);
      const page: SavedPage = {
        id: randomUUID(),
        token,
        pageKey: randomUUID(),
        name: target.name,
        cameraId: target.cameraId,
        targetId: id,
      };
      await this.persistPage(page);
      await this.page(page);
      entry.host.phoneSocket.renew();
    }
  }
  private pairing(cameraId: string) {
    if (!this.devices.screens().some((screen) => screen.cameraId === cameraId))
      throw new RobotArmError('INVALID_ARGUMENT', 'Camera not found');
    for (const [token, value] of this.connectionTickets) {
      if (value.expiresAt <= Date.now()) this.connectionTickets.delete(token);
      else if (value.cameraId === cameraId)
        return {
          path: `/phone-calibration/connect#bind=${token}`,
          code: value.code,
          expiresAt: value.expiresAt,
        };
    }
    const token = randomUUID();
    const value = {
      cameraId,
      code: this.pairingCode(),
      expiresAt: Date.now() + 5 * 60_000,
    };
    this.connectionTickets.set(token, value);
    return {
      path: `/phone-calibration/connect#bind=${token}`,
      code: value.code,
      expiresAt: value.expiresAt,
    };
  }
  private pairingCode() {
    let code: string;
    do {
      code = String(randomInt(100000, 1000000));
    } while (
      [...this.displays.values()].some(
        (display) => display.code === code && display.state !== 'closed',
      ) ||
      [...this.connectionTickets.values()].some(
        (ticket) => ticket.code === code && ticket.expiresAt > Date.now(),
      )
    );
    return code;
  }
  private async connectPage(page: ScreenPage) {
    const targetId =
      page.saved.targetId ??
      this.devices
        .screens()
        .find(
          (target) =>
            target.cameraId === page.saved.cameraId &&
            !(this.store.list().screenPages ?? []).some(
              (other) =>
                other.id !== page.saved.id && other.targetId === target.id,
            ),
        )?.id;
    if (!targetId)
      throw new RobotArmError(
        'MAPPING_REQUIRED',
        'Assign the screen page in Camera Mapping first',
        409,
      );
    await this.ensureTarget(targetId);
    const host = await this.devices.ensureHost(targetId);
    const stage = host.service.status()?.stage;
    if (
      stage &&
      !['ready', 'completed', 'cancelled', 'interrupted'].includes(stage)
    )
      throw new RobotArmError(
        'BUSY',
        'Finish calibration before assigning the page',
        409,
      );
    page.saved.targetId = targetId;
    await this.persistPage(page.saved);
    await this.store.updateScreenTarget(targetId, {
      pageKey: page.saved.pageKey,
    });
    this.pageHosts.add(targetId);
    host.service.resumePhonePage();
    page.assign(host, 'mapping');
  }
  private async registerConnection(
    input: { pageKey: string; name?: string },
    cameraId: string,
  ) {
    const saved = this.store
      .list()
      .screenPages?.find((page) => page.pageKey === input.pageKey) ?? {
      id: randomUUID(),
      token: randomUUID(),
      pageKey: input.pageKey,
      name:
        input.name?.trim().slice(0, 40) ||
        `Screen · ${input.pageKey.slice(0, 6).toUpperCase()}`,
      cameraId,
    };
    if (saved.cameraId !== cameraId)
      throw new RobotArmError(
        'PAGE_ALREADY_BOUND',
        'This phone is bound to another camera. Release its binding first.',
        409,
      );
    const page = await this.page(saved);
    const free = this.devices
      .screens()
      .some(
        (target) =>
          target.cameraId === cameraId &&
          !(this.store.list().screenPages ?? []).some(
            (other) => other.id !== saved.id && other.targetId === target.id,
          ),
      );
    if (saved.targetId || free) await this.connectPage(page);
    else await this.persistPage(page.saved);
    return {
      url: `/phone-calibration?token=${encodeURIComponent(saved.token)}`,
    };
  }
  private async persistPage(page: SavedPage) {
    await this.store.saveScreenPage(page);
  }
  private async ensureTarget(id: string) {
    const target = this.screen(id);
    if (!this.store.list().screenTargets?.some((t) => t.id === id))
      await this.store.saveScreenTarget(target);
    const saved = this.store.list().screenTargets?.find((t) => t.id === id)!;
    if (saved.markerSlot === undefined) {
      const used = new Set(
        this.store
          .list()
          .screenTargets?.filter(
            (t) => !t.archived && t.cameraId === target.cameraId,
          )
          .flatMap((t) => (t.markerSlot === undefined ? [] : [t.markerSlot])),
      );
      let slot = 0;
      while (used.has(slot)) slot++;
      if (slot >= MAX_MARKER_CALIBRATION_TARGETS)
        throw new RobotArmError(
          'INVALID_ARGUMENT',
          'Too many screens for this camera',
        );
      await this.store.updateScreenTarget(id, { markerSlot: slot });
    }
    return target;
  }
  private async page(saved: SavedPage) {
    let page = this.pages.get(saved.id);
    if (!page) {
      page = new ScreenPage(saved, (id) => this.devices.markerCodes(id));
      this.pages.set(saved.id, page);
      if (saved.targetId) {
        this.pageHosts.add(saved.targetId);
        await this.ensureTarget(saved.targetId);
        await this.store.updateScreenTarget(saved.targetId, {
          pageKey: saved.pageKey,
        });
        page.assign(await this.devices.ensureHost(saved.targetId), 'mapping');
      }
    }
    return page;
  }
  async phoneHost(token: string | null) {
    if (!token) return undefined;
    const saved = this.store.list().screenPages?.find((p) => p.token === token);
    return saved ? this.page(saved) : undefined;
  }
  private publicInfo(cameraId?: string) {
    const token = 'screen-page';
    const links = this.devices.pairingLinks(token);
    if (!links.length)
      throw new RobotArmError(
        'PHONE_NETWORK_UNAVAILABLE',
        'Connect the computer to Wi-Fi before pairing a phone',
        409,
      );
    const addresses = links.map((link, index) => ({
      address: new URL(link.url).hostname,
      name: link.name,
      recommended: index === 0,
    }));
    const url = new URL(links[0].url);
    url.pathname = '/phone-calibration/connect';
    url.search = '';
    url.hash = '';
    return { publicUrl: url.href, addresses };
  }
  private session(id: string, token?: string) {
    const session = this.sessions.get(id);
    if (!session || (token !== undefined && token !== session.token))
      throw new RobotArmError(
        'MARKER_CALIBRATION_NOT_FOUND',
        'Marker calibration not found',
        404,
      );
    if (session.expiresAt < Date.now())
      throw new RobotArmError(
        'MARKER_CALIBRATION_EXPIRED',
        'Marker calibration expired',
        410,
      );
    return session;
  }
  private snapshot(session: MarkerSession): MarkerCalibrationCreateResult {
    for (const target of session.targets) {
      const page = [...this.pages.values()].find(
        (p) => p.saved.targetId === target.id && p.mode === 'markers',
      );
      const info = page?.summary();
      if (
        info?.fullscreen &&
        info.markersReady &&
        !['detecting', 'succeeded', 'failed'].includes(target.state)
      )
        target.state = 'display-ready';
      if (page?.last) {
        const layout = page.last.layout;
        target.display = {
          widthPx: layout.screen.width,
          heightPx: layout.screen.height,
          cssWidthPx: layout.width,
          cssHeightPx: layout.height,
          devicePixelRatio: layout.screen.devicePixelRatio,
          rotation: 0,
          fullscreen: info?.fullscreen === true,
        };
      }
    }
    const {
      requests: _,
      frames: _f,
      corrections: _c,
      observations: _o,
      detecting: _d,
      cameraId: _camera,
      ...value
    } = session;
    return structuredClone(value);
  }
  async create(cameraId: string, names?: string[], screenIds?: string[]) {
    await this.devices.open(cameraId);
    if (screenIds?.some((id) => this.screen(id).cameraId !== cameraId))
      throw new RobotArmError(
        'INVALID_ARGUMENT',
        'Screens must belong to this camera',
      );
    const ids: string[] = [];
    if (screenIds?.length) ids.push(...screenIds);
    else {
      for (const name of names?.length ? names : ['Screen 1']) {
        const saved = this.devices
          .screens()
          .filter((t) => t.cameraId === cameraId);
        const root = saved.find(
          (t) =>
            t.id === cameraId &&
            !this.store.list().screenTargets?.some((s) => s.id === t.id),
        );
        if (root) {
          await this.store.saveScreenTarget({ ...root, name });
          ids.push(root.id);
        } else ids.push((await this.devices.addScreen(cameraId, name)).id);
      }
    }
    if (ids.length > MAX_MARKER_CALIBRATION_TARGETS)
      throw new RobotArmError('INVALID_ARGUMENT', 'Too many screens');
    const session: MarkerSession = {
      cameraId,
      id: randomUUID(),
      token: randomUUID(),
      state: 'created',
      streamId: cameraId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 60_000,
      targets: [],
      requests: new Map(),
      frames: {},
      corrections: new Map(),
      observations: new Map(),
      detecting: false,
    };
    for (const id of ids) {
      const target = await this.ensureTarget(id);
      session.targets.push({
        id,
        name: target.name,
        state: 'created',
        token: randomUUID(),
      });
    }
    this.sessions.set(session.id, session);
    return this.snapshot(session);
  }
  async markerAction(input: {
    action: string;
    cameraId: string;
    id?: string;
    token?: string;
    names?: string[];
    screenIds?: string[];
    targetId?: string;
    name?: string;
    targetIds?: string[];
  }) {
    if (input.action === 'create')
      return this.create(input.cameraId, input.names, input.screenIds);
    const session = this.session(input.id!, input.token);
    if (session.cameraId !== input.cameraId)
      throw new RobotArmError(
        'PROFILE_MISMATCH',
        'Marker session belongs to another camera',
        409,
      );
    if (input.action === 'status') return this.snapshot(session);
    if (session.detecting)
      throw new RobotArmError(
        'BUSY',
        'Screen detection is already running',
        409,
      );
    if (input.action === 'add') {
      if (session.targets.length >= MAX_MARKER_CALIBRATION_TARGETS)
        throw new RobotArmError('INVALID_ARGUMENT', 'Too many screens');
      const added = await this.devices.addScreen(session.cameraId, input.name!);
      await this.ensureTarget(added.id);
      const target = {
        ...added,
        state: 'created' as const,
        token: randomUUID(),
      };
      session.targets.push(target);
      return { session: this.snapshot(session), target };
    }
    if (input.action === 'remove') {
      if (!session.targets.some((t) => t.id === input.targetId))
        throw new RobotArmError('INVALID_ARGUMENT', 'Screen not found');
      const page = [...this.pages.values()].find(
        (p) => p.saved.targetId === input.targetId,
      );
      if (page) {
        await this.release(page);
        page.saved.targetId = undefined;
        await this.persistPage(page.saved);
        page.assign(undefined, 'waiting');
      }
      session.targets = session.targets.filter((t) => t.id !== input.targetId);
      if (!this.store.deviceBinding(input.targetId!))
        await this.store.updateScreenTarget(input.targetId!, {
          archived: true,
        });
      return this.snapshot(session);
    }
    if (input.action === 'cancel') {
      session.state = 'cancelled';
      return {};
    }
    if (input.action === 'detect') return this.detect(session, input.targetIds);
    if (input.action === 'apply') return this.apply(session);
    throw new RobotArmError('INVALID_COMMAND', 'Unknown marker command');
  }
  private async detect(
    session: MarkerSession,
    ids?: string[],
  ): Promise<MarkerCalibrationDetectionResponse> {
    const selected =
      ids ??
      session.targets.filter((t) => t.state !== 'succeeded').map((t) => t.id);
    if (
      !selected.length ||
      selected.some((id) => !session.targets.some((t) => t.id === id))
    )
      throw new RobotArmError('INVALID_ARGUMENT', 'Select calibration screens');
    session.detecting = true;
    try {
      // Every target sees the same fresh eight-frame batch. One bad phone cannot
      // invalidate another target's passing evidence or make it retry needlessly.
      const camera = (await this.devices.open(session.cameraId)).camera;
      const observations = new Map<string, CalibrationPageUpdate>();
      for (const id of selected) {
        const host = await this.devices.ensureHost(id);
        const request = session.requests.get(id);
        const observed = request && host.service.markerObservation(request);
        if (observed) observations.set(id, structuredClone(observed));
      }
      const frames: Buffer[] = [];
      for (let index = 0; index < 8; index++)
        frames.push(await camera.rawFrame());
      for (const id of selected) {
        const target = session.targets.find((t) => t.id === id)!;
        target.state = 'detecting';
        target.error = undefined;
        try {
          const host = await this.devices.ensureHost(id);
          const request = session.requests.get(id);
          const observed = observations.get(id);
          if (!observed)
            throw new RobotArmError(
              'PAGE_CHANGED',
              'Keep the device page visible and in fullscreen.',
              409,
            );
          const before = structuredClone(observed);
          let index = 0;
          const result = await recognizeScreenMarkers(async () => {
            const current = host.service.markerObservation(request!);
            if (
              !current ||
              current.pageId !== before.pageId ||
              !sameLayout(current.layout, before.layout)
            )
              throw new RobotArmError(
                'PAGE_CHANGED',
                'The phone display changed during marker detection',
                409,
              );
            return frames[index++];
          }, before.layout);
          const output = {
            width: Math.max(
              180,
              Math.min(4096, Math.round(before.layout.screen.width)),
            ),
            height: Math.max(
              180,
              Math.min(4096, Math.round(before.layout.screen.height)),
            ),
          };
          await camera.detectMarkers(
            await camera.correctedFrame(result.correction, output),
            before.layout.markers,
          );
          const after = host.service.markerObservation(request!);
          if (
            !after ||
            after.pageId !== before.pageId ||
            !sameLayout(after.layout, before.layout)
          )
            throw new RobotArmError(
              'PAGE_CHANGED',
              'The phone display changed during marker detection',
              409,
            );
          target.result = {
            protocol: MARKER_CALIBRATION_PROTOCOL,
            points: result.correction.points,
            screenWidthPx: output.width,
            screenHeightPx: output.height,
            rotation: 0,
            imageWidth: result.correction.sourceWidth,
            imageHeight: result.correction.sourceHeight,
            frameCount: result.frameCount,
            validFrames: result.validFrames,
            cornerJitterPx: result.jitterPx,
            reprojectionRmsePx: result.errorPx,
            markerIds: result.markerIds,
            durationMs: 0,
          };
          session.corrections.set(id, result.correction);
          session.observations.set(id, before);
          session.frames[id] = {
            id: 0,
            capturedAt: Date.now(),
            jpegBase64: result.jpeg,
          };
          target.state = 'succeeded';
        } catch (error) {
          target.state = 'failed';
          target.error = error instanceof Error ? error.message : String(error);
          session.requests.set(
            id,
            (await this.devices.ensureHost(id)).service.requestMarkerDisplay(
              true,
            ),
          );
        }
      }
      session.state = session.targets.every((t) => t.state === 'succeeded')
        ? 'succeeded'
        : session.targets.some((t) => t.state === 'succeeded')
          ? 'partially-succeeded'
          : 'failed';
      return { session: this.snapshot(session), frames: { ...session.frames } };
    } finally {
      session.detecting = false;
    }
  }
  private async apply(session: MarkerSession) {
    const targets = session.targets.filter(
      (t) => t.state === 'succeeded' && t.result,
    );
    if (!targets.length)
      throw new RobotArmError(
        'NOT_VERIFIED',
        'No screen produced a usable calibration result',
        409,
      );
    // Refuse duplicate glass before writing any screen correction.
    const outlines = targets.map((t) => ({
      id: t.id,
      name: t.name,
      points: Object.values(t.result!.points),
    }));
    for (const screen of this.devices.screens()) {
      if (
        screen.cameraId !== session.cameraId ||
        targets.some((t) => t.id === screen.id)
      )
        continue;
      const correction = this.devices.entries
        .get(screen.id)
        ?.camera.getCorrection();
      if (correction)
        outlines.push({
          id: screen.id,
          name: screen.name,
          points: Object.values(correction.points),
        });
    }
    for (let i = 0; i < outlines.length; i++)
      for (const other of outlines.slice(i + 1)) {
        const distance =
          outlines[i].points.reduce(
            (sum, p, j) =>
              sum +
              Math.hypot(p.x - other.points[j].x, p.y - other.points[j].y),
            0,
          ) / 4;
        if (distance < 10)
          throw new RobotArmError(
            'DUPLICATE_SCREEN',
            'Each screen needs its own screen page; open one page per screen, then detect again.',
            409,
          );
      }
    for (const target of targets) {
      const host = await this.devices.ensureHost(target.id);
      const before = session.observations.get(target.id);
      const current = host.service.markerObservation(
        session.requests.get(target.id)!,
      );
      if (
        !before ||
        !current ||
        current.pageId !== before.pageId ||
        !sameLayout(current.layout, before.layout)
      )
        throw new RobotArmError(
          'PAGE_CHANGED',
          'The screen page changed before applying. Detect again.',
          409,
        );
    }
    const root = await (
      await this.devices.ensureHost(session.cameraId)
    ).configuration();
    const frame = await this.devices.entries
      .get(session.cameraId)!
      .camera.rawFrame();
    for (const target of targets)
      await this.devices.entries
        .get(target.id)!
        .camera.checkCorrection(session.corrections.get(target.id)!, frame);
    for (const target of targets) {
      const host = await this.devices.ensureHost(target.id);
      if (target.id !== session.cameraId || !host.service.setup().prepared) {
        if (root.measuredSetup)
          await host.configure({
            tool: root.measuredSetup.tool,
            motion: root.input?.motion,
          });
      }
      await host.applyMarkerCorrection(session.corrections.get(target.id)!);
      host.service.finishMarkerDisplay(session.requests.get(target.id)!, true);
      const page = [...this.pages.values()].find(
        (p) => p.saved.targetId === target.id,
      );
      if (page) {
        page.mode = 'mapping';
        page.changed();
      }
    }
    return { screenIds: targets.map((t) => t.id) };
  }
  async pageAction(input: {
    action: string;
    cameraId?: string;
    id?: string;
    name?: string;
    visionSessionId?: string;
    targetId?: string;
    visionToken?: string;
    targetDisplayId?: string;
    role?: 'markers' | 'mapping';
    keepBinding?: boolean;
    targets?: { id: string; token: string }[];
  }) {
    if (input.action === 'list') {
      await this.adoptExistingPages();
      for (const saved of this.store.list().screenPages ?? [])
        await this.page(saved);
      return {
        ...this.publicInfo(input.cameraId),
        devices: [...this.pages.values()].map((p) => p.summary()),
        pairing: input.cameraId ? this.pairing(input.cameraId) : undefined,
      };
    }
    if (input.action === 'displays') return [...this.displays.values()];
    if (input.action === 'create-display') {
      const session = this.session(input.visionSessionId!);
      const target = session.targets.find((t) => t.id === input.targetId);
      if (
        !target ||
        (input.visionToken !== target.token &&
          input.visionToken !== session.token)
      )
        throw new RobotArmError(
          'INVALID_ARGUMENT',
          'Screen not in marker session',
        );
      const existing = [...this.displays.values()].find(
        (d) =>
          d.visionSessionId === session.id &&
          d.visionTargetId === input.targetId &&
          d.state !== 'closed',
      );
      if (existing) return existing;
      const display: TargetDisplaySession = {
        ...this.publicInfo(session.cameraId),
        id: randomUUID(),
        code: this.pairingCode(),
        language: 'zh',
        state: 'pending',
        visionSessionId: session.id,
        visionTargetId: input.targetId!,
        expiresAt: session.expiresAt,
      };
      this.displays.set(display.id, display);
      const saved = this.store
        .list()
        .screenPages?.find((p) => p.targetId === input.targetId);
      if (saved) await this.assign(await this.page(saved), display, 'markers');
      return display;
    }
    if (input.action === 'close-display') {
      const display = this.displays.get(input.id!);
      if (display) display.state = 'closed';
      return {};
    }
    if (input.action === 'bind-link') {
      const session = this.session(input.visionSessionId!);
      if (
        !input.targets?.every((t) =>
          session.targets.some((s) => s.id === t.id && s.token === t.token),
        )
      )
        throw new RobotArmError(
          'INVALID_ARGUMENT',
          'Invalid screen bind ticket',
        );
      const token = randomUUID();
      const expiresAt = Date.now() + 5 * 60_000;
      this.tickets.set(token, {
        sessionId: session.id,
        targetIds: input.targets!.map((t) => t.id),
        expiresAt,
      });
      return { path: `/#bind=${token}`, expiresAt };
    }
    if (input.action === 'rename-screen') {
      await this.store.updateScreenTarget(input.id!, { name: input.name });
      for (const session of this.sessions.values()) {
        const target = session.targets.find((t) => t.id === input.id);
        if (target) target.name = input.name!.trim();
      }
      const associated = [...this.pages.values()].find(
        (p) => p.saved.targetId === input.id,
      );
      if (associated) {
        associated.saved.name = input.name!.trim();
        await this.persistPage(associated.saved);
      }
      return {};
    }
    const page = this.pages.get(input.id!);
    if (!page)
      throw new RobotArmError('INVALID_ARGUMENT', 'Screen page not found');
    if (input.action === 'release') {
      await this.release(page, input.keepBinding);
      return {};
    }
    if (input.action === 'rename') {
      const name = input.name?.trim();
      if (
        !name ||
        name.length > 40 ||
        [...this.pages.values()].some(
          (p) =>
            p !== page &&
            p.saved.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
      )
        throw new RobotArmError(
          'INVALID_ARGUMENT',
          'Screen names must be unique.',
        );
      for (const session of this.sessions.values()) {
        const target = session.targets.find(
          (t) => t.id === page.saved.targetId,
        );
        if (target) target.name = name;
      }
      page.saved.name = name;
      await this.persistPage(page.saved);
      if (page.saved.targetId)
        await this.store.updateScreenTarget(page.saved.targetId, { name });
      return {};
    }
    if (input.action === 'assign') {
      if (input.role === 'mapping' && !input.targetDisplayId) {
        if (input.cameraId && input.cameraId !== page.saved.cameraId)
          throw new RobotArmError(
            'PROFILE_MISMATCH',
            'The page is assigned to another camera',
            409,
          );
        await this.connectPage(page);
        return { device: page.summary() };
      }
      const display = this.displays.get(input.targetDisplayId!);
      if (!display || display.state === 'closed')
        throw new RobotArmError('INVALID_ARGUMENT', 'Marker display not found');
      await this.assign(page, display, input.role ?? 'markers');
      return { device: page.summary() };
    }
    throw new RobotArmError('INVALID_COMMAND', 'Unknown screen page command');
  }
  private async assign(
    page: ScreenPage,
    display: TargetDisplaySession,
    mode: ScreenPage['mode'],
  ) {
    const session = this.session(display.visionSessionId);
    if (page.saved.cameraId !== session.cameraId)
      throw new RobotArmError(
        'PROFILE_MISMATCH',
        'The page is assigned to another camera',
        409,
      );
    if (
      [...this.pages.values()].some(
        (p) => p !== page && p.saved.targetId === display.visionTargetId,
      )
    )
      throw new RobotArmError(
        'PAGE_ALREADY_BOUND',
        'This screen already has a bound page. Release it before assigning another.',
        409,
      );
    const host = await this.devices.ensureHost(display.visionTargetId);
    this.pageHosts.add(display.visionTargetId);
    if (
      host.service.status() &&
      !['ready', 'completed', 'cancelled', 'interrupted'].includes(
        host.service.status()!.stage,
      )
    )
      throw new RobotArmError(
        'BUSY',
        'Finish calibration before assigning the page',
        409,
      );
    page.saved.targetId = display.visionTargetId;
    await this.persistPage(page.saved);
    await this.ensureTarget(page.saved.targetId);
    await this.store.updateScreenTarget(page.saved.targetId, {
      pageKey: page.saved.pageKey,
    });
    host.service.resumePhonePage();
    page.assign(host, mode, display.id);
    if (mode === 'markers')
      session.requests.set(
        display.visionTargetId,
        host.service.requestMarkerDisplay(),
      );
  }
  private async release(page: ScreenPage, keepBinding = false) {
    if (
      page.host?.service.status() &&
      !['ready', 'completed', 'cancelled', 'interrupted'].includes(
        page.host.service.status()!.stage,
      )
    )
      throw new RobotArmError(
        'BUSY',
        'Finish calibration before restoring the page home',
        409,
      );
    page.host?.service.restorePhoneHome();
    if (!keepBinding) {
      page.saved.targetId = undefined;
      await this.persistPage(page.saved);
    }
    page.assign(
      keepBinding ? page.host : undefined,
      'waiting',
      keepBinding ? page.targetDisplayId : undefined,
    );
  }
  async register(input: {
    ticket?: string;
    code?: string;
    pageKey?: string;
    name?: string;
  }) {
    return this.serialize(async () => {
      this.devices.assertBatchIdle();
      if (
        typeof input.pageKey !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(input.pageKey)
      )
        throw new RobotArmError(
          'INVALID_ARGUMENT',
          'A stable browser identity is required',
        );
      const connection = input.ticket
        ? this.connectionTickets.get(input.ticket)
        : [...this.connectionTickets.values()].find(
            (ticket) => ticket.code === input.code,
          );
      if (connection && connection.expiresAt > Date.now())
        return this.registerConnection(
          { pageKey: input.pageKey, name: input.name },
          connection.cameraId,
        );

      const ticket = input.ticket ? this.tickets.get(input.ticket) : undefined;
      const display = input.code
        ? [...this.displays.values()].find(
            (d) => d.code === input.code && d.state !== 'closed',
          )
        : undefined;
      if ((!ticket || ticket.expiresAt < Date.now()) && !display)
        throw new RobotArmError(
          'INVALID_TOKEN',
          'The pairing code expired. Scan the current QR code.',
          403,
        );
      const session = this.session(
        ticket ? ticket.sessionId : display!.visionSessionId,
      );
      let saved = this.store
        .list()
        .screenPages?.find((p) => p.pageKey === input.pageKey);
      if (saved && saved.cameraId !== session.cameraId)
        throw new RobotArmError(
          'PAGE_ALREADY_BOUND',
          'This phone is bound to another camera. Release its binding first.',
          409,
        );
      saved ??= {
        id: randomUUID(),
        token: randomUUID(),
        pageKey: input.pageKey,
        name:
          input.name?.trim().slice(0, 40) ||
          `Screen · ${input.pageKey.slice(0, 6).toUpperCase()}`,
        cameraId: session.cameraId,
      };
      const page = await this.page(saved);
      const allowed = display
        ? session.targets.filter((t) => t.id === display.visionTargetId)
        : session.targets.filter((t) => ticket!.targetIds.includes(t.id));
      let target = allowed.find((t) => t.id === saved!.targetId);
      if (!target)
        target = allowed.find(
          (t) =>
            !this.store
              .list()
              .screenPages?.some(
                (p) => p.targetId === t.id && p.pageKey !== input.pageKey,
              ),
        );
      if (!target && saved.targetId)
        throw new RobotArmError(
          'PAGE_ALREADY_BOUND',
          'This page belongs to another screen. Select its saved screen to reconnect.',
          409,
        );
      if (!target) {
        await this.persistPage(page.saved);
        return {
          url: `/phone-calibration?token=${encodeURIComponent(saved.token)}`,
        };
      }
      const created = (await this.pageAction({
        action: 'create-display',
        visionSessionId: session.id,
        targetId: target.id,
        visionToken: session.token,
      })) as TargetDisplaySession;
      await this.assign(page, created, 'markers');
      return {
        url: `/phone-calibration?token=${encodeURIComponent(saved.token)}`,
      };
    });
  }
  async close() {
    for (const page of this.pages.values()) page.close();
    this.pages.clear();
  }
}
