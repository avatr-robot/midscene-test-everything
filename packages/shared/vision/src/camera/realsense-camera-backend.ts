import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RobotVisionError } from './errors.js';
import { RealsenseCaptureGroup } from './realsense-capture-group.js';
import type {
  CameraBackend,
  CameraCaptureMode,
  CameraControlCapability,
  CameraControlChoice,
  CameraDevice,
  CameraIntrinsics,
  CameraKind,
  CameraSource,
  ResolvedCameraStreamOptions,
} from './types.js';

type SpawnProcess = typeof spawn;

const HELPER_RELATIVE_PATH = 'native/realsense-depth/helper.py';

export interface RealsenseCameraBackendOptions {
  pythonPath?: string;
  helperPath?: string;
  spawnProcess?: SpawnProcess;
}

interface RealsenseDevice extends CameraDevice {
  serial: string;
  kind: CameraKind;
}

function parseIntrinsics(value: unknown): CameraIntrinsics | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  if (
    !['fx', 'fy', 'cx', 'cy'].every(
      (key) => typeof input[key] === 'number' && Number.isFinite(input[key]),
    )
  ) {
    return undefined;
  }
  return {
    fx: input.fx as number,
    fy: input.fy as number,
    cx: input.cx as number,
    cy: input.cy as number,
  };
}

function parseCaptureModes(
  value: unknown,
  kind: CameraKind,
): CameraCaptureMode[] {
  if (!value || typeof value !== 'object') return [];
  const modes = (value as Record<string, unknown>)[kind];
  if (!Array.isArray(modes)) return [];
  const parsed: CameraCaptureMode[] = [];
  const seen = new Set<string>();
  for (const item of modes) {
    if (!item || typeof item !== 'object') continue;
    const mode = item as Record<string, unknown>;
    if (
      !['width', 'height', 'fps'].every(
        (key) =>
          typeof mode[key] === 'number' &&
          Number.isInteger(mode[key]) &&
          (mode[key] as number) > 0,
      )
    ) {
      continue;
    }
    const width = mode.width as number;
    const height = mode.height as number;
    const fps = mode.fps as number;
    const intrinsics = parseIntrinsics(mode.intrinsics);
    const key = `${width}x${height}@${fps}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push({
      width,
      height,
      fps,
      ...(intrinsics ? { intrinsics } : {}),
    });
  }
  return parsed.sort(
    (left, right) =>
      right.width - left.width ||
      right.height - left.height ||
      right.fps - left.fps,
  );
}

function sharedCaptureModes(
  color: readonly CameraCaptureMode[],
  depth: readonly CameraCaptureMode[],
): CameraCaptureMode[] {
  const depthModes = new Set(
    depth.map(({ width, height, fps }) => `${width}x${height}@${fps}`),
  );
  return color.filter(({ width, height, fps }) =>
    depthModes.has(`${width}x${height}@${fps}`),
  );
}

function parseChoices(value: unknown): CameraControlChoice[] {
  if (!Array.isArray(value)) return [];
  const choices: CameraControlChoice[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const input = item as Record<string, unknown>;
    if (
      typeof input.value !== 'number' ||
      !Number.isFinite(input.value) ||
      typeof input.label !== 'string' ||
      !input.label.trim() ||
      seen.has(input.value)
    ) {
      continue;
    }
    seen.add(input.value);
    choices.push({ value: input.value, label: input.label.trim() });
  }
  return choices.sort((left, right) => left.value - right.value);
}

function parseControls(value: unknown): CameraControlCapability[] {
  if (!Array.isArray(value)) return [];
  const controls: CameraControlCapability[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const input = item as Record<string, unknown>;
    if (
      typeof input.key !== 'string' ||
      !input.key ||
      typeof input.label !== 'string' ||
      !input.label ||
      (input.type !== 'boolean' &&
        input.type !== 'number' &&
        input.type !== 'select') ||
      !['min', 'max', 'step', 'default', 'value'].every(
        (key) => typeof input[key] === 'number' && Number.isFinite(input[key]),
      )
    )
      continue;
    const choices = parseChoices(input.choices);
    if (input.type === 'select' && choices.length < 2) continue;
    controls.push({
      key: input.key,
      label: input.label,
      ...(typeof input.description === 'string' && input.description
        ? { description: input.description }
        : {}),
      type: input.type,
      ...(choices.length ? { choices } : {}),
      min: input.min as number,
      max: input.max as number,
      step: input.step as number,
      default: input.default as number,
      value: input.value as number,
    });
  }
  return controls;
}

function currentModuleDirectory(): string {
  if (typeof __dirname === 'string') return __dirname;
  return dirname(fileURLToPath(import.meta.url));
}

function firstExisting(paths: readonly string[]): string | undefined {
  return paths.find((path) => existsSync(path));
}

/**
 * Captures Intel RealSense color and depth through one librealsense pipeline.
 * The same pipeline aligns depth to the color frame, so both previews and raw
 * depth measurements share one pixel coordinate system.
 */
export class RealsenseCameraBackend implements CameraBackend {
  private readonly pythonPath: string;
  private readonly helperPath: string;
  private readonly spawnProcess: SpawnProcess;
  private deviceCache = new Map<string, RealsenseDevice>();
  private readonly captures = new Map<string, RealsenseCaptureGroup>();

  constructor(options: RealsenseCameraBackendOptions = {}) {
    this.pythonPath =
      options.pythonPath ||
      process.env.ROBOT_VISION_REALSENSE_PYTHON ||
      (process.platform === 'win32' ? 'python' : 'python3');
    const configuredHelper =
      options.helperPath || process.env.ROBOT_VISION_REALSENSE_HELPER_PATH;
    const moduleDirectory = currentModuleDirectory();
    this.helperPath =
      configuredHelper ||
      firstExisting([
        resolve(moduleDirectory, '../native/realsense-depth/helper.py'),
        resolve(moduleDirectory, '../../native/realsense-depth/helper.py'),
        resolve(moduleDirectory, '../../../native/realsense-depth/helper.py'),
        resolve(process.cwd(), HELPER_RELATIVE_PATH),
        resolve(process.cwd(), 'packages/shared/vision', HELPER_RELATIVE_PATH),
        resolve(
          dirname(process.argv[1] || process.cwd()),
          HELPER_RELATIVE_PATH,
        ),
      ]) ||
      resolve(process.cwd(), HELPER_RELATIVE_PATH);
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  async listDevices(): Promise<CameraDevice[]> {
    if (!existsSync(this.helperPath)) {
      throw new RobotVisionError(
        'STREAM_FAILED',
        `RealSense depth helper not found: ${this.helperPath}. Set ROBOT_VISION_REALSENSE_HELPER_PATH or reinstall @midscene/robotics-vision.`,
      );
    }
    const output = await this.runProbe([this.helperPath, 'list']);
    let parsed: { devices?: unknown };
    try {
      parsed = JSON.parse(output.trim().split(/\r?\n/u).at(-1) || '{}') as {
        devices?: unknown;
      };
    } catch (error) {
      throw new RobotVisionError(
        'STREAM_FAILED',
        `RealSense helper returned invalid device JSON: ${String(error)}`,
        error,
      );
    }
    if (!Array.isArray(parsed.devices)) {
      throw new RobotVisionError(
        'STREAM_FAILED',
        'RealSense helper did not return a device list',
      );
    }
    const devices: RealsenseDevice[] = [];
    const seen = new Set<string>();
    for (const value of parsed.devices) {
      if (!value || typeof value !== 'object') continue;
      const input = value as Record<string, unknown>;
      if (
        typeof input.serial !== 'string' ||
        !input.serial.trim() ||
        typeof input.name !== 'string' ||
        !input.name.trim() ||
        seen.has(input.serial)
      )
        continue;
      seen.add(input.serial);
      const baseName = input.name.trim();
      const controls = parseControls(input.depthControls);
      const colorModes = parseCaptureModes(input.captureModes, 'color');
      const depthModes = parseCaptureModes(input.captureModes, 'depth');
      const pairedModes = sharedCaptureModes(colorModes, depthModes);
      const encodedSerial = encodeURIComponent(input.serial);
      const colorId = `realsense:${encodedSerial}:color`;
      const depthId = `realsense:${encodedSerial}`;
      devices.push(
        {
          id: colorId,
          name: /\brgb\b/iu.test(baseName) ? baseName : `${baseName} RGB`,
          backend: 'realsense',
          kind: 'color',
          defaultCaptureSettings: { width: 1280, height: 720, fps: 30 },
          ...(pairedModes.length ? { captureModes: pairedModes } : {}),
          serial: input.serial,
          pairedDeviceId: depthId,
        },
        {
          id: depthId,
          name: /depth/iu.test(baseName) ? baseName : `${baseName} Depth`,
          backend: 'realsense',
          kind: 'depth',
          defaultCaptureSettings: { width: 1280, height: 720, fps: 30 },
          ...(pairedModes.length ? { captureModes: pairedModes } : {}),
          serial: input.serial,
          pairedDeviceId: colorId,
          ...(controls.length ? { controls } : {}),
        },
      );
    }
    this.deviceCache = new Map(devices.map((device) => [device.id, device]));
    return devices.map(({ serial: _serial, ...device }) => device);
  }

  async openStream(
    options: ResolvedCameraStreamOptions,
  ): Promise<CameraSource> {
    let device = this.deviceCache.get(options.deviceId);
    if (!device) {
      await this.listDevices();
      device = this.deviceCache.get(options.deviceId);
    }
    if (!device) {
      throw new RobotVisionError(
        'DEVICE_NOT_FOUND',
        `RealSense device not found: ${options.deviceId}`,
      );
    }
    const kind = options.kind ?? device.kind;
    if (kind !== device.kind) {
      throw new RobotVisionError(
        'INVALID_ARGUMENT',
        `The selected RealSense endpoint is ${device.kind}, not ${kind}`,
      );
    }
    const capture =
      this.captures.get(device.serial) ??
      new RealsenseCaptureGroup(device.serial, {
        pythonPath: this.pythonPath,
        helperPath: this.helperPath,
        spawnProcess: this.spawnProcess,
      });
    this.captures.set(device.serial, capture);
    return capture.open(kind, { ...options, kind });
  }

  private async runProbe(args: string[]): Promise<string> {
    return new Promise<string>((resolveOutput, reject) => {
      const child = this.spawnProcess(this.pythonPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          new RobotVisionError(
            'STREAM_FAILED',
            'Timed out while enumerating RealSense depth devices',
          ),
        );
      }, 15_000);
      timeout.unref();
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(
          new RobotVisionError(
            'STREAM_FAILED',
            `Failed to start RealSense helper with ${this.pythonPath}: ${error.message}`,
            error,
          ),
        );
      });
      child.once('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolveOutput(stdout);
          return;
        }
        reject(
          new RobotVisionError(
            'STREAM_FAILED',
            `RealSense helper failed (code=${code}): ${stderr.trim().slice(-4000) || 'no error output'}`,
          ),
        );
      });
    });
  }
}
