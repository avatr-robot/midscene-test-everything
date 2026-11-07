import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: '@midscene/arm-kit-playground',
  include: ['tests/**/*.test.{ts,mjs}'],
  testEnvironment: 'node',
});
