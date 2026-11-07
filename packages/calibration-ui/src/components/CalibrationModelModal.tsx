import { Alert, Button, Form, Input, Modal, Switch, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { t, useCalibrationLanguage } from '../i18n';
import type {
  CalibrationModelConfig,
  CalibrationServerModel,
} from '../model-settings';
import { parseModelEnvironment } from '../utils/modelEnv';

export interface CalibrationModelModalProps {
  open: boolean;
  title?: string;
  description?: string;
  serverModel?: CalibrationServerModel;
  value: CalibrationModelConfig;
  custom: boolean;
  onApply: (config: CalibrationModelConfig, custom: boolean) => void;
  /** Forget the stored custom model and fall back to the service default. */
  onClear: () => void;
  onClose: () => void;
  persistenceNotice?: string;
  error?: string;
}

/**
 * Model settings for the playgrounds. The service's `MIDSCENE_ROBOT_CALIBRATION_MODEL_*`
 * configuration is the default; a custom model is remembered in this browser
 * only and is never written to a camera or robot profile.
 */
export function CalibrationModelModal({
  open,
  title,
  description,
  serverModel,
  value,
  custom,
  onApply,
  onClear,
  onClose,
  persistenceNotice,
  error,
}: CalibrationModelModalProps) {
  useCalibrationLanguage();
  const [useCustom, setUseCustom] = useState(custom);
  const [config, setConfig] = useState<CalibrationModelConfig>(value);
  const [pasteStatus, setPasteStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUseCustom(custom);
    setConfig(value);
    setPasteStatus(null);
  }, [open, custom, value]);

  const complete = Boolean(
    config.modelName.trim() && config.modelFamily.trim(),
  );

  return (
    <Modal
      style={{ top: 24 }}
      styles={{
        body: { maxHeight: 'calc(100dvh - 180px)', overflowY: 'auto' },
      }}
      className="robot-dialog"
      okButtonProps={{
        disabled: useCustom ? !complete : !serverModel?.modelName,
      }}
      okText={t('Use This Model')}
      onCancel={onClose}
      onOk={() => onApply(config, useCustom)}
      open={open}
      title={title ?? t('Model Settings')}
    >
      {description && (
        <Typography.Paragraph>{description}</Typography.Paragraph>
      )}
      {error && <Alert type="error" showIcon message={error} />}
      <Form layout="vertical">
        <Form.Item
          extra={
            useCustom
              ? (persistenceNotice ??
                t(
                  'Kept for this page session only; never written to a camera or robot profile.',
                ))
              : undefined
          }
          label={t('Use Custom Model')}
        >
          <Switch
            aria-label={t('Use Custom Model')}
            checked={useCustom}
            onChange={setUseCustom}
          />
        </Form.Item>
        {useCustom ? (
          <>
            <Form.Item
              extra={t(
                'Paste a MIDSCENE_ROBOT_CALIBRATION_MODEL_* block here. Matching variables fill the fields below; OPENAI_API_KEY and OPENAI_BASE_URL are also supported.',
              )}
              label={t('Paste Model Environment Variables')}
            >
              <Input.TextArea
                aria-label={t('Paste Model Environment Variables')}
                autoSize={{ minRows: 3, maxRows: 5 }}
                readOnly
                onPaste={(event) => {
                  event.preventDefault();
                  const parsed = parseModelEnvironment(
                    event.clipboardData.getData('text'),
                  );
                  const count = Object.keys(parsed).length;
                  if (count === 0) {
                    setPasteStatus(t('No supported model variables found.'));
                    return;
                  }
                  setConfig({ ...config, ...parsed });
                  setPasteStatus(t('Filled {0} model settings.', [count]));
                }}
                placeholder={
                  'MIDSCENE_ROBOT_CALIBRATION_MODEL_NAME=...\nMIDSCENE_ROBOT_CALIBRATION_MODEL_FAMILY=...\nMIDSCENE_ROBOT_CALIBRATION_MODEL_BASE_URL=...\nMIDSCENE_ROBOT_CALIBRATION_MODEL_API_KEY=...'
                }
                value=""
              />
            </Form.Item>
            {pasteStatus ? (
              <Typography.Text type="secondary">{pasteStatus}</Typography.Text>
            ) : null}
            <Form.Item label={t('Model Name')}>
              <Input
                aria-label={t('Model Name')}
                onChange={(event) =>
                  setConfig({ ...config, modelName: event.target.value })
                }
                placeholder={t('Model Name')}
                value={config.modelName}
              />
            </Form.Item>
            <Form.Item label={t('Model Family')}>
              <Input
                aria-label={t('Model Family')}
                onChange={(event) =>
                  setConfig({ ...config, modelFamily: event.target.value })
                }
                placeholder={t('Model family, e.g. qwen3.6')}
                value={config.modelFamily}
              />
            </Form.Item>
            <Form.Item label={t('Base URL')}>
              <Input
                aria-label={t('Model Base URL')}
                onChange={(event) =>
                  setConfig({ ...config, baseUrl: event.target.value })
                }
                placeholder={t('OpenAI compatible base URL')}
                value={config.baseUrl}
              />
            </Form.Item>
            <Form.Item label={t('API Key')}>
              <Input.Password
                aria-label={t('Model API Key')}
                autoComplete="off"
                onChange={(event) =>
                  setConfig({ ...config, apiKey: event.target.value })
                }
                placeholder={t('API Key')}
                value={config.apiKey}
              />
            </Form.Item>
          </>
        ) : serverModel?.modelName ? (
          <Alert
            message={t('Server model: {0}{1}', [
              serverModel.modelName,
              serverModel.modelFamily ? ` · ${serverModel.modelFamily}` : '',
            ])}
            description={
              serverModel.hasApiKey
                ? t('An API Key is configured on the service.')
                : t(
                    'No API Key on the service; set MIDSCENE_ROBOT_CALIBRATION_MODEL_API_KEY or use a custom model.',
                  )
            }
            showIcon
            type={serverModel.hasApiKey ? 'info' : 'warning'}
          />
        ) : (
          <Typography.Text type="secondary">
            {t(
              'The service has no MIDSCENE_ROBOT_CALIBRATION_MODEL_* configuration. Set it on the calibration host, or switch on a custom model for this session.',
            )}
          </Typography.Text>
        )}
        <Form.Item>
          <Button danger onClick={onClear} type="link">
            {t('Clear Model Settings')}
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}
