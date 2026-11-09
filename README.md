# Midscene Robotics

English · [简体中文](./README.zh.md) · [Midscene.js](https://midscenejs.com/)

Let Midscene operate physical touchscreens with a camera and a robot arm. Includes a browser Playground, a Node.js SDK and a DOBOT MG400 adapter.

## Quick Start

Prepare an MG400 with a stylus, a camera and a touchscreen. Use Node.js `^20.19.0 || ^22.12.0 || >=24.0.0` and pnpm 9.3.0.

```sh
pnpm install
pnpm build
pnpm dev
```

Open the printed URL. Playground checks `192.168.1.6` and `192.168.2.6` and connects automatically to the only MG400 accepting Dashboard commands. If only one controller responds and it refuses those commands, the adapter requests TCP/IP development mode and verifies the change with a fresh mode query. If neither is available, retry or choose **Skip to cameras** for a live preview. For a custom address, ports or network setup, start with `pnpm dev --manual`. Once connected, follow calibration and configure a model to run tasks. Confirm workspace clearance before movement; use **Stop robot** to stop.

Choose **Detect screen markers** in the camera preview or **Screen Calibration** in robot settings. Both use the phone already paired with that camera. Scan once to pair a new phone and keep the page in the foreground. The phone requests a wake lock immediately, using an autoplaying muted white background video on LAN HTTP. Android requests full screen automatically. If the browser requires a gesture, tap **Enter full screen** on the phone. On HarmonyOS, enter full screen when prompted. On iOS, use Safari’s **Share → Add to Home Screen**, then open the page from its icon. Detection waits for the required display mode and visible markers before capturing frames. The paired phone stays in full screen when you return to the Playground home page and can be reused for the next run.

Playground checks marker stability across eight frames. Robot setup also verifies four fit markers and two independent markers in the corrected image. Each group must have a mean error of at most 2 CSS px and a maximum error of at most 3 CSS px. Passing saves the correction and advances automatically. Selecting **Camera correction** later opens the saved outline and corrected view in the wizard. Choose **Next** to continue. Occluded markers are repositioned on retry. Camera-only mode returns directly to the camera preview with the detected outline.

Keep all six phone markers visible during camera calibration. If the camera misses a marker in a low-contrast frame, it retries once with contrast enhancement.

Collect samples, fit, automatically check the boundary, record a safe position, then confirm and save. Targets use a fixed 10% inset; fitted touches must cover at least 60% of the full screen. Fast and sliding modes require a fixed, horizontal screen. Use **Previous Step** in arm calibration to review earlier measurements, then **Next** to return to the current step.

## SDK & Adapters

See the [SDK example](./examples/mg400/run.mjs). To support another arm, implement `RobotArmAdapter` from `@midscene/arm-kit/adapter-development`; refer to the [MG400 adapter](./packages/adapter-mg400/src/mg400.ts).

## Project Structure

```text
packages/arm-kit/           Node.js SDK
packages/adapter-mg400/     MG400 adapter
packages/calibration-ui/    Calibration UI
packages/shared/            Shared types and utilities
packages/playground/        Reusable Playground
apps/playground/            MG400 Playground launcher
examples/mg400/             SDK examples
```

Calibration code is in `packages/arm-kit/src/calibration`: phone and camera setup, sample collection and fitting, and boundary verification.

## License

[MIT](./LICENSE).
