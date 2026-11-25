import { useLayoutEffect, useRef, useState } from 'react';
import type { DepthProbeView } from '../hooks/useDepthProbe';
import { useLanguage } from '../i18n';
import { placeDepthProbe } from '../utils/depth-probe';

export function DepthProbeOverlay({
  sample,
}: {
  sample: DepthProbeView | undefined;
}) {
  const zh = useLanguage() === 'zh';
  const ref = useRef<HTMLOutputElement>(null);
  const [position, setPosition] = useState({
    left: sample?.displayX ?? 0,
    top: sample?.displayY ?? 0,
  });

  useLayoutEffect(() => {
    const probe = ref.current;
    const container = probe?.parentElement;
    if (!sample || !probe || !container) return;
    const update = () => {
      const next = placeDepthProbe({
        pointerX: sample.displayX,
        pointerY: sample.displayY,
        containerWidth: container.clientWidth,
        containerHeight: container.clientHeight,
        probeWidth: probe.offsetWidth,
        probeHeight: probe.offsetHeight,
      });
      setPosition((current) =>
        current.left === next.left && current.top === next.top ? current : next,
      );
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [
    sample?.depthMeters,
    sample?.displayX,
    sample?.displayY,
    sample?.error,
    sample?.loading,
  ]);

  if (!sample) return null;
  const text = sample.loading
    ? zh
      ? '正在读取深度…'
      : 'Reading depth…'
    : sample.error
      ? zh
        ? '深度不可用'
        : 'Depth unavailable'
      : sample.depthMeters === null || sample.depthMeters === undefined
        ? zh
          ? '该点没有有效深度'
          : 'No depth at this point'
        : `${sample.depthMeters.toFixed(3)} m`;
  return (
    <output
      aria-live="polite"
      className="depth-probe"
      ref={ref}
      style={position}
    >
      <span className="depth-probe-coordinate">
        {sample.x}, {sample.y}
      </span>
      <span>{text}</span>
    </output>
  );
}
