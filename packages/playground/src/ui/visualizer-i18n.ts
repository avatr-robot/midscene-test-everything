import { t } from '@midscene/arm-calibration-ui';

// Host-owned dictionary; the vendored components only accept a translator.
const zh: Record<string, string> = {
  Config: '模型配置',
  'set up': '设置',
  'Model Env Config': '模型配置',
  Cancel: '取消',
  Save: '保存',
  Verify: '验证连接',
  Verifying: '验证中',
  Verified: '验证成功',
  'Model environment configuration': '模型环境配置',
  'Please set up your environment variables before using.':
    '请先设置共享模型配置。',
  'Enter one KEY=VALUE per line. Configuration is shared by all tasks in this browser.':
    '每行填写一个 KEY=VALUE，当前浏览器中的所有任务共享此模型配置。',
};
export function translateVisualizer(
  message: string,
  values: readonly unknown[] = [],
  language: 'zh' | 'en' = 'en',
) {
  if (language === 'zh' && zh[message]) return zh[message];
  return t(message, values, language);
}
