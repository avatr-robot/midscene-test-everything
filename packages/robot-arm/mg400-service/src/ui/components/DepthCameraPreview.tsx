import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
} from 'react';
import type { PreviewImagePoint } from '../hooks/useDepthProbe';

export function DepthCameraPreview({
  alt,
  src,
  overlaySrc,
  overlayOpacity,
  depthWidth,
  depthHeight,
  imageRef,
  onLoad,
  onError,
  onPointerSample,
}: {
  alt: string;
  src: string;
  overlaySrc?: string;
  overlayOpacity?: number;
  depthWidth?: number;
  depthHeight?: number;
  imageRef?: (node: HTMLImageElement | null) => void;
  onLoad?: (image: HTMLImageElement) => void;
  onError?: () => void;
  onPointerSample: (point: PreviewImagePoint | undefined) => void;
}) {
  const ref = useRef<HTMLImageElement | null>(null);
  const overlayRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const image = ref.current;
    if (!image) return;
    image.src = src;
    return () => {
      image.src = '';
    };
  }, [src]);

  useEffect(() => {
    const image = overlayRef.current;
    if (!image) return;
    image.src = overlaySrc ?? '';
    return () => {
      image.src = '';
    };
  }, [overlaySrc]);

  const sample = (
    event: ReactPointerEvent<HTMLImageElement>,
  ): PreviewImagePoint | undefined => {
    const image = ref.current;
    if (!image) return undefined;
    const imageWidth = depthWidth ?? image.naturalWidth;
    const imageHeight = depthHeight ?? image.naturalHeight;
    const rect = image.getBoundingClientRect();
    if (
      imageWidth <= 0 ||
      imageHeight <= 0 ||
      rect.width <= 0 ||
      rect.height <= 0
    )
      return undefined;
    const scale = Math.min(rect.width / imageWidth, rect.height / imageHeight);
    const offsetX = (rect.width - imageWidth * scale) / 2;
    const offsetY = (rect.height - imageHeight * scale) / 2;
    const displayX = event.clientX - rect.left;
    const displayY = event.clientY - rect.top;
    const x = (displayX - offsetX) / scale;
    const y = (displayY - offsetY) / scale;
    if (x < 0 || y < 0 || x >= imageWidth || y >= imageHeight) return undefined;
    return { x, y, displayX, displayY };
  };

  return (
    <div className="depth-camera-preview">
      <img
        alt={alt}
        className="stream-preview"
        draggable={false}
        onError={onError}
        onLoad={(event) => onLoad?.(event.currentTarget)}
        onPointerLeave={() => onPointerSample(undefined)}
        onPointerMove={(event) => onPointerSample(sample(event))}
        ref={(node) => {
          ref.current = node;
          imageRef?.(node);
        }}
      />
      {overlaySrc ? (
        <img
          alt=""
          aria-hidden="true"
          className="stream-preview depth-fusion-preview"
          draggable={false}
          ref={overlayRef}
          style={{ opacity: overlayOpacity ?? 0.45 }}
        />
      ) : null}
    </div>
  );
}
