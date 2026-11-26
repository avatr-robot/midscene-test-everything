import {
  Alert,
  App,
  AutoComplete,
  Button,
  Form,
  Input,
  Modal,
  Space,
  Typography,
} from 'antd';
import { ScanEye } from 'lucide-react';
import { useState } from 'react';
import { t, useLanguage } from '../../i18n';
import {
  EMPTY_VLM_MODEL_SETTINGS,
  VLM_PROVIDER_PRESETS,
  type VlmModelSettings as VlmModelSettingsValue,
  applyVlmProviderSelection,
  clearVlmModelSettings,
  findVlmModelPreset,
  findVlmProviderPreset,
  isVlmModelSettingsComplete,
  loadVlmModelSettings,
  saveVlmModelSettings,
} from './vlm-model-settings';

export function VlmModelSettings() {
  useLanguage();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<VlmModelSettingsValue>(
    () => loadVlmModelSettings() ?? EMPTY_VLM_MODEL_SETTINGS,
  );
  const [error, setError] = useState<string>();
  const complete = isVlmModelSettingsComplete(value);

  const openDialog = () => {
    setValue(loadVlmModelSettings() ?? EMPTY_VLM_MODEL_SETTINGS);
    setError(undefined);
    setOpen(true);
  };
  const update = (field: keyof VlmModelSettingsValue, next: string) => {
    setValue((current) => ({ ...current, [field]: next }));
    setError(undefined);
  };
  const providerPreset = findVlmProviderPreset(value.provider);
  const providerOptions = VLM_PROVIDER_PRESETS.map((provider) => ({
    value: provider.name,
    label: provider.label,
  }));
  const modelOptions = (providerPreset?.models ?? []).map((model) => ({
    value: model.name,
    label: `${model.label} · ${model.name}`,
  }));
  const selectProvider = (provider?: string) => {
    setValue((current) => applyVlmProviderSelection(current, provider));
    setError(undefined);
  };
  const selectModel = (modelName: string) => {
    const model = findVlmModelPreset(value.provider, modelName);
    setValue((current) => ({
      ...current,
      modelName,
      modelFamily: model?.family ?? current.modelFamily,
      baseUrl: model
        ? (providerPreset?.baseUrl ?? current.baseUrl)
        : current.baseUrl,
    }));
    setError(undefined);
  };
  const save = () => {
    try {
      saveVlmModelSettings(value);
      message.success(t('Model configuration saved'));
      setOpen(false);
    } catch {
      setError(t('Unable to save model settings in this browser.'));
    }
  };

  return (
    <>
      <Button
        type="text"
        aria-label={t('Model configuration')}
        title={t('Model configuration')}
        icon={<ScanEye size={16} />}
        onClick={openDialog}
      >
        {t('Model configuration')}
      </Button>
      <Modal
        centered
        className="robot-dialog vlm-model-settings-dialog"
        open={open}
        title={
          <Space>
            <ScanEye size={18} />
            {t('Model configuration')}
          </Space>
        }
        onCancel={() => setOpen(false)}
        footer={[
          <Button
            key="clear"
            type="text"
            danger
            onClick={() => {
              try {
                clearVlmModelSettings();
                setValue(EMPTY_VLM_MODEL_SETTINGS);
                setError(undefined);
                message.success(t('Stored model settings cleared'));
              } catch {
                setError(
                  t('Unable to clear saved model settings in this browser.'),
                );
              }
            }}
          >
            {t('Clear Stored Model Settings')}
          </Button>,
          <Button key="cancel" onClick={() => setOpen(false)}>
            {t('Cancel')}
          </Button>,
          <Button key="save" type="primary" disabled={!complete} onClick={save}>
            {t('Save')}
          </Button>,
        ]}
      >
        <Form layout="vertical">
          <Form.Item label={t('Provider')}>
            <AutoComplete
              allowClear
              aria-label={t('Provider')}
              filterOption={(input, option) =>
                String(option?.value ?? '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              onChange={selectProvider}
              options={providerOptions}
              placeholder={t('Select a provider')}
              value={value.provider}
            />
          </Form.Item>
          <Form.Item label={t('Model Name')} required>
            <AutoComplete
              allowClear
              aria-label={t('Model Name')}
              filterOption={(input, option) =>
                String(option?.value ?? '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              value={value.modelName}
              onChange={(modelName) => update('modelName', modelName ?? '')}
              onSelect={selectModel}
              options={modelOptions}
              placeholder={t('Select or enter a model name')}
            />
          </Form.Item>
          <Form.Item label={t('Model Family')} required>
            <Input
              allowClear
              aria-label={t('Model Family')}
              value={value.modelFamily}
              onChange={(event) => update('modelFamily', event.target.value)}
              placeholder={t('Model family, e.g. qwen3.6')}
            />
          </Form.Item>
          <Form.Item label={t('Base URL')} required>
            <Input
              allowClear
              aria-label={t('Model Base URL')}
              type="url"
              value={value.baseUrl}
              onChange={(event) => update('baseUrl', event.target.value)}
              placeholder={t('OpenAI compatible base URL')}
            />
          </Form.Item>
          <Form.Item label={t('API Key')} required>
            <Input.Password
              aria-label={t('Model API Key')}
              autoComplete="off"
              value={value.apiKey}
              onChange={(event) => update('apiKey', event.target.value)}
              placeholder={t('API Key')}
            />
          </Form.Item>
        </Form>
        {error && <Alert type="error" showIcon message={error} />}
        <Typography.Paragraph
          className="vlm-model-settings-note"
          type="secondary"
        >
          {t(
            'Model presets fill the family and base URL only. You can clear any field and enter it manually. Settings and the API key stay in this browser.',
          )}
        </Typography.Paragraph>
      </Modal>
    </>
  );
}
