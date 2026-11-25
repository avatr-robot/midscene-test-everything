# 多屏快速标定提速方案（精度不降为前提）

> 立场：把"精度不降"当成**设计约束**，而不是事后评估。每一项改动都必须回答
> "它改变了哪一个测量输入？"；答不上来、或答"改了"的，一律不做，或延后到"证据解锁"。
>
> 数据来源：`packages/robot-arm/arm-service/midscene_run/log/` 下 2026-11-16 的 Fast 批次日志，
> 以及当前工作区源码逐条核对（行号对应本次会话的 HEAD + 未提交改动）。

## 0. 摘要

- **已确认的边界**：
  - 手机页面可以一起发版 → A6/A7 纳入本版；
  - **不能**做"屏内降低行进高度"的现场间隙确认 → B1/B4 不做（少 ~12 s/屏）；
  - 真机**只跑新版本**、不做新旧交替，且**尽量不做额外实验** → 验证 = 构造性轨迹 golden + **正常标定运行**的质量带对照，不设专门的 10 次重复性实验；
  - 标定**不是高频重复动作**（标完只要精度没问题就不重标）→ B3 的价值收窄为"同一批次的第 2/3 块屏"，A9 续跑降为可选；
  - 典型屏数 **1–3（一般 1–2）**；
  - 精度判据放宽为历史带容差：**均值 +0.1 mm、最差 +0.2 mm**；产品门限（RMSE/holdout/tilt/range）不变。
- **可以承诺的**：**每屏省 60–105 s（约 1.3–1.7×）**；
  **1 屏 3–4 min → ~1.5–3 min；2 屏 6–8 min → ~3–6 min**（第 2 块屏还能吃到 B3 的 ~20 s）。
  含一次重试的 10.6 min → ~5–6 min（启用 A9 续跑后 ~4.5–5 min）。
- **凭什么不降精度**：A 类方案**不改变**任何一次探测的高度序列、接触判定规则、按压深度、
  校验点数量和质量阈值；它只改变三件事——**同一份证据取几次、几次查询发几趟、手机帧怎么送到主机**。
  这一点由确定性仿真的"测量轨迹逐字节一致"来强制，不依赖真机 A/B。
- **不能承诺的**：把单屏压到 60 s 以内，必须减少移动次数（连续下探、减校验点、裁剪边界验证）。
  这些会改变测量或质量证明，列为 C 类，**本阶段整体关闭**；第 6 节保留解锁条件，供将来参考。
- **第一步（1–2 天）**：把"测量不变量"变成可回归测试，并把历史 14 条 fast 记录变成基线库。
  这一步不碰生产行为、不跑实验；后面每一项都要靠它证明"精度没降"。**已完成，见 §12。**

---

## 1. 精度的可操作定义（测量不变量）

这套标定的精度由以下输入决定。A 类方案**一个都不动**：

1. **探测点集合与顺序**：初始 3 点（+X/+Y 15 mm 基线）、4 个拟合角点、2 个校验点。
2. **下探高度序列**：`2 mm` 粗步进 → `0.25 mm` bracket 收敛 → `PRESS_MM = 0.5 mm` 按压。
3. **接触判定**：静止后 2 帧一致、jitter 容差、`pointerId` 一致、freshness、5 s 超时。
4. **按压与漂移检查**：press 观测、角点重压、`PLANE_CORNER_REPRESS_DRIFT_RATIO`。
5. **质量证明**：校验点数量、`RMSE ≤ 0.5 mm`、`holdout ≤ 1.5 mm`、`tilt ≤ 5°`、`height range ≤ 6 mm`。
6. **边界验证覆盖**：hover 组 + contact 组、安全下限、相机边界断言。

**"精度不降"的判据（三层，第一层是硬门槛）：**

1. **确定性仿真（硬门槛）**：完整测量轨迹（每个点的 `target / z / touched / screen 点 / bracket /
   pressedZ / heightInterval`）与改动前**逐字节一致**。A 类改动如果让轨迹变了，就是 bug。
2. **正常标定运行即验证（真机，每次标定都是数据点）**：每次运行的
   `planeRmse / holdout / tilt / range / gridRms` 落在历史带内（均值 +0.1 mm、最差 +0.2 mm），
   且 `verification.auto.independentHeightCheck.predictionInInterval === true`；重试原因分布不高于历史基线。
   **不做专门的重复性实验**——用户本来就要标定，每次标定顺手产出这些指标即可。
3. **协议计数（可数门槛）**：每次移动/观测的控制柜往返次数、每屏总往返次数**只降不升**。

> 第 1 层是主证据（构造性，不依赖真机）；第 2 层不是"实验"，而是把每次正常标定的质量指标
> 自动与历史带对照；第 3 层防止后续在热路径里又加查询。详见 1.1。

### 1.1 没有旧版本基线时，怎么验证"精度没降"

**第一层：构造性 + 轨迹 golden（主证据，不依赖真机、不依赖旧版本）**

A 类改动不触碰上面六条测量不变量。把每个场景的完整测量轨迹快照成 golden，
任何差异即 bug。这一层能抓住"实现上少等了一帧、少取了一个点、改了顺序"这类真正会伤精度的错误，
而且和跑不跑旧版本无关。

**第二层：正常标定运行即验证（真机，不额外做实验）**

不做 10 次重复性实验。每次正常标定（用户本来就要做的）自动产出下面这些指标，逐次对照即可：

| 每次运行要检查的指标 | 期望 |
|---|---|
| 质量门限 | 全过（RMSE ≤ 0.5、holdout ≤ 1.5、tilt ≤ 5°、range ≤ 6 mm） |
| `independentHeightCheck.predictionInInterval` | `true`（用独立校验点的高度区间反查平面预测，单次就能发现测量链漂移） |
| `planeRmse / holdout / tilt / range / gridRms` | 落在历史带内（见第三层） |
| 重试原因分布 | 不高于历史日志基线（今天 3 次里 1 次失败，说明基线本身不低） |

**为什么 `independentHeightCheck` 是最灵敏的单次指标**：它拿"校验点的实测高度区间"去套"拟合平面的预测"，
两者走的是不同的点、不同的物理路径。如果改动让接触判定变早/变抖，这一项会先变成 `false`。

**第三层：历史分布对照（告警带，不作判决）**

本机 profile store 的 `calibration.verification.auto` 里已有 **14 条 fast 模式的完整证据**
（同一台 MG400，单一 `connectionIdentity`；含 9 个接触点的原始高度），可以直接给出这条工艺的过程能力带：

| 指标 | 均值（n=14） | 最大 | 产品门限 | 余量 |
|---|---|---|---|---|
| `planeRmseMm` | 0.201 | 0.394 | 0.5 | 21% |
| `holdoutHeightMm` | 0.546 | 0.907 | 1.5 | 40% |
| `validationMaxMm` | 0.397 | 1.011 | — | — |
| `gridRmsMm` | 0.340 | 0.497 | 短边的 1.5% | — |
| `tiltDeg` | 1.107 | 1.885 | 5 | 62% |
| `heightRangeMm` | 2.279 | 3.700 | 6 | 38% |

两个注意点：

1. 这 14 条来自同一台臂，但对应 **14 个不同的 screen 记录**（当前实际只有 2 块屏，
   今天各标了 1 次）。所以它只能当"同工艺过程带"，**不能当"同一块屏的重复基线"**；
   本方案也不打算为此专门做重复实验——A 类改动的精度保证由第一层承担。
2. **`planeRmseMm` 余量最小（历史最大 0.394 / 门限 0.5）**，任何改动后都应把这一项作为第一告警指标。

**对照规则（放宽后）**：每次正常运行的指标**均值 ≤ 历史均值 + 0.1 mm**，
**单次最差 ≤ 历史最大值 + 0.2 mm**，且 `predictionInInterval` 为 `true`。
任一超限即暂停，按下一段的"按需仲裁"处理。

**按需仲裁（不做交替 A/B，只在异常时触发）**

如果某次新版本运行出现以下任一情况：`predictionInInterval === false`、`planeRmseMm > 0.45`、
`holdoutHeightMm > 1.2`，或出现一次 `TOUCH_UNSTABLE`/`TOUCH_SAFETY_LIMIT` 重试，
就在**同一块屏、同一摆位**用旧构建跑一次做一次性仲裁。这不是交替对照，不进入常规流程。

**局限**

- 没有同屏重复基线，就测不出 run-to-run 的离散度；硬件上可检出的系统性偏移下限大约是 0.1–0.2 mm
  （也正是我们把容差放宽到这个量级的原因）。更小的偏移由第一层的构造性轨迹证明覆盖。
- 这套协议只适用于 A/B 类；C 类会改测量，必须做 mode-vs-mode 对照——**本阶段不做实验，所以 C 类整体关闭**。

---

## 2. 分级原则

| 级别 | 判据 | 处置 |
|---|---|---|
| **A** | 不改变任何测量输入，只改"取几次 / 发几趟 / 怎么送" | 直接做，用不变量测试守住 |
| **B** | 不改变测量，但改变运动包络或搜索起点（需现场确认间隙/振动） | 做，但先做单项现场验证 |
| **C** | 会改变测量样本、判定规则或质量证明覆盖 | **本方案不做**，给出解锁证据 |

---

## 3. 基线（实测）

### 3.1 端到端

| 屏幕尝试 | 结果 | 总时长 | `movl` | `phone-confirmation` | 其余（边界验证/切换） |
|---|---|---|---|---|---|
| A 屏（13:45） | 成功 | 186.0 s | 96.3 s / 128 次 | 43.7 s / 116 次 | ~46 s |
| B 屏（13:49） | 失败 | 201.5 s | 123.2 s / 166 次 | 69.1 s / 154 次 | ~9 s |
| B 屏重跑（14:04） | 成功 | 247.9 s | 134.2 s / 180 次 | 72.2 s / 168 次 | ~42 s |

- 单次移动 **745 ms**，单次观测 **430 ms**；`point-travel` 固定 ~18.4 s/7 段；
  `initial-search` 12.4–29.0 s。
- 2 块屏 3 次尝试，机器人工作时间合计 **10.6 min**（不含人工停顿）。
- `movl` 与 `phone-confirmation` 互不重叠；`initial-search`/`point-travel` 是它们内部的子区间。

### 3.2 一次 1 mm 探针移动：约 11 次控制柜往返

Fast 采样走 `collectAutomaticPoints` 的桥接 `move`（`arm-kit/src/runtime.ts:351-478`）：

| 环节 | 位置 | 代价 |
|---|---|---|
| `ready()` + payload 校验 | `runtime.ts:360` | 通常缓存命中，0–30 ms |
| preflight（runtime 显式调用） | `runtime.ts:387` → `driver-boundary.ts:568` | **IK 往返 ×1** |
| driver-boundary 自己的 preflight（robot profile 无 workspace） | `driver-boundary.ts:654` | **IK 往返 ×1** |
| 派发门 `getStateFresh()` | `mg400.ts:2787` → `:1997` | **`RobotMode`? + `GetErrorID` + `GetPose`** |
| 可达性 `checkReachability()` | `mg400.ts:2833` | **IK 往返 ×1** |
| `MovL` + `Sync` | `mg400.ts:2854` / `:2923` | 运动本身 50–150 ms |
| `Sync` 后状态确认 | `mg400.ts:2932` | **`GetErrorID` + `GetPose`** |
| 到达确认（`arrivalSamples = 1`） | `runtime.ts:189` / `mg400.ts:2959` | **`GetPose` ×1** |
| `motionExecutor.stable()`（2 帧 + 50 ms 轮询） | `motion-executor.ts:105-151` | **`GetPose` ×2 + 50–100 ms** |

合计 **约 11 次往返 + 50–100 ms 轮询**，再加运动本身。
按单次往返 15/30/50 ms 折算就是 220/385/600 ms —— 与实测 745 ms 同量级。

注意：这里**不是简单的"重复证明三遍"**。`Sync` 证明运动队列结束，adapter 的 1 帧只证明"落在 0.5 mm 内"，
kernel 的 2 帧静止才提供"停稳"证据。**可以合并，但不能直接删**（见 A4）。

### 3.3 一次手机观测：3 次往返 + 200 ms 固定等待

`phone-observation.ts:214-355` 的 `measure()`：`prepare` 读 → 2 轮 `max(100 ms, settle)` 等待 →
2 次 `result` 读。手机页面的 `send()` 只在**触摸事件、rAF 绘制、750 ms 心跳**时触发
（`phone/client.ts:1237-1251`），所以"确认无接触"实际是在等下一次心跳——这就是
`awaitingContact` 用 `heartbeatMs = 750 ms` 的原因（`shared/utils/src/assisted-contracts.ts:26`）。

### 3.4 每屏固定支出

- **边界验证**：`verification/boundary.ts:190-264`，Fast 下 hover 组 6 动作 + contact 组约 30 动作，
  共约 38 个 `runtime.move`，约 27 s。
- **初始搜索**：`sampler.ts:795-864`。两次成功/失败采样的日志都记录 `initial-fallback-no-local-window`，
  **包括已经标过的屏**——因为 `surfaceZ` 只从该屏自己的旧标定取，且条件很严
  （`calibration-batch.ts:928-945`），提示从未生效。29 s 的盲降 = 60 mm / 2 mm 步进。
- **I/O**：`profile-store.ts:1123-1157` 每次事务 `structuredClone` 整个 profile（本机 505 KB）
  再写文件 + rename；batch 的 `update()`（`calibration-batch.ts:85-93`）在进度每 150 ms 变化时触发。
  单次十几毫秒，但**阻塞同一个事件循环**，会抬高所有往返的尾延迟。

### 3.5 首过成功率

2 块屏 3 次完整尝试，重试占 32% 墙钟时间。失败根因：角点的 Z 下探预算只有
`PLANE_CORNER_MAX_BELOW_PREDICTED_MM = 2 mm`（`sampler.ts:52`），而平面是从**间距 15 mm**
的 3 个接触点外推到 100 mm 外的角点（`FAST_PLANE_PROBE_MM = 15`，`sampler.ts:73`）。
0.25 mm 的接触噪声经 15 mm 基线放大，在角点处约 **1.7 mm/σ**，正压在 2 mm 预算上。
失败重试时 `probeWithInsetRetries`（`sampler.ts:934-966`）只做 XY 向内收缩，不扩 Z 窗口。

---

## 4. A 类方案：零精度影响

> 下面每一项的"预期"只表示该项**单独**能减少的次数；A1/A2/A3/A4/A5 作用在同一条移动链上，
> 彼此有重叠，**不要相加**。合账见第 7 节。

### A1. 状态查询流水线化（已实现，默认关闭，待台架验证）

`queryState` 每次要发 `RobotMode`、`GetErrorID`、`GetPose` 三条**互相独立**的命令。
`TextChannel` 现在改成"回复队列 + `sendBatch`"：一次写入多条、按顺序匹配多条回复；
`queryState` 在开关打开且没有新鲜 30004 帧、位姿方言不是 `kinematic` 时走批量路径。

- **为什么不影响精度**：读到的还是同一批控制器数据，只是不再串行等待；位姿仍是 `GetPose` 的返回值。
- **开关**：`MIDSCENE_MG400_PIPELINE=1` 打开，默认关闭。命令之间**不加换行**（控制器按语法分帧，
  与现有单命令写入保持一致）；方言返回 `-30001/-30002` 时自动回退到原顺序路径。
- **预期**：每 move 省 2–3 趟（派发门 + Sync 后两次状态查询）→ **−7～18 s/屏**。
- **风险/前提**：批量写入未在台架验证；如果固件不接受，关掉开关即可回到现状（不需要回滚代码）。
- **测试状态**：`TextChannel` 重构被 205 个 adapter 用例覆盖（单命令路径）；**批量路径本身
  还没有自动化用例**，留到台架打开开关时验证。

### A2. 派发门不读 pose

`getStateFresh` 的 `queryState` 无条件 `readMeasuredPose()`（`mg400.ts:2040`），
但派发门只需要 mode/fault/enabled/moving；`s.pose` 只在 `detectStartFailure` 的 trace 路径用到
（`mg400.ts:2862-2867`）。

- **为什么不影响精度**：完全不参与测量；姿态由后面的到达/停稳证据提供。
- **预期**：每 move 省 1 趟 → 180 趟/屏。
- **工作量**：1 天。

### A3. IK 3 → 2（已完成）

同一个位姿在一条移动链里被算了 3 次：runtime 显式 preflight、driver-boundary 自己因无 workspace
又 preflight 一次、adapter 派发前 `checkReachability` 再一次。现在 driver-boundary 记录"刚 preflight 过的位姿"，
`move` 消费这条记录并跳过同一目标的重复 preflight；派发门那次仍然保留。

- **为什么不影响精度**：IK 只是"目标可达"的前置校验，不产生任何测量值；控制器侧的最终检查仍在派发门。
- **落地**：`kernel/driver-boundary.ts` 的 `preflighted` 票 + `poseSignature`；一次 preflight 只被消费一次，
  换目标必须重新 preflight。
- **预期**：每 move 省 1 趟 → 约 −2～5 s/屏。
- **测试**：`tests/calibration-motion-dedup.test.ts`——两个不同位姿应产生 2 次检查（不是 4 次）。

### A4. 到达证据合并（已完成）

`captureMotion` 请求 `arrivalSamples: 2`；运行时看到驱动返回了到达位姿时，跳过自己的 2 帧 dwell。
证据强度不变：`Sync` 回执 + 驱动连续 2 帧（0.5 mm / 0.01 内、静止）仍在。

- **为什么不影响精度**：同样是"2 帧静止"证据，只是不再取第二遍；位姿来自驱动确认到达时的那一帧，
  `Sync` 回执仍然保留。唯一的顺序变化是 idle 状态在 2 帧之前确认，由轨迹测试守住。
- **落地**：`runtime.ts` 的 `captureMotion` 与 capture host 的 `move`；跳过时 `stableMs` 记 0。
- **预期**：每 move 净省 1 次 `GetPose` + 3 次状态评估（约 15–40 ms），**约 −3～6 s/屏**。
  早期估计的 −18～27 s 假设 kernel dwell 只需 2 帧；实测"2 帧连续"要 3 个新鲜样本，与驱动的
  2 帧到达需要的样本数相同，所以省的是重复的状态读，不是样本数。
- **测试**：`tests/calibration-motion-dedup.test.ts`——dwell 不再读位姿。

### A5. 回读合并（已完成）

`Sync` 后的那次状态读已经拿到一个新鲜位姿；当它落在 0.5 mm / 0.01 容差内时，直接把它当作到达的第 1 帧，
到达循环只需再补 1 个样本（仍保持 50 ms 间隔），不再从零开始读 3 帧。

- **为什么不影响精度**：判定规则、容差、帧数都不变；位姿就是 `Sync` 后状态读的那一帧，且状态读已确认
  电机 idle、无 fault。`arrivedAt` 反而更接近真实的到达时刻。
- **落地**：`adapter-mg400/src/mg400.ts` 的到达循环：`postSync.pose` 在容差内时种入 `count = 1`，
  先补 50 ms 再读下一帧；关节目标不种入。
- **预期**：每 move 省 1 次 `GetPose` + 1 次 50 ms 轮询 → **−11～13 s/屏**（180 次移动）。
- **测试**：`@midscene/arm-adapter-mg400` 全部 205 个用例通过（含到达/确认/超时语义）。

### A6. 手机观测改为流式确认（已完成）

手机页面在"步骤激活"期间按 25 Hz 推送接触状态；主机用**完全相同的规则**判定：
`prepare` 已确认、静止后 ≥2 帧一致、帧间隔 ≥100 ms、jitter/pointerId/freshness 全部保留。
取消的是 2 次 `result` 请求/响应，以及"等 750 ms 心跳"。

**已落地：**

- `CalibrationPageUpdate` 增加能力位 `streamStepFeedback?: boolean`；页面在 `step` 激活时
  每 `streamStepFeedbackIntervalMs = 40` 发一次同一结构更新（含 `stepFeedback`），断线时清掉定时器。
- 主机 `StationaryPhoneObservation` 增加 `streaming` 构造参数：`prepare` 只发一次，随后把 step
  切到 `result` 并保持；从推送帧里取 **2 帧一致且间隔 ≥100 ms** 的结果，`settleMs` 仍从观测开始计。
- 回退：旧页面不带能力位 → 走原来的请求式路径，`measure()` 判定函数只有一份。
- `phone/session.ts` 校验该位必须是布尔。

**验证：**

- 新增 `tests/exploration-phone-streaming.test.ts`：2 帧确认（≥150 ms 才返回）、`no_touch` 两帧、
  `multiple_contacts` 仍被拒（`TOUCH_AMBIGUOUS`）。
- `exploration-phone-bridge.test.ts` 增加 `stream` 模式：走真实 `AutomaticCapture` 桥，fast 场景
  仍得到 3 + 6 个点、速度比不变。
- 原有 20 个请求式观测用例全部保持通过。

- **为什么不影响精度**：接受规则逐字不变，帧反而更多；`settleMs` 仍是 100 ms。
- **预期**：168 次观测 × 2 趟 + `press/search-limit/slide` 的心跳等待 → **−16～22 s/屏**。
- **风险/前提**：旧页面回退路径必须保留；25 Hz 发送略增功耗，标定期间可接受；真机验证与页面同版发布一起做。

### A7. `prepare` 与运动重叠

把"步骤激活"的 `prepare` 在移动提交时就发给手机（手机只是进入待测状态，不产生测量值），
运动结束时它早已就绪。

- **为什么不影响精度**：`prepare` 只是协议握手，结果仍在停稳后取。
- **预期**：每观测省 1 趟 → 168 趟/屏。
- **工作量**：2 天。

### A8. 进度/审计/SSE 节流

batch 进度落盘合并到 500 ms 一次；SSE 发布节流到 10 Hz；`saveSession` 从"每个样本一次"
合并到"每个点一次"。测量样本本身仍逐个保存（只是合并写盘时机）。

- **为什么不影响精度**：只影响持久化与推送频率，不影响任何采样或判定。
- **预期**：2–5 s/屏 + 事件循环尾延迟下降（后者会让 A1–A7 的收益更稳定）。
- **工作量**：1–2 天。

### A9. 失败续跑（改善期望时间，不改成功率）

当前一次失败会 `beginTask()` 新开会话（`workflow.ts:1035-1107`），已采的样本全部作废，
200 s 从头再来。改为：失败后保留 `auto.collectedSamples`，从最后一个已确认点继续
（复用同一个 `contextVersion`，几何/教学变更则拒绝续跑）。

- **为什么不影响精度**：续跑用的是同一批已测样本，后续点仍走完全相同的探测与判定；
  不跳过任何校验点，不降低阈值。
- **预期**：按 30% 重试率、每次失败省 100–140 s 计，**期望时间 −30～50 s/屏**。
- **风险**：需要重建 `measurements`/`fittedGeometry`，并把 `interrupted` 会话的状态机接回来；
  现有的 `reprobe/auto-repair` 命令目前是显式拒绝的（`workflow.ts:1188-1191`）。
- **工作量**：5–8 天（独立 PR，建议最后做）。

---

## 5. B 类方案：精度零影响，但需现场确认

| # | 动作 | 为什么精度不变 | 预期 | 需确认 |
|---|---|---|---|---|
| B2 | **行进段速度分层（已完成）**：fast 模式下纯行进段（抬升/横移/对角）用 `FAST_TRAVEL_FACTOR = 0.6`，探针步进与最终接近仍用 0.25；standard 模式不变 | 接触步速度不变；行进段本来就有到达回读与停稳确认；探针高度序列完全不变 | −2～5 s | 属动力学变化、不改路径与高度；台架验证时确认无过冲/屏体位移，异常即回滚 |

**B3 复盘：不能按原方案做（撤回 −20 s 的估计）**

`sampler.ts:800-806` 的局部窗口守卫是：

```
localApproach = surfaceZ + 10
localApproach - MAX_FAST_HEIGHT_RANGE(6) - TRAVERSE_CLEARANCE(10) >= startContact.z - INITIAL_DESCENT(60)
```

批处理的起始位在传送高度（屏面上方约 60 mm），代入后要求 **`surfaceZ >= 局部屏面 + 6 mm`**；
但局部下降只会到 `surfaceZ - 6`，要能真的碰到屏又需要 **`surfaceZ <= 局部屏面 + 6 mm`**。
两个条件合起来只剩一个点——**平坦屏永远进不去**（本次观测 tilt 均值 1.1°、height range 2.3 mm），
这也解释了日志里每次都记录 `initial-fallback-no-local-window`。

因此"给一个平面提示"本身不解决问题：要么改局部下探窗口（会加深首次接触前的最大下探量，属包络变化），
要么降低批处理传送高度（B1，已确认不能做）。**B3 从零风险项撤回**，初始搜索 29 s 在现有包络下无法省掉。

**本次不做的 B1/B4：**

| # | 动作 | 为什么不做 |
|---|---|---|
| B1 | 屏内行进高度解耦（`minimumTravelTipZMm` 从批级传送高度 ≈ 屏面+60 mm 降到"本屏最高接触+10 mm"） | 需要一次现场间隙确认：降至该高度后工具/腕部不蹭屏、不碰相邻屏。已确认无法进行 → **不做** |
| B4 | 屏内对角行进修复（日志里 7/7 `point-travel` 都是 `travel-fallback-clearance`） | 对角合并的前提正是 B1 的降高；B1 不做则条件永远不成立 → **一并搁置** |

> B1 的物理动机仍然成立：现在**每两个相邻点之间**都要爬升到批级传送高度再下来，
> `point-travel` 18.4 s/7 段就是这么来的。它不碰测量、不碰判定，是剩余零精度收益里最大的一块
> （~11 s/屏），一旦将来有条件做间隙确认，应优先补上。

---

## 6. C 类：本阶段关闭，以及解锁条件

| # | 动作 | 为什么算"降精度/降保障" | 解锁需要什么证据 |
|---|---|---|---|
| C1 | 连续接触下探（恒速下降 + `Stop()` 夹接触高度） | 接触高度从"静态 bracket"变成"动态停止"，过冲/漏报直接影响逐点高度 | 软屏 + 硬屏各 ≥10 次 A/B，逐点高度差 ≤0.1 mm、`holdout` 不劣化、无压屏事件 |
| C2 | 校验点 2 → 1 | 少一个独立高度校验，质量证明链变弱 | 用现有 28 条标定记录的 holdout 分布证明：4 角拟合的残差已能覆盖 1.5 mm 门限（含 3σ） |
| C3 | 边界验证裁剪（后续屏只验 2 角） | 边界外伸/漂移的检测覆盖下降 | 漂移注入实验（人为移动屏 1–2 mm）证明 2 角仍能检出 |
| C4 | `750 ms` 无接触等待缩短 | "确认无接触"依赖手机完整报告周期；漏报会导致多下探、压得更深 | 手机页面上报延迟分布 p99 + 漏报率统计 |
| C5 | 粗步距 4–5 mm | 首次接触可能比真实表面深 4 mm，按压变形/高度区间变宽 | 变形量实测 + bracket 收敛后的高度差统计 |
| C6 | refine/press 合并 | 改变"按住 vs 重压"的证据 | 同高度按住/重压的接触高度差统计（≤0.1 mm） |

这些不是"永远不做"，而是**不能用"应该没问题"来换**。它们的收益很大（合计可再 −40～60 s/屏），
但必须由数据开门。**本阶段已确认尽量不做实验，因此 C 类整体关闭**；将来若允许 mode-vs-mode 对照，
再按下表的解锁条件逐项评估。

---

## 7. 总账

**（1）确定性计数：控制柜往返次数**

| 项目 | 现状/屏 | 方案后/屏 |
|---|---|---|
| 采样移动往返 | 180 × ~11 ≈ 1980 | 180 × 4–8 ≈ 720–1440 |
| 观测请求/响应 | 168 × 3 = 504 | 168 × 1 ≈ 168（其余走流） |
| 验证移动往返 | 38 × ~14 ≈ 530 | 38 × 6–9 ≈ 230–340 |
| 合计 | **≈ 3000** | **≈ 1100–1900（−37%～−63%）** |

**（2）时间模型：每次节省 × 次数**

| 项目 | 每次节省 | 次数/屏 | 首屏节省 | 同批第 2/3 屏 |
|---|---|---|---|---|
| 采样移动（A1–A5） | ~180–320 ms（约 7 趟往返 + 50–100 ms 轮询） | 180 | 32–58 s | 同左 |
| 观测（A6/A7） | ~80–120 ms（2 趟往返）+ 心跳等待 | 168 + 约 9 次 | 19–26 s | 同左 |
| 验证移动（A1–A5） | ~180–320 ms | 38 | 7–12 s | 同左 |
| 初始搜索提示（B3） | — | — | 0（没有参考平面） | ~20 s |
| 行进段速度（B2） | — | — | 2–5 s | 同左 |
| I/O 节流（A8） | — | — | 2–5 s | 同左 |
| **合计** | | | **62–106 s** | **82–126 s** |

- 248 s 屏 → 首屏 **~142–186 s**；同批第 2 屏 **~122–166 s**
- 186 s 屏 → 首屏 **~80–124 s**；同批第 2 屏 **~60–104 s**
- 按批算（典型 1–2 屏）：

| 场景 | 现在 | 方案后 |
|---|---|---|
| 1 块屏 | 3–4 min | ~1.5–3 min |
| 2 块屏（无重试） | 6–8 min | ~3–6 min |
| 2 块屏（含 1 次重试） | ~10.6 min | ~5–6 min（启用 A9 续跑后 ~4.5–5 min） |

- 再加 A9 续跑：按 30% 重试率、每次失败省 100–140 s 计，**期望**时间再省 30–50 s/屏。

> 这个模型对单次往返时延（15–50 ms）不敏感：即使每趟只要 15 ms，首屏收益仍有 ~60 s；
> 因为大头是"少一次采样/少一段固定等待"，而不只是"少几趟 TCP"。
> 仍需 Step 0 的实测把"每次节省"钉死在 180–320 ms 区间里的具体值。
>
> **进度提醒**：上表是 A/B 两类全部落地的模型值。当前已落地 A3+A4+A5+A6+B2，A1 已实现但**默认关闭**；
> 默认口径 **−34～51 s/屏**，打开 A1 后 **−41～69 s/屏**；A2/A7 尚未实施；B3 已复盘撤回（见 §5）。

---

## 8. 落地顺序

| 阶段 | 内容 | 工期 | 验收 |
|---|---|---|---|
| **Step 0** | 度量 + 不变量测试（**已完成，见 §12**）：轨迹 golden、工作预算、历史基线库、日志时间分解脚本 | 1–2 天 | 轨迹测试全绿；基线脚本可复现 §1.1 的表格 |
| **Step 1** | A1–A3：A3 已完成；A1 已实现（默认关闭，待台架验证）；A2 待做 | 2–4 天 | 轨迹逐字节一致；往返数 ≤ 预算；下一次正常标定的质量指标在历史带内 |
| **Step 2** | A4–A5（到达证据合并、回读合并）：A4 已完成；A5 待做 | 2–3 天 | 轨迹逐字节一致；停稳证据强度不变；正常标定指标不劣化 |
| **Step 3** | A6–A7 + 手机页面（流式确认、prepare 重叠）：A6 已完成；A7 待做 | 3–5 天 | 新旧页面都能跑；轨迹一致；旧页面回退路径有测试 |
| **Step 4** | A8 + B2：B2 已完成；A8 待做；B3 已复盘撤回 | 2–3 天 | 轨迹一致；指标不劣化；B2 有回滚开关 |
| **Step 5** | A9 失败续跑（可选：最坏情况保险） | 5–8 天 | 人为制造一次角点失败，续跑后结果与不失败时一致 |

建议每个 Step 一个独立 PR，按 `.github/pull_request_template.md` 写"模拟验证 / 真机验证"两栏。
Step 1–2 不依赖手机端，可以先落地拿收益；Step 3 与手机页面同版本发布。
每个 Step 落地后**用一次正常标定**（本来就要做的）检查质量指标即可，不安排专门的重复性实验。
A9 可以最后做，但它能把"一次重试 3 分钟"压到"一次续跑 1 分钟"，对 1–2 屏的批次方差很有用。

---

## 9. 验收与回归

1. **轨迹不变量（必须全绿）**：`arm-kit/tests/exploration-sampler.test.ts` 已有 `motions` 数组和
   6 种 fast 场景；把每个场景的完整测量轨迹快照成 golden，任何 A 类改动后必须逐字段一致。
2. **往返预算**：用 `FakeAdapter`（`arm-kit/src/testkit/fake-adapter.ts`）+ `mock-arm.ts` 跑完整 batch，
   断言"每次移动的控制柜命令数 ≤ N"。这条能防止后续有人在热路径里又加一次查询。
3. **真机验证（不做实验）**：每个 Step 落地后，用下一次**正常标定**检查
   `planeRmse / holdout / tilt / range / gridRms` 是否在历史带内、`predictionInInterval` 是否为 `true`。
   出现离群时，用旧构建在同一屏跑一次做一次性仲裁。
4. **精度红线不动**：`RMSE ≤ 0.5 mm`、`holdout ≤ 1.5 mm`、`tilt ≤ 5°`、`height range ≤ 6 mm`；
   任何一项劣化就回滚对应优化。
5. **安全回归**：`TOUCH_SAFETY_LIMIT`、命令下限、`Stop()` 路径、相机边界、payload 证据链的测试全部保持通过。

---

## 10. 风险与回滚

- **共享路径**：A1–A5 在 `kernel/`、`runtime.ts`、`adapters/mg400/`，会影响屏幕交互和任务执行。
  用"adapter 能力标记 + 校准路径 opt-in"落地，先只在 calibration/batch 打开。
- **协议**：A1 依赖 dashboard 接受多命令写入；先在真机做一条一次性验证，失败就退回 A2/A4。
- **时序**：A4/A5 改的是"证据在什么顺序上取得"，这是最需要不变量测试的一项；有问题优先回滚它。
- **跨端**：A6/A7 已确认与手机页面同版发布；仍需版本协商 + 旧页面回退，避免"服务端升级、手机没升级"。
- **精度**：所有 A/B 类改动**不碰**第 1 节的六条测量不变量；一旦发现需要碰，立刻降级到 C 类。

---

## 11. 已确认 / 还需确认

**已确认：**

- 手机页面可以一起发版 → A6/A7 纳入本版，旧页面保留请求式回退。
- 不能做"屏内降低行进高度"的现场间隙确认 → B1/B4 不做，其 ~12 s/屏 的收益不计入承诺。
- 真机**只跑新版本**、不做新旧交替 → 验证 = 构造性轨迹 golden + **正常标定运行**的质量带对照（1.1）。
- **尽量不做额外实验** → 取消 10 次重复性实验；C 类（连续下探、减校验点、裁剪边界验证等）整体关闭。
- 标定**不是高频重复动作**（精度没问题就不重标）→ B3 只保留"同批第 2/3 块屏"的价值（~20 s/屏），
  B3 不计入首屏承诺；A9 续跑为可选。
- 典型屏数 **1–3，一般 1–2**。
- 精度判据放宽为历史带容差（均值 +0.1 mm、最差 +0.2 mm）；产品门限不变。
- 历史 14 条 fast 记录**同一台 MG400**（单一 `connectionIdentity: 192.168.1.6:29999:30003`），
  但对应 14 个不同 screen 记录；当前实际只有 2 块屏（今天各标 1 次）。因此它只作"过程带"。

**还需确认（不阻塞开工）：**

1. **B3 要不要做**：它只对"同一批次第 2/3 块屏"有效，约 20 s/屏；首屏无效。做与不做都不影响首屏承诺。
2. **A9 续跑要不要排期**：它不是常规提速，而是"一次重试 3 分钟 → 1 分钟"的方差保险。
3. **Step 0 的度量字段**是否够用：`moves / observes / 往返数 / preflight / dispatch / motion / arrival /
   stable / observe / verify`——如果还想看别的（比如手机端上报间隔），现在提最省事。

---

## 12. Step 0 产物与并发约定

### 12.1 已交付（只新增文件，未改动任何共享文件）

| 产物 | 路径 | 作用 |
|---|---|---|
| 测量轨迹 golden 测试 | `packages/robot-arm/arm-kit/tests/exploration-measurement-trace.test.ts` | 走生产桥 `AutomaticCapture` + 确定性手机模型跑 fast 场景；断言完整轨迹逐字段一致，并设工作预算 |
| golden 快照 | `packages/robot-arm/arm-kit/tests/golden/exploration-measurement-trace.json` | 121 次移动 / 109 次观测 / 9 个接触点 / 平面参数（tilt 1.47°、range 2.86 mm、holdout 0.07 mm、RMSE 0.05 mm） |
| 历史基线提取 | `packages/robot-arm/arm-service/scripts/calibration-baseline.mjs` | 从 profile store 提取 fast 记录，输出 n/mean/max/p90、门限余量与放宽后的告警带 |
| 基线快照 | `docs/calibration-baseline.json` | 同臂 14 条记录（14 个 screen 记录）的基线数据 |
| 日志时间分解 | `packages/robot-arm/arm-service/scripts/calibration-log-report.mjs` | 解析批次日志与采样日志，输出每屏 total/moves/observe/other 与各 timing bucket |

运行方式（三个命令都从仓库根目录执行）：

```sh
pnpm --filter @midscene/arm-kit exec rstest run tests/exploration-measurement-trace.test.ts
node packages/robot-arm/arm-service/scripts/calibration-baseline.mjs
node packages/robot-arm/arm-service/scripts/calibration-log-report.mjs
```

- `UPDATE_GOLDEN=1` 时测试会重写 golden。**重建 golden 等于承认测量行为变了**，必须在 PR 里单独说明；
  A 类改动不允许重建。
- 日志脚本的输出与第 3 节的表格一致：**746 ms/次移动、423 ms/次观测、56%/29%/15%**，
  可直接作为每屏提速前后的对照口径。

### 12.2 与另一个 agent 的并发约定（重要）

当前工作区有**另一个 agent 正在做 robot twin**（`server/twin.ts`、`ui/twin/*`、`TwinPanel.*`、
`public/models/mg400/*`、`DeviceWorkspace.tsx`、`App.less` 等），最后写入时间是 14:59，仍在活跃。
并且它已经把整个工作区 stage（`git status` 首列是 `A`/`M`），包括本方案文档。

**本阶段我只新增文件，没有改动任何已修改/已暂存的文件。** Step 1 起必须改的共享文件：

| 变更 | 必需改动的文件 |
|---|---|
| A1 状态查询流水线化 | `adapter-mg400/src/mg400.ts` |
| A2 派发门免 pose | `adapter-mg400/src/mg400.ts` |
| A3 IK 3→1 | `arm-kit/src/runtime.ts`、`kernel/driver-boundary.ts` |
| A4/A5 到达证据合并、回读合并 | `arm-kit/src/runtime.ts`、`kernel/motion-executor.ts`、`adapter-mg400/src/mg400.ts` |
| A6/A7 手机流式 | `calibration/phone/client.ts`、`exploration/phone-observation.ts`、`exploration/capture.ts`、`calibration-server/*` |
| A8 I/O 节流 | `runtime/profile-store.ts`、`arm-service/src/server/calibration-batch.ts` |
| B2/B3 | `calibration/exploration/sampler.ts`、`calibration/workflow.ts`、`arm-service/src/server/calibration-batch.ts` |

两种协作方式，任选其一：

1. **对方先提交自己的 twin 改动**（只提交它自己的文件，不要 `git add -A`），我再在干净基线上改共享文件；
2. **由你指定文件归属**，我只改清单里属于我的文件，其余等对方完成。

另请提醒对方：它现在的 `git add` 已经把 `docs/screen-calibration-speedup-plan.md` 一起暂存了；
如果直接 commit，会把这个文档（以及可能其它改动）带进它的提交。建议提交前先 `git status` 核对。

### 12.3 Step 1/2/3/4 已落地（A1 + A3 + A4 + A5 + A6 + B2）

对方暂停后开始改共享文件，本阶段动了七处源码 + 两个新测试：

| 文件 | 改动 |
|---|---|
| `packages/robot-arm/adapter-mg400/src/mg400.ts` | `TextChannel` 改为回复队列 + `sendBatch`；`queryState` 增加批量路径（`MIDSCENE_MG400_PIPELINE=1` 才启用，方言错误回退）；到达循环复用 `Sync` 后位姿 |
| `packages/shared/utils/src/assisted-contracts.ts` | `CalibrationPageUpdate.streamStepFeedback` 能力位 + `CALIBRATION_POINT_POLICY.streamStepFeedbackIntervalMs = 40` |
| `packages/robot-arm/arm-kit/src/calibration/phone/client.ts` | 页面在 step 激活时按 40 ms 流式发送；断线清理定时器；能力位随更新上报 |
| `packages/robot-arm/arm-kit/src/calibration/exploration/phone-observation.ts` | 新增 `streaming` 路径：prepare 一次、step 保持 result、从推送帧取 2 帧一致且 ≥100 ms；旧页面走原请求式 |
| `packages/robot-arm/arm-kit/src/calibration/exploration/capture.ts` / `phone/session.ts` | 把能力位传给观测；校验布尔类型 |
| `packages/robot-arm/arm-kit/src/calibration/exploration/sampler.ts` | fast 行进段用 `FAST_TRAVEL_FACTOR = 0.6`（抬升/横移/对角），探针与最终接近仍 0.25；standard 不变 |
| `packages/robot-arm/arm-kit/tests/calibration-motion-dedup.test.ts` | 新增：① 驱动确认到达后不再读位姿；② 两个不同目标 = 2 次可达性检查（证明票只消费一次、不跨目标泄漏） |
| `packages/robot-arm/arm-kit/tests/exploration-phone-streaming.test.ts` | 新增：流式 2 帧确认、no-touch、ambiguous 拒绝 |

**验证**（当前状态）：

- `@midscene/arm-kit` 与 `@midscene/arm-adapter-mg400` typecheck 通过（shared 已重建）。
- 聚焦 6 个测试文件 **91/91** 通过（含轨迹 golden、kernel、calibration-host）。
- `@midscene/arm-adapter-mg400` **205/205** 通过（A5 落地后再次全绿，含全部 reachability / 到达确认用例）。
- `exploration-phone-streaming` 3/3、`exploration-phone-bridge` 12/12（含 `stream` 模式）通过。
- 全量 `@midscene/arm-kit` **460/460 通过**（45 个文件）。首轮曾出现 `contact-timing.test.ts` 的
  `scheduledHoldMs` 62 > 60（2 ms 超差），单文件重跑 6/6、全量重跑也通过，判定为全量并行下的计时抖动，
  与本轮改动无确定关联；后续再出现时按 flaky 单独跟踪。

**预期收益（本轮）**：A3 −2～5 s/屏，A4 −3～6 s/屏，A5 −11～13 s/屏，A6 −16～22 s/屏，B2 −2～5 s/屏，
合计 **−34～51 s/屏（约 15–21%）**。A4 比原计划低，原因已写进 A4 小节；B3 已撤回。

**B2 的轨迹证据**：重生成 golden 后逐项对比——121 次移动的 x/y/z 完全相同、9 个接触点相同、平面参数相同、
手机结果帧相同、timing bucket 相同；**唯一变化是 14 次行进移动的 `speedRatio` 0.2 → 0.48**。
这正是 B2 的预期，测量轨迹未变。

**下一步**：

- **A2 派发门免 pose**（−2～5 s/屏）：会牵动状态缓存与 readiness 的新鲜度，建议最后做或不做。
- **A7 prepare 与运动重叠**（−3～6 s/屏）：需把 `prepare` 提前到移动提交前，跨 sampler/bridge 改成两阶段协议；
  收益小、改动面大，**建议不做**。

**A1 状态**：已实现，默认关闭；`TextChannel` 重构被 205 个 adapter 用例覆盖，**批量路径本身尚无自动化用例**，
台架验证时用 `MIDSCENE_MG400_PIPELINE=1` 打开，失败直接关掉即可（不需要回滚代码）。

---

## 13. 当前分支实现状态（2026-11-17，`calibration-synthesis`）

> 本节取代 §12.3 的状态描述。§12.3 记录的是 parked 提交 `edc0de1`；本分支在该提交的基础上重新落地，
> 并补了"倾斜审计"这一项新设计。提交序列：
> `eea8fc9`（Z 证据隔离）→ `f24862a`（分阶段计时）→ `11bd146`（golden 三场景）→
> `512d7e1`（A3/A4/A5/B2）→ `555b8ae`（A6）→ `8830299`（倾斜审计）→ `c0b79d0`（A1 选项化 + 自动回退）。

### 13.1 落地对照

| 项 | 状态 | 说明 |
|---|---|---|
| A1 状态查询流水线 | **已实现，默认关** | 改为 per-adapter 选项 `pipelineStateQueries`（`MIDSCENE_MG400_PIPELINE=1` 仍可用）；批量失败（少回包/多回包/解析错）会**自动关闭**并记录，重连后走单命令。仍待台架验证 |
| A2 派发门免 pose | 未做 | 牵动状态缓存与 readiness 新鲜度，最后考虑 |
| A3 IK 3→2 | 已落地 | preflight ticket，每目标一次 |
| A4 到达证据合并 | 已落地 | driver 两帧到达替代应用层 dwell |
| A5 回读合并 | 已落地 | `Sync` 后状态作为第 1 个到达样本 |
| A6 手机流式确认 | 已落地 | 25 Hz 推流 + 两帧确认；500 ms 无帧回退；无能力位走旧协议 |
| A7 prepare 与运动重叠 | 未做 | 跨 sampler/bridge 两阶段协议，收益小、改动大 |
| A8 进度/审计/SSE 节流 | 未做 | |
| A9 失败续跑 | 未做 | |
| B1 屏内降高 / B4 对角行进 | 未做 | 仍等现场间隙确认；B1 不做则 B4 条件不成立 |
| B2 行进速度分层 | 已落地 | 仅 fast 行进腿 0.6；golden 只有 `speedRatio` 差异 |
| B3 初始搜索提示 | 撤回 | 原守卫生效区间与批处理传送高度互斥，观测中从未触发 |
| C 类 | 全部关闭 | 解锁条件见 §6 |

### 13.2 与 §12.3 的关键差异

1. **fast 的 Z 证据被拆开**：fast-horizontal 只有首触是实测高度，`+X/+Y` 探针和角点都用预测。
   现在样本带 `zSource`，预测点**不再进入平面拟合与局部表面补偿**（`eea8fc9`）；
   实测少于 3 个时平面取"沿接近方向的显式水平假设面"，≥3 个时用实测点拟合。
   evidence 新增 `samplingMode / measuredPlaneSamples / predictedSamples / predictedFraction /
   predictedHeightResidualMaxMm / measuredHeightRangeMm`。
2. **倾斜审计（新设计，`8830299`）**：6 个网格点改为 validation 先采。两个 validation 点用审计包线实测
   （起点 = 最低实测接触 + 8 mm，下探 14 mm）；实测高度与预测模型偏差 > 3 mm，或包线内测不到，
   在**触碰任何角点之前**抛 `SCREEN_TILT_UNSUPPORTED`。`planeSource=assumed-horizontal` 时验收必须有
   实测 holdout（`validationHeightMaxMm`），避免"未审计的假设"自动通过。
3. **代价（确定性 fast 场景）**：移动 27 → **47**，手机确认 26 → **43**（约 +6–9 s/屏）。
   换来的是"角点前拒绝"和 fast 模式第一个独立 Z holdout（golden 中 0.875 mm）。standard 完全不变。
4. **审计 v2（`5a6bdbe`）**：首版审计点取的是两个 validation（同一行、与首触共线），实测双屏后发现
   只覆盖了单一方向、且平面仍是假设值。现在改为取"与首触组成面积最大的两个角点"（相邻角点，绝不取
   共线对角），并用这 3 个实测点拟合真实平面驱动后续按压：预测高度 = 实测平面 − 首触按压偏移；
   局部恢复点会刷新平面；`fitSamplePlane` 增加近共线拒绝。确定性 fast 场景 47 → **49** moves，
   `planeSource=measured`、3 个实测拟合点，validation 退回纯 XY holdout（Z holdout 由恢复点/边界验证兜底）。
   **这会再次改变测量输入，基线必须在新版本上重采。**
5. **§12.3 的验证数字已过期**：本分支当前 `@midscene/arm-kit` **462/462**、`@midscene/arm-adapter-mg400`
   **206/206**、golden 三场景（fast / standard / stream）全部通过。

### 13.3 基线重采（必须做，且与本版口径绑定）

- 旧 `docs/calibration-baseline.json` 是 fast-plane 时代的数据：没有 `samplingMode` 字段，
  `predictionInInterval` 只有 5/15 条为 true，**不能作为 fast-horizontal 的验收带**。
- 新脚本（`@midscene/arm-service`）：
  - `pnpm --filter @midscene/arm-service calibration:baseline`：读安装 profile store，按 `samplingMode`
    分组输出指标 n/mean/min/max/p90、门限、告警带与超门限计数；
  - `--mode fast --out docs/calibration-baseline.json`：生成 fast 基线；
  - `--check <baseline.json>`：对 `generatedAt` 之后的新记录做 per-run 门限 + 批次带检查，失败退出码 1。
- 判据口径：**per-run 用硬门限**（planeRmse 0.5 / holdout 1.5 / tilt 5° / range 6 / validationHeight 1.5 /
  surface 3 mm）；`mean+0.1 mm`、`max+0.2 mm` **只用于批次**（n≥3 才判均值），不能拿来判单次运行。
- 重采步骤：① 新版本上完成 ≥10 次正常 fast 标定（1–3 屏/批，含必要重试并记录原因）② 生成基线
  ③ 之后每次正常标定用 `--check` 对照。standard/slide 同样各生成一份。

### 13.4 计时日志

每次自动标定在 workflow 里打一行 `Automatic sampling timing {json}`（`attemptId/deviceId/timing`）。
用 `pnpm --filter @midscene/arm-service calibration:report <log>` 聚合 `movl / phone-confirmation /
point-travel / initial-search`，输出每次尝试的移动数、手机确认数、各段耗时与均值；这是后续评估 A2/A7/A8/A9
收益的唯一度量入口。

### 13.5 A 方案：首触连续下降——两次尝试均否决，保留 2 mm 步进

**动机**：B 屏首搜 34.5 s（32 mm 盲降、17 次 2 mm 探测）；批量自动 reference 用
`source.origin.z + 30`（`calibration-batch.ts:845`），与真实屏面差取决于屏高/教学间隙；任何"同台面平面"
预测都无法覆盖"两块屏高度不同"，所以曾尝试**直接测**（接触即停）。

**第一次：MoveJog（`eaeb594`，已回退 `68252a0`）**

- 2026-11-18 10:13 实测：`MoveJog(Z-)` 469 ms 走 29.4 mm（约 **63 mm/s**），停止位比屏面低约
  **19 mm**，操作者急停；
- `SpeedFactor(2)` 被控制器接受但**没有作用于 MoveJog**（MG400 点动速度 = 控制软件点动设定 × 全局
  比例，固件/模式下未必受 `SpeedFactor` 约束）；接触→停车的延迟 × 63 mm/s = 20 mm 过冲；
- 结论：**禁止用 MoveJog 做接触搜索**。

**第二次：慢速 MovL + 暂停（`bb7e98a`，已回退 `424da98`）**

- 用普通 MovL（与 2 mm 探测同速）非阻塞提交，手机报接触后 `adapter.pause()`（`ResetRobot` + 停止
  确认）并 `resume()`，目标点为起点下方 60 mm；
- 真机验证仍不可接受（操作者结论："还是不行"），代码已回退；
- 说明：低速路径的**接触检测→暂停延迟**与 `ResetRobot` 行为组合起来仍不足以安全压屏；在拿到可信的
  停止过冲数据前不再尝试。

**当前状态**：保持原有首触逻辑——从 reference 高度按 2 mm 步进下探，每次探测手机确认，触碰后走
0.25 mm bracket。批量 reference 公式未改；`MIDSCENE_GUARDED_TOUCH` 相关代码与开关均已移除
（`git diff 5a6bdbe HEAD` 为空）。

**若未来重开此方向**，前置条件：

1. 先在没有屏幕的空中测出"命令速度 vs 实际速度"和"接触→完全停止"的延迟分布（至少 10 次）；
2. 暂停/停止必须是可控减速（协议 `Pause()`，而不是 `ResetRobot` 硬停），且能确认清队列；
3. 需要独立的过冲上限（机械限位/柔性触头行程），不能只靠软件延迟；
4. 在此之前，首触优化只考虑**不改变运动方式**的路径（如压缩单次探测周期开销）。



