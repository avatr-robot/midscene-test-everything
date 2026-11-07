import { defineConfig } from '@rsbuild/core';
import { pluginLess } from '@rsbuild/plugin-less';
import { pluginReact } from '@rsbuild/plugin-react';
export default defineConfig({
  plugins: [pluginReact(), pluginLess()],
  source: { entry: { index: './src/standalone/index.tsx' } },
  output: { assetPrefix: './' },
  html: { title: 'Midscene Arm Calibration' },
});
