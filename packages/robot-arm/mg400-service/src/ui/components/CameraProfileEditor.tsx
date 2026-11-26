import {
  Alert,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
} from 'antd';
import { useEffect, useState } from 'react';
import {
  CAMERA_LABEL_OPTIONS,
  type CameraCaptureSettings,
  type CameraEntry,
  type CameraLabel,
  type CameraProfileUpdate,
  FLIP_OPTIONS,
  FPS_RANGE,
  type FlipMode,
  HEIGHT_RANGE,
  WIDTH_RANGE,
  captureFrameRates,
  captureResolutionKey,
  captureResolutions,
  flipFlagsOf,
  flipModeOf,
  resolveSupportedCaptureSettings,
} from '../cameras';
import { t, useLanguage } from '../i18n';
import { DepthSdkControls } from './DepthSdkControls';

interface FormValues {
  name: string;
  label: CameraLabel | '';
  width: number;
  height: number;
  fps: number;
  flip: FlipMode;
  depthControls: Record<string, number>;
}

export function CameraProfileEditor({
  camera,
  error,
  fallbackSettings,
  saving,
  onCancel,
  onSave,
}: {
  camera: CameraEntry | null;
  error?: string;
  fallbackSettings: CameraCaptureSettings;
  saving: boolean;
  onCancel: () => void;
  onSave: (update: CameraProfileUpdate) => void;
}) {
  const language = useLanguage();
  const [values, setValues] = useState<FormValues | null>(null);
  const cameraId = camera?.id;

  useEffect(() => {
    if (!camera) {
      setValues(null);
      return;
    }
    const current = camera.stream
      ? {
          width: camera.stream.width,
          height: camera.stream.height,
          fps:
            camera.stream.fps ??
            camera.captureSettings?.fps ??
            camera.captureModes?.[0]?.fps ??
            fallbackSettings.fps,
        }
      : (camera.captureSettings ??
        camera.captureModes?.[0] ??
        fallbackSettings);
    const settings = resolveSupportedCaptureSettings(
      current,
      camera.captureModes,
    );
    setValues({
      name: camera.name,
      label: camera.label ?? '',
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
      flip: flipModeOf(camera),
      depthControls: Object.fromEntries(
        (camera.controls ?? []).map((control) => [
          control.key,
          camera.depthControls?.[control.key] ?? control.value,
        ]),
      ),
    });
  }, [cameraId]);

  const update = (patch: Partial<FormValues>) => {
    setValues((current) => (current ? { ...current, ...patch } : current));
  };
  const resolutions = captureResolutions(camera?.captureModes);
  const frameRates = values
    ? captureFrameRates(camera?.captureModes, values)
    : [];

  return (
    <Modal
      centered
      className="robot-dialog"
      destroyOnClose
      okButtonProps={{
        disabled: !values || values.name.trim() === '',
        loading: saving,
      }}
      okText={t('Save')}
      onCancel={onCancel}
      onOk={() => {
        if (!values) return;
        onSave({
          name: values.name.trim(),
          label: values.label === '' ? null : values.label,
          width: values.width,
          height: values.height,
          fps: values.fps,
          ...(camera?.controls?.length
            ? { depthControls: values.depthControls }
            : {}),
          ...flipFlagsOf(values.flip),
        });
      }}
      open={Boolean(camera)}
      title={
        camera ? (
          <Space size={8}>
            <span>
              {t('Camera Profile · {0}', [
                camera.deviceName ?? camera.name ?? camera.id,
              ])}
            </span>
            <Tag color={camera.profileKey ? 'blue' : undefined}>
              {camera.kind === 'depth'
                ? t('Depth map')
                : camera.profileKey
                  ? t('Perspective corrected')
                  : t('Preview only')}
            </Tag>
          </Space>
        ) : null
      }
      width={560}
    >
      {values ? (
        <Form layout="vertical">
          {error && (
            <Alert
              showIcon
              type="error"
              message={
                language === 'zh'
                  ? '相机配置保存失败'
                  : 'Could not save camera profile'
              }
              description={error}
              style={{ marginBottom: 16 }}
            />
          )}
          <Form.Item
            label={t('Camera Name')}
            extra={t(
              'Unique camera name, for example main-display or left-tablet.',
            )}
          >
            <Input
              aria-label={t('Camera Display Name')}
              maxLength={120}
              onChange={(event) => update({ name: event.target.value })}
              value={values.name}
            />
          </Form.Item>
          <Form.Item label={t('Label')}>
            <Select
              popupClassName="robot-select-menu"
              aria-label={t('Camera Label')}
              onChange={(label) => update({ label })}
              options={[
                { value: '', label: t('No Label') },
                ...CAMERA_LABEL_OPTIONS.map((option) => ({
                  ...option,
                  label: t(option.value === 'back' ? 'Rear' : option.label),
                })),
              ]}
              value={values.label}
            />
          </Form.Item>
          <Form.Item
            extra={
              language === 'zh'
                ? '仅列出当前相机实际支持的采集模式，保存后会立即重启正在运行的相机。'
                : 'Saving restarts the running camera immediately.'
            }
            label={t('Capture Settings')}
          >
            <div
              className={`robot-capture-fields${
                resolutions.length ? '' : ' is-manual'
              }`}
            >
              {resolutions.length ? (
                <>
                  <div className="robot-capture-field">
                    <span className="robot-capture-field-label">
                      {t('Capture Resolution')}
                    </span>
                    <Select
                      aria-label={t('Capture Resolution')}
                      onChange={(key) => {
                        const resolution = resolutions.find(
                          (candidate) => candidate.key === key,
                        );
                        if (!resolution) return;
                        const availableFrameRates = captureFrameRates(
                          camera?.captureModes,
                          resolution,
                        );
                        update({
                          width: resolution.width,
                          height: resolution.height,
                          fps: availableFrameRates.includes(values.fps)
                            ? values.fps
                            : (availableFrameRates[0] ?? values.fps),
                        });
                      }}
                      options={resolutions.map((resolution) => ({
                        label: `${resolution.width} × ${resolution.height}`,
                        value: resolution.key,
                      }))}
                      popupClassName="robot-select-menu"
                      value={captureResolutionKey(values)}
                    />
                  </div>
                  <div className="robot-capture-field">
                    <span className="robot-capture-field-label">
                      {t('Capture Frame Rate')}
                    </span>
                    <Select
                      aria-label={t('Capture Frame Rate')}
                      onChange={(fps) => update({ fps })}
                      options={frameRates.map((fps) => ({
                        label: `${fps} FPS`,
                        value: fps,
                      }))}
                      popupClassName="robot-select-menu"
                      value={values.fps}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="robot-capture-field">
                    <span className="robot-capture-field-label">
                      {t('Capture Width')}
                    </span>
                    <InputNumber
                      addonAfter="px"
                      aria-label={t('Capture Width')}
                      max={WIDTH_RANGE.max}
                      min={WIDTH_RANGE.min}
                      onChange={(width) =>
                        update({ width: width ?? fallbackSettings.width })
                      }
                      value={values.width}
                    />
                  </div>
                  <div className="robot-capture-field">
                    <span className="robot-capture-field-label">
                      {t('Capture Height')}
                    </span>
                    <InputNumber
                      addonAfter="px"
                      aria-label={t('Capture Height')}
                      max={HEIGHT_RANGE.max}
                      min={HEIGHT_RANGE.min}
                      onChange={(height) =>
                        update({ height: height ?? fallbackSettings.height })
                      }
                      value={values.height}
                    />
                  </div>
                  <div className="robot-capture-field">
                    <span className="robot-capture-field-label">
                      {t('Capture Frame Rate')}
                    </span>
                    <InputNumber
                      addonAfter="fps"
                      aria-label={t('Capture Frame Rate')}
                      max={FPS_RANGE.max}
                      min={FPS_RANGE.min}
                      onChange={(fps) =>
                        update({ fps: fps ?? fallbackSettings.fps })
                      }
                      value={values.fps}
                    />
                  </div>
                </>
              )}
            </div>
          </Form.Item>
          <Form.Item
            extra={t(
              'Mirrors the picture in the capture itself, so marker calibration and perspective correction see the same orientation the operator does. A running stream is updated immediately.',
            )}
            label={t('Flip')}
          >
            <Select
              popupClassName="robot-select-menu"
              aria-label={t('Camera Flip')}
              onChange={(flip: FlipMode) => update({ flip })}
              options={FLIP_OPTIONS.map((option) => ({
                ...option,
                label: t(option.label),
              }))}
              value={values.flip}
            />
          </Form.Item>
          {camera?.kind === 'depth' && camera.controls?.length ? (
            <DepthSdkControls
              controls={camera.controls}
              onChange={(key, value) =>
                update({
                  depthControls: {
                    ...values.depthControls,
                    [key]: value,
                  },
                })
              }
              values={values.depthControls}
            />
          ) : null}
        </Form>
      ) : null}
    </Modal>
  );
}
