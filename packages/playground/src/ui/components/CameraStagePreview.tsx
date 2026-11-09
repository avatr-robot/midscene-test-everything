import { Button } from 'antd';
import { Maximize, Minimize } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../i18n';

/** Keep the current stream attached while the operator inspects it full screen. */
export function CameraStagePreview({
  children,
  available = true,
}: { children: ReactNode; available?: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  const [native, setNative] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const changed = () =>
      setNative(
        Boolean(frame.current && document.fullscreenElement === frame.current),
      );
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [expanded]);
  const zh = useLanguage() === 'zh';
  const full = native || expanded;
  const label = full
    ? zh
      ? '退出全屏'
      : 'Exit full screen'
    : zh
      ? '全屏预览'
      : 'Full-screen preview';
  const toggle = async () => {
    if (native) await document.exitFullscreen();
    else if (expanded) setExpanded(false);
    else if (frame.current?.requestFullscreen) {
      try {
        await frame.current.requestFullscreen();
      } catch {
        setExpanded(true);
      }
    } else setExpanded(true);
  };
  return (
    <div
      ref={frame}
      className={`camera-stage-preview${expanded ? ' is-expanded' : ''}`}
    >
      {children}
      {(available || full) && (
        <Button
          className="camera-fullscreen"
          size="small"
          aria-label={label}
          title={label}
          icon={full ? <Minimize size={16} /> : <Maximize size={16} />}
          onClick={() => void toggle()}
        />
      )}
    </div>
  );
}
