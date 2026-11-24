import { describe, expect, it, rstest } from '@rstest/core';
import { finishCameraImagingForScreen } from '../../src/ui/calibration/imaging-completion';

describe('camera imaging completion', () => {
  it('activates the currently selected screen after calibration becomes ready', async () => {
    const activate = rstest.fn().mockResolvedValue({
      state: 'ready',
      screenId: 'pja',
      active: true,
    });
    let loads = 0;

    await finishCameraImagingForScreen({
      screenId: 'pja',
      load: async () => {
        loads += 1;
        return {
          imaging:
            loads === 1
              ? { state: 'released', screenId: 'pja' }
              : loads === 2
                ? { state: 'exposure', screenId: 'pja' }
                : { state: 'ready', screenId: 'pja' },
        };
      },
      activate,
      sleep: async () => {},
    });

    expect(loads).toBe(3);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('does not activate imaging when the camera control is unsupported', async () => {
    const activate = rstest.fn();

    await finishCameraImagingForScreen({
      screenId: 'pja',
      load: async () => ({
        imaging: {
          state: 'unsupported',
          message: 'Camera controls are unavailable',
        },
      }),
      activate,
      sleep: async () => {},
    });

    expect(activate).not.toHaveBeenCalled();
  });

  it('reports a selected screen whose stored imaging profile cannot be applied', async () => {
    await expect(
      finishCameraImagingForScreen({
        screenId: 'pja',
        load: async () => ({
          imaging: { state: 'ready', screenId: 'pja' },
        }),
        activate: async () => ({
          state: 'unconfigured',
          screenId: 'pja',
          active: false,
          message: 'Recalibrate this screen',
        }),
        sleep: async () => {},
      }),
    ).rejects.toThrow('Recalibrate this screen');
  });

  it('rejects an activation that applied a different screen profile', async () => {
    await expect(
      finishCameraImagingForScreen({
        screenId: 'pja',
        load: async () => ({
          imaging: { state: 'ready', screenId: 'pja' },
        }),
        activate: async () => ({
          state: 'ready',
          screenId: 'screen',
          active: true,
        }),
        sleep: async () => {},
      }),
    ).rejects.toThrow('pja');
  });
});
