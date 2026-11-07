import {
  computeHomography,
  destinationCorners,
  quadToArray,
  validateQuad,
} from '@midscene/arm-kit-shared/camera/vision-geometry';
import type { CameraCorrection } from '@midscene/arm-kit-shared/contracts';
import { useLayoutEffect, useRef, useState } from 'react';
import { t } from './i18n';

export function CorrectedPreview({
  correction,
  size,
  src,
}: {
  correction: CameraCorrection;
  size: { width: number; height: number };
  src: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const { width, height } = size;
  useLayoutEffect(() => {
    const element = viewport.current!;
    const observer = new ResizeObserver(([entry]) => {
      setScale(
        Math.min(
          entry.contentRect.width / width,
          entry.contentRect.height / height,
        ),
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [width, height]);

  let transform: string | undefined;
  try {
    validateQuad(correction.points);
    const [a, b, c, d, e, f, g, h, i] = computeHomography(
      quadToArray(correction.points),
      destinationCorners(width, height, correction.rotation ?? 0),
    );
    // CSS uses a column-major 4×4 matrix for the same planar projection.
    transform = `matrix3d(${[a, d, 0, g, b, e, 0, h, 0, 0, 1, 0, c, f, 0, i].join(',')})`;
  } catch {
    // While dragging, the four corners can temporarily cross.
  }
  return (
    <div className="range-output" ref={viewport}>
      {transform ? (
        <div
          style={{
            width,
            height,
            transform: `translate(-50%, -50%) scale(${scale})`,
          }}
        >
          <img
            alt={t('Corrected View')}
            draggable={false}
            src={src}
            style={{
              width: correction.sourceWidth,
              height: correction.sourceHeight,
              transform,
              transformOrigin: '0 0',
              maxWidth: 'none',
            }}
          />
        </div>
      ) : (
        t('Adjust the four corners')
      )}
    </div>
  );
}
