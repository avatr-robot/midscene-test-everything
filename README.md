# Midscene Robotics

[中文](./README.zh.md)

Use Midscene to operate an iPhone over Bluetooth or a touchscreen with a robot arm. Both connect to the same Open Device Playground and SDK.

## Quick start

From the repository root:

```sh
pnpm install
pnpm build
```

| Device | Start the service | Manager | Get the token |
| --- | --- | --- | --- |
| Robot arm (DOBOT MG400) | `pnpm --filter @midscene/arm-service start` | [localhost:5173](http://localhost:5173/) | **Robot settings → Open Device** |
| iPhone (on the Mac connected to the phone) | `pnpm iphone-use install` | [localhost:5801](http://localhost:5801/) | `pnpm iphone-use token` |

Add the device and follow the setup steps in its manager. Then run `pnpm dev:playground`, open [localhost:5800](http://localhost:5800/), and enter the service URL and token to select a device.

## Robot arm calibration

Opening calibration from the robot arm manager's camera workspace takes you to **Teach Installation** once the touch tool and camera mapping are ready. You can review saved teaching or record new points.

Teach the camera-side boundary by recording two points along the intended line at the reference height. Keep A and B at least 20 mm apart in XY, and the reference at least 20 mm from the line. The reference selects the allowed side. With an existing screen calibration for the current view, the live preview projects the line and shades the forbidden side. Rejected motion reports the distance beyond the boundary in millimetres. Saved one-point teachings keep their existing boundary until you record and save a new one.

For fast calibration, secure every screen and use a stylus tip with elastic compliance. Fast sampling uses the center and two direction probes to estimate both the XY mapping and the initial screen plane from measured contact heights. It measures each screen plane before sliding and allows up to 5° between the stylus and the screen normal and up to 6 mm of Z variation across sampling targets. The phone shows its central alignment mark during manual positioning and touch preview and hides it during automatic sampling.

The calibration audit includes recent coarse probe timings in `detail.coarsePhoneObservations`. Each entry records motion submission preparation, adapter completion, pose settling, and phone confirmation separately.

## Scripts and API

Copy [.env.example](./.env.example) to `.env`, fill in the service and model settings, and run:

```sh
pnpm exec tsx examples/open-device.ts
```

The example uses `agentFromOpenDevice()` to read the current screen. Both services serve Swagger UI at `/api/docs/` and the OpenAPI schema at `/api/openapi.json`.

[Protocol draft](./packages/open-device/rfc/index.html) · [MIT license](./LICENSE)
