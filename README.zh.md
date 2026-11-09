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

打开终端输出的网址。Playground 会探测 `192.168.1.6` 和 `192.168.2.6`，优先连接唯一一台可响应 Dashboard 指令的 MG400。如果只有一台控制器应答，但它拒绝 Dashboard 指令，适配器会自动请求切换到 TCP/IP 开发模式，并重新查询确认。都未找到时，可以重试或点「跳过，查看相机」预览实时画面。如需指定地址、端口或配置网口，使用 `pnpm dev --manual` 启动。连接成功后按引导标定并配置模型，即可执行任务。运动前确认工作区安全，需要停止时点击「停止机械臂」。

点击相机预览中的「识别屏幕标记」或机械臂配置中的「屏幕标定」，Playground 会使用这台相机已经连接的手机。首次连接时扫码一次，保持页面在前台。手机立即请求常亮，在局域网 HTTP 下自动播放白色静音背景视频。Android 自动请求全屏；浏览器要求手势时，点手机上的「进入全屏」。鸿蒙按提示进入全屏。iOS 在 Safari 中选择「分享 → 添加到主屏幕」，再从主屏幕图标打开。只有手机进入所需模式并显示标记后，才开始采图。返回 Playground 首页后，手机标定页保持全屏，下次运行可直接复用。

Playground 从 8 帧中检查标记和角点稳定性。机械臂配置会再用 4 个拟合标记和 2 个独立标记验证校正，要求两组的平均误差均不超过 2 CSS px、最大误差均不超过 3 CSS px。通过后自动保存并进入下一步；标记被遮挡时自动换位重试。手动点击「相机校正」可回到结果确认页，对照屏幕轮廓和校正画面，再点「下一步」继续。仅相机模式下，识别完成后直接在预览画面显示轮廓。

相机标定时，请让手机上的六个标定码都保持可见。低对比度画面出现漏检时，系统会增强对比度并重试一次。

机械标定依次完成采集、拟合、自动检查边界、记录安全位置，最后确认保存。采样点固定内缩 10%，拟合覆盖率至少为完整屏幕的 60%。快速和滑动模式要求屏幕固定且水平。 在机械臂标定中，可点「上一步」回看已完成步骤的测量记录，再点「下一步」返回当前进度。

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
