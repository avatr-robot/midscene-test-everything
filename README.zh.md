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

标定时，实测屏面相对拟合平面的最大允许偏差为 3 mm。

快速标定时，确认无触点或独立验高偏差超过 1.5 mm，可最多内缩重试三次。重试点分别从原采样点朝首个触点内移 3、6、9 mm，并沿用现有下探深度限制和验高门槛。

如果 MG400 应答了前往标定参考位的运动指令（抬升、横移或下降），但新鲜反馈持续显示控制器空闲且机械臂静止，服务会清空控制器运动队列、确认恢复，再按当前屏幕和采样模式重试一次。手动停止和急停仍需人工确认恢复。

控制器负载回读短暂中断后，机械臂服务会在回读恢复时自动重新确认已保存的工具负载。标定会等到负载核对通过后才允许继续运动。

从机械臂管理台的相机工作区进入标定时，触控工具和相机映射就绪后会打开「示教安装」，可以查看已保存的示教或重新记录点位。

在参考高度沿预定的相机侧边界记录 A、B 两点。两点在 XY 平面上至少相距 20 mm，参考位到边界线也至少相距 20 mm。参考位用于确定允许侧。当前视图已有屏幕标定时，实时预览会画出边界线并标红禁入侧。目标越界时会显示超出的毫米数。旧的单点示教继续使用已保存的边界，重新记录并保存后会采用两点定线。

快速标定前，请固定所有屏幕，并使用带弹性缓冲的笔尖。快速采样用中心点和两个方向点的实测接触高度建立初始屏幕平面，并复用这三个点估算 XY 映射。快速采样会先测量各屏幕的平面再滑动，允许触控笔与屏幕法线的夹角最大为 5°，采样目标的 Z 高差最大为 6 mm。手机在人工定位和触控预览时显示中央对准圆标，在自动采样时隐藏圆标。

标定审计的 `detail.coarsePhoneObservations` 保存最近的粗探步骤，分别记录运动提交前准备、适配器完成、位姿停稳和手机确认的用时。

前往标定参考位时，机械臂会跳过已到达的途经点。参考位移动失败时，审计的错误详情会记录移动方向和出错的路段。

退出拖动模式后，MG400 适配器会确认控制器已静止且无报警，执行 `ResetRobot()`，重建运动连接并等待一秒，再检查是否可以开始自动运动。做诊断对照时，可设置 `MIDSCENE_ARM_POST_DRAG_RESET=0` 跳过重置，或设置 `MIDSCENE_ARM_POST_DRAG_WAIT_MS=0` 跳过等待。

MG400 前往或返回标定参考位的横移，无论成功还是失败，都会写入 `reference-travel` 审计记录，包括指令与应答时间、`Sync()` 耗时和有限的现有控制器反馈样本。要对照额外的只读负载检查，可在启动机械臂服务前设置 `MIDSCENE_ARM_DIAGNOSTIC_PAYLOAD_READBACK=1`。前往参考位的每次横移下发前，服务最多等一秒接收一帧新的 MG400 反馈，并将回读质量与保存的工具质量核对。反馈缺失或不匹配时会阻止该次横移。

## 脚本与接口

将 [.env.example](./.env.example) 复制为 `.env`，填入服务和模型配置，然后运行：

```sh
pnpm exec tsx examples/open-device.ts
```

示例通过 `agentFromOpenDevice()` 读取当前屏幕。两个服务都可以在 `/api/docs/` 打开 Swagger UI，在 `/api/openapi.json` 查看接口定义。

[协议草稿](./packages/open-device/rfc/index.html) · [MIT 许可证](./LICENSE)
