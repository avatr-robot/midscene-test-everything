import { expect, it } from '@rstest/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PhonePairStep } from '../src/components/robot-arm/PhonePairStep';
import { WebCalibrationWorkspace } from '../src/components/robot-arm/WebCalibrationWorkspace';
import { WebCameraMappingStep } from '../src/components/robot-arm/WebCameraMappingStep';
import type { AssistedCalibrationController } from '../src/hooks/useAssistedCalibration';

const markerError =
  'Calibration marker 12 could not be decoded uniquely (2 matches). Keep all calibration markers visible and in focus.';
const controller = (connected = true) =>
  ({
    setup: { prepared: true, phoneConnected: connected },
    phone: {
      state: connected ? 'connected' : 'waiting',
      links: [],
      model: 'iPhone',
    },
    session: null,
    busy: false,
    error: markerError,
  }) as unknown as AssistedCalibrationController;

it('keeps camera command errors out of the phone connection step', () => {
  const html = renderToStaticMarkup(
    createElement(PhonePairStep, {
      controller: controller(),
      footer: null,
      onContinue() {},
    }),
  );
  expect(html).toContain('手机已连接');
  expect(html).not.toContain('Calibration marker');
  expect(html).not.toContain('识别失败');
});

it('still shows transport connection failures on the phone step', () => {
  const value = controller();
  value.connectionError = '标定连接已断开，正在重连…';
  const html = renderToStaticMarkup(
    createElement(PhonePairStep, {
      controller: value,
      footer: null,
      onContinue() {},
    }),
  );
  expect(html).toContain('标定连接已断开');
});

it('offers AI screen detection without a phone and keeps stale command errors out', () => {
  const html = renderToStaticMarkup(
    createElement(WebCameraMappingStep, {
      controller: controller(false),
      footer: null,
      onPair() {},
      onContinue() {},
      onDetectAI: async () => {},
    }),
  );
  expect(html).toContain('使用 AI 检测');
  expect(html).toContain('尚未连接手机网页');
  expect(html).not.toContain('Calibration marker');
});

it('offers automatic collection before recording the safe position', () => {
  const value = controller();
  value.session = {
    id: 'retry',
    stage: 'ready',
    phoneConnected: true,
    referencePosition: {
      frame: 'base',
      positionMm: { x: 0, y: 0, z: 50 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    points: [],
    verification: [],
    samples: 0,
  } as unknown as NonNullable<AssistedCalibrationController['session']>;
  const html = renderToStaticMarkup(
    createElement(WebCalibrationWorkspace, {
      controller: value,
      footer: null,
      readyToStart: true,
      readyToCapture: true,
      readyToVerify: true,
      onActivated: async () => {},
      onBeforeLeaveChange: () => {},
      onCheckCamera: () => {},
    }),
  );
  expect(html).toContain('标准探测');
  expect(html).toContain('自动执行悬停与接触边界验证');
  expect(html).not.toContain('Record Safe Position');
  expect(html).not.toContain('15 点');
});

it('explains the phone requirement without blocking reference-position recording', () => {
  const value = controller(false);
  value.session = {
    id: 'offline',
    stage: 'ready',
    phoneConnected: false,
    safePosition: {
      frame: 'base',
      positionMm: { x: 0, y: 0, z: 50 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    points: [],
    verification: [],
    samples: 0,
  } as unknown as NonNullable<AssistedCalibrationController['session']>;
  const html = renderToStaticMarkup(
    createElement(WebCalibrationWorkspace, {
      controller: value,
      footer: null,
      onActivated: async () => {},
      onBeforeLeaveChange: () => {},
      onConnectPhone: () => {},
    }),
  );
  expect(html).toContain('设置标定参考位');
  expect(html).toContain('进入拖动模式');
  expect(html).toContain('手机连接已断开');
  expect(html).toContain('连接手机');
});
