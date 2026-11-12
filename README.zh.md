# Midscene Robotics

[English](./README.md)

用 Midscene 通过蓝牙操作 iPhone，或通过机械臂操作触屏。两种设备共用 Open Device Playground 和 SDK。

## 快速开始

在仓库根目录运行：

```sh
pnpm install
pnpm build
```

| 设备 | 启动命令 | 管理台 | 获取 Token |
| --- | --- | --- | --- |
| 机械臂（DOBOT MG400） | `pnpm --filter @midscene/arm-service start` | [localhost:5173](http://localhost:5173/) | **机械臂配置 → Open Device** |
| iPhone（在连接手机的 Mac 上运行） | `pnpm iphone-use install` | [localhost:5801](http://localhost:5801/) | `pnpm iphone-use token` |

在管理台添加设备并完成配置。然后运行 `pnpm dev:playground`，打开 [localhost:5800](http://localhost:5800/)，填入服务地址和 Token，再选择设备。

## 机械臂标定

从机械臂管理台的相机工作区进入标定时，触控工具和相机映射就绪后会打开「示教安装」，可以查看已保存的示教或重新记录点位。

快速标定前，请固定所有屏幕，并使用带弹性缓冲的笔尖。快速采样会先测量各屏幕的平面再滑动，允许触控笔与屏幕法线的夹角最大为 5°，采样目标的 Z 高差最大为 6 mm。手机在人工定位和触控预览时显示中央对准圆标，在自动采样时隐藏圆标。

标定审计的 `detail.coarsePhoneObservations` 保存最近的粗探步骤，分别记录运动提交前准备、适配器完成、位姿停稳和手机确认的用时。

## 脚本与接口

将 [.env.example](./.env.example) 复制为 `.env`，填入服务和模型配置，然后运行：

```sh
pnpm exec tsx examples/open-device.ts
```

示例通过 `agentFromOpenDevice()` 读取当前屏幕。两个服务都可以在 `/api/docs/` 打开 Swagger UI，在 `/api/openapi.json` 查看接口定义。

[协议草稿](./packages/open-device/rfc/index.html) · [MIT 许可证](./LICENSE)
