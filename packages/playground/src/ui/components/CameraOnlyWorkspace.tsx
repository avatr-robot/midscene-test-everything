import type { CameraCorrection } from '@midscene/arm-kit-shared/contracts';
import { Alert, Button, Empty, Spin, Tag, Tooltip, Typography } from 'antd';
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cameraPreviewUrl } from '../camera-preview';
import { type CameraEntry, cameraStateLabel, useCameras } from '../cameras';
import { useT } from '../i18n';
import { CameraRail } from './CameraRail';
import { CameraStagePreview } from './CameraStagePreview';
import { RobotConnectionDialog } from './RobotConnectionDialog';
import { RobotReadinessCard } from './RobotReadinessCard';
import { ScreenMarkerPreview } from './ScreenMarkerPreview';
import { WorkspaceLayout } from './WorkspaceLayout';
import './CameraStage.less';

export function CameraOnlyWorkspace() {
  const t = useT();
  const { cameras, selectedId, status, select, refresh, error } = useCameras();
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [outline, setOutline] = useState<{
    id: string;
    correction: CameraCorrection;
  }>();
  const [revision, setRevision] = useState(0);
  const [failedUrl, setFailedUrl] = useState<string>();
  const [frame, setFrame] = useState<{
    url: string;
    width: number;
    height: number;
  }>();
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const selected = cameras.find((camera) => camera.id === selectedId);
  const url =
    selected && `${cameraPreviewUrl(selected.id)}&revision=${revision}`;
  // Before robot connection, the preview opens its stream on demand. Use the
  // displayed frame as evidence when no stream metadata is available yet.
  const displayed = frame?.url === url ? frame : undefined;
  const camera: CameraEntry | undefined = selected && {
    ...selected,
    stream: {
      ...selected.stream,
      state:
        failedUrl === url
          ? 'failed'
          : displayed
            ? 'running'
            : (selected.stream?.state ?? 'starting'),
      width: displayed?.width ?? selected.stream?.width ?? 0,
      height: displayed?.height ?? selected.stream?.height ?? 0,
      hasFrame: Boolean(displayed || selected.stream?.hasFrame),
    },
  };
  const previewFailed = Boolean(url && failedUrl === url);
  return (
    <>
      <WorkspaceLayout
        sidebar={
          <RobotReadinessCard
            camera={camera}
            connected={false}
            onOpenSetup={() => setConnectionOpen(true)}
          />
        }
      >
        <section className="camera-stage">
          <header className="camera-stage-header">
            <div className="camera-stage-title">
              <Typography.Title level={4} style={{ margin: 0 }}>
                {camera?.name ?? t('cameras')}
              </Typography.Title>
              {camera && (
                <div className="camera-stage-meta">
                  <Tag
                    color={
                      camera.stream?.state === 'running' ? 'green' : undefined
                    }
                  >
                    {t(cameraStateLabel(camera))}
                  </Tag>
                  {Boolean(camera.stream?.width && camera.stream?.height) && (
                    <Typography.Text type="secondary">
                      {camera.stream!.width} × {camera.stream!.height}
                    </Typography.Text>
                  )}
                </div>
              )}
            </div>
            <div className="camera-stage-actions">
              {selected && (
                <ScreenMarkerPreview
                  key={selected.id}
                  id={selected.id}
                  name={selected.name}
                  onDetected={(correction) =>
                    setOutline({ id: selected.id, correction })
                  }
                />
              )}
              <Tooltip title={t('refresh')}>
                <Button
                  type="text"
                  aria-label={t('refresh')}
                  icon={<RefreshCw size={16} />}
                  loading={status === 'loading'}
                  onClick={() => {
                    setRevision((r) => r + 1);
                    void refresh();
                  }}
                />
              </Tooltip>
            </div>
          </header>
          {error && <Alert type="error" showIcon message={error} />}
          <CameraStagePreview
            available={Boolean(url && !previewFailed)}
            outline={
              outline?.id === selected?.id ? outline?.correction : undefined
            }
          >
            {url && camera ? (
              previewFailed ? (
                <Empty description={t('rawPreviewFailed')} />
              ) : (
                <img
                  key={url}
                  src={url}
                  className="stream-preview"
                  alt={camera.name}
                  onError={() => setFailedUrl(url)}
                  onLoad={(event) => {
                    const { naturalWidth: width, naturalHeight: height } =
                      event.currentTarget;
                    if (width && height)
                      setFrame((previous) =>
                        previous?.url === url &&
                        previous.width === width &&
                        previous.height === height
                          ? previous
                          : { url, width, height },
                      );
                  }}
                />
              )
            ) : status === 'loading' ? (
              <Spin aria-label={t('loadingCameras')} />
            ) : (
              <Empty description={t('noCameras')} />
            )}
          </CameraStagePreview>
          {cameras.length > 0 && (
            <CameraRail
              entries={cameras.map((entry) =>
                camera && entry.id === camera.id ? camera : entry,
              )}
              selectedId={selectedId}
              selectedPreviewUrl={url}
              onSelect={select}
            />
          )}
        </section>
      </WorkspaceLayout>
      <RobotConnectionDialog
        open={connectionOpen}
        onClose={() => setConnectionOpen(false)}
      />
    </>
  );
}
