import { Alert, Button, Empty, Select, Spin } from 'antd';
import { Cable, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCameras } from '../cameras';
import { useT } from '../i18n';

export function CameraOnlyWorkspace({ onConnect }: { onConnect(): void }) {
  const t = useT();
  const { cameras, selectedId, status, select, refresh, error } = useCameras();
  const [revision, setRevision] = useState(0);
  const [failedUrl, setFailedUrl] = useState<string>();
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const selected = cameras.find((camera) => camera.id === selectedId);
  const url =
    selected &&
    `/api/cameras/preview?id=${encodeURIComponent(selected.id)}&view=raw&revision=${revision}`;
  return (
    <main className="streams-section">
      <div className="camera-stage">
        <header className="camera-stage-header">
          <div className="camera-stage-title">
            <h2>{t('cameras')}</h2>
            {selected && (
              <Select
                aria-label={t('cameras')}
                value={selected.id}
                onChange={select}
                options={cameras.map(({ id, name }) => ({
                  value: id,
                  label: name,
                }))}
              />
            )}
          </div>
          <div className="camera-stage-actions">
            <Button
              icon={<RefreshCw size={16} />}
              loading={status === 'loading'}
              onClick={() => {
                setRevision((r) => r + 1);
                void refresh();
              }}
            >
              {t('refresh')}
            </Button>
            <Button icon={<Cable size={16} />} onClick={onConnect}>
              {t('connect')}
            </Button>
          </div>
        </header>
        {error && <Alert type="error" showIcon message={error} />}
        {url && selected ? (
          failedUrl === url ? (
            <Alert type="warning" showIcon message={t('rawPreviewFailed')} />
          ) : (
            <div className="camera-stage-preview">
              <img
                key={url}
                src={url}
                className="stream-preview"
                alt={selected.name}
                onError={() => setFailedUrl(url)}
              />
            </div>
          )
        ) : status === 'loading' ? (
          <Spin />
        ) : (
          <Empty description={t('noCameras')} />
        )}
      </div>
    </main>
  );
}
