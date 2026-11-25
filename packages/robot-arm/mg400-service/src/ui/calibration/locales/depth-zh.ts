export const depthZh: Record<string, string> = {
  'Saving restarts the running camera immediately.':
    '保存后会立即重启正在运行的相机。',
  'Capture Resolution': '采集分辨率',
  'Capture Frame Rate': '采集帧率',
  'Camera Profile · {0}': '相机配置 · {0}',
  'Preview only': '仅预览',
  'Perspective corrected': '已透视校正',
  'Depth map': '深度图',
  'Depth SDK Controls': '深度 SDK 参数',
  'Depth sensor controls': '深度传感器参数',
  'Saving restarts the running depth stream to apply SDK values.':
    '保存后会重启正在运行的深度流以应用 SDK 参数。',
  'Advanced SDK controls': '高级 SDK 参数',
  'Depth Exposure (usec)': '深度相机曝光时间，单位为微秒。',
  'UVC image gain': '深度相机的图像增益。',
  'Advanced-Mode Preset':
    '选择 RealSense 深度算法预设，用于在测量距离、细节、噪点和稳定性之间取舍；可选项来自当前设备。',
  'Manual laser power in mw. applicable only when laser power mode is set to Manual':
    '手动模式下的红外激光功率，单位为毫瓦；仅在激光功率模式为 Manual 时生效。',
  'Emitter select, 0-disable all emitters, 1-enable laser, 2-enable laser auto (opt), 3-enable LED (opt)':
    '选择红外发射器模式。下拉框只列出当前设备固件实际支持的模式。',
  'Max number of frames you can hold at a given time. Increasing this number will reduce frame drops but increase latency, and vice versa':
    'SDK 同时缓存的帧数。增大可减少丢帧，但会增加延迟；减小则相反。',
  'Enable / disable polling of camera internal errors':
    '启用或关闭相机内部错误轮询。',
  'Generate trigger from the camera to external device once per frame':
    '每采集一帧，从相机向外部设备发送一次触发信号。',
  'Number of meters represented by a single depth unit':
    '每个深度值对应的实际距离，单位为米。',
  'External sync': '设置多台相机之间的外部硬件同步模式。',
  'Alternating emitter pattern, toggled on/off on per-frame basis':
    '让红外发射器按帧交替开启和关闭。',
  'Enable/Disable global timestamp':
    '启用或关闭全局时间戳，便于多设备数据对齐。',
  'Emitter always on mode: 0:disabled(default), 1:enabled':
    '让红外发射器持续开启；0 表示关闭，1 表示开启。',
  'Exposure limit is in microseconds. If the requested exposure limit is greater than frame time, it will be set to frame time at runtime. Setting will not take effect until next streaming session.':
    '自动曝光的最大曝光时间，单位为微秒。若超过单帧时间，运行时将按单帧时间处理；该设置会在下一次启动流时生效。',
  'Gain limits ranges from 16 to 248. If the requested gain limit is less than 16, it will be set to 16. If the requested gain limit is greater than 248, it will be set to 248. Setting will not take effect until next streaming session.':
    '自动增益的取值上限范围为 16 到 248。低于 16 按 16 处理，高于 248 按 248 处理；该设置会在下一次启动流时生效。',
  'Toggle Auto-Exposure Limit': '启用或关闭自动曝光上限设置。',
  'Toggle Auto-Gain Limit': '启用或关闭自动增益上限设置。',
  Exposure: '曝光',
  Gain: '增益',
  'Enable Auto Exposure': '启用自动曝光',
  'Visual Preset': '视觉预设',
  'Laser Power': '激光功率',
  'Emitter Enabled': '发射器模式',
  'Frames Queue Size': '帧队列长度',
  'Error Polling Enabled': '启用错误轮询',
  'Output Trigger Enabled': '启用输出触发',
  'Depth Units': '深度单位',
  'Inter Cam Sync Mode': '多相机同步模式',
  'Emitter On Off': '逐帧发射器切换',
  'Global Time Enabled': '启用全局时间',
  'Emitter Always On': '发射器常开',
  'Hdr Enabled': '启用 HDR',
  'Sequence Name': '序列名称',
  'Sequence Size': '序列长度',
  'Sequence Id': '序列 ID',
  'Auto Exposure Limit': '自动曝光上限',
  'Auto Gain Limit': '自动增益上限',
  'Auto Exposure Limit Toggle': '启用自动曝光上限',
  'Auto Gain Limit Toggle': '启用自动增益上限',
};
