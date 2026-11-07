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

Open the printed URL, connect your hardware, follow calibration and configure a model to run tasks. Confirm workspace clearance before movement; use **Stop robot** to stop.

Calibration follows upstream dev: collect samples, fit, automatically check the boundary, record a safe position, then confirm and save. Targets use a fixed 10% inset; fitted touches must cover at least 60% of the full screen. Fast and sliding modes require a fixed, horizontal screen.

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
