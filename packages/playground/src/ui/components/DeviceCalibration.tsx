import {
  CalibrationWorkspace,
  useCalibrationLanguage,
} from '@midscene/arm-calibration-ui';
import { Alert, Button, Spin } from 'antd';
import { useEffect, useState } from 'react';
import { usePreferences } from '../i18n';

export function DeviceCalibration({
  id,
  onClose,
}: { id: string; onClose(): void }) {
  const base = `/api/devices/${encodeURIComponent(id)}/calibration`;
  const language = usePreferences((state) => state.language);
  const [phase, setPhase] = useState('queued');
  const [error, setError] = useState<string>();
  const [closing, setClosing] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (finishing && phase === 'completed') onClose();
  }, [finishing, phase, onClose]);
  useEffect(() => {
    useCalibrationLanguage.getState().setLanguage(language);
  }, [language]);
  useEffect(() => {
    setPhase('queued');
    setError(undefined);
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async (start = false) => {
      try {
        const response = await fetch(`${base}/${start ? 'start' : 'status'}`, {
          method: start ? 'POST' : 'GET',
        });
        const state = await response.json();
        if (!response.ok) throw new Error(state.error);
        if (disposed) return;
        setPhase(state.phase);
        setError(state.error);
        if (['queued', 'running'].includes(state.phase))
          timer = setTimeout(() => void read(), 1000);
      } catch (error) {
        if (!disposed) {
          setError(String(error));
          setPhase('error');
        }
      }
    };
    void read(true);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [base, attempt]);
  const close = async () => {
    setClosing(true);
    try {
      const response = await fetch(`${base}/cancel`, { method: 'POST' });
      if (!response.ok) throw new Error((await response.json()).error);
      onClose();
    } catch (error) {
      setError(String(error));
    } finally {
      setClosing(false);
    }
  };
  const cancelAction = phase !== 'completed' && (
    <Button
      loading={closing}
      onClick={() => (phase === 'cancelled' ? onClose() : void close())}
    >
      {language === 'zh' ? '取消标定' : 'Cancel calibration'}
    </Button>
  );
  const showWorkspace = ['running', 'completed'].includes(phase);
  return (
    <div className="calibration-flow">
      {!showWorkspace && (
        <div className="calibration-pending-actions">{cancelAction}</div>
      )}
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            <Button onClick={() => setAttempt((v) => v + 1)}>
              {language === 'zh' ? '重试' : 'Retry'}
            </Button>
          }
        />
      )}
      {phase === 'queued' ? (
        <Spin
          tip={language === 'zh' ? '等待机械臂可用' : 'Waiting for the arm'}
        >
          <div style={{ minHeight: 120 }} />
        </Spin>
      ) : (
        showWorkspace && (
          <CalibrationWorkspace
            key={id}
            embedded
            cancelAction={cancelAction}
            baseUrl={base}
            onComplete={() => setFinishing(true)}
          />
        )
      )}
    </div>
  );
}
