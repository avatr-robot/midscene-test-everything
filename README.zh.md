# Midscene Robotics

[English](./README.md) · 简体中文 · [Midscene.js](https://midscenejs.com/zh/)

用摄像头和机械臂，让 Midscene 操作真实触摸屏。提供浏览器工作台、Node.js SDK 和 DOBOT MG400 适配器。

## 快速开始

准备带触控笔的 MG400、摄像头和触屏设备，使用 Node.js `^20.19.0 || ^22.12.0 || >=24.0.0` 和 pnpm 9.3.0。

```sh
pnpm install
pnpm build
pnpm dev
```

打开终端输出的网址。Playground 会探测 `192.168.1.6` 和 `192.168.2.6`，找到唯一可用的 MG400 后自动连接。都未找到时，可以重试或点「跳过，查看相机」预览实时画面。如需指定地址、端口或配置网口，使用 `pnpm dev --manual` 启动。连接成功后按引导标定并配置模型，即可执行任务。运动前确认工作区安全，需要停止时点击「停止机械臂」。

相机标定时，请让手机上的六个标定码都保持可见。低对比度画面出现漏检时，系统会增强对比度并重试一次。

机械标定依次完成采集、拟合、自动检查边界、记录安全位置，最后确认保存。采样点固定内缩 10%，拟合覆盖率至少为完整屏幕的 60%。快速和滑动模式要求屏幕固定且水平。

## SDK 与适配器

使用方式见 [SDK 示例](./examples/mg400/run.mjs)。接入其他机械臂时，实现 `@midscene/arm-kit/adapter-development` 中的 `RobotArmAdapter`，可参考 [MG400 适配器](./packages/adapter-mg400/src/mg400.ts)。

## 目录结构

```text
packages/arm-kit/           Node.js SDK
packages/adapter-mg400/     MG400 适配器
packages/calibration-ui/    标定界面
packages/shared/            共享类型与工具
packages/playground/        可复用工作台
apps/playground/            MG400 工作台启动入口
examples/mg400/             SDK 示例
```

标定代码在 `packages/arm-kit/src/calibration`，包含手机与相机配置、采集拟合、边界验证。

## 许可证

[MIT](./LICENSE)。
