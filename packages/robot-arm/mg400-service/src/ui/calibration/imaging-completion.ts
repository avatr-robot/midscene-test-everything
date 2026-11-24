import type { CalibrationImagingStatus } from '@midscene/robotics-shared/assisted-contracts';

interface ImagingCompletionOptions {
  screenId: string;
  load: () => Promise<{ imaging?: CalibrationImagingStatus }>;
  activate: () => Promise<CalibrationImagingStatus>;
  shouldContinue?: () => boolean;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Wait for the background camera calibration, then activate the screen the
 * operator still has selected when that calibration finishes.
 */
export async function finishCameraImagingForScreen({
  screenId,
  load,
  activate,
  shouldContinue = () => true,
  timeoutMs = 120_000,
  pollMs = 100,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: ImagingCompletionOptions): Promise<void> {
  const deadline = now() + timeoutMs;
  while (shouldContinue()) {
    const { imaging } = await load();
    if (imaging?.state === 'ready') {
      const applied = await activate();
      if (
        applied.state === 'error' ||
        applied.state === 'unconfigured' ||
        applied.active === false ||
        (applied.screenId !== undefined && applied.screenId !== screenId)
      )
        throw new Error(
          applied.message ??
            `Camera imaging was not applied to the selected screen ${screenId}`,
        );
      return;
    }
    if (imaging?.state === 'unsupported') return;
    if (imaging?.state === 'error')
      throw new Error(
        imaging.message ?? 'Could not calibrate the camera image.',
      );
    if (now() >= deadline)
      throw new Error('Timed out while calibrating the camera image.');
    await sleep(pollMs);
  }
}
