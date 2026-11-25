import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraEntry } from '../cameras';
import { sampleDepth } from '../depth-api';

export interface PreviewImagePoint {
  x: number;
  y: number;
  displayX: number;
  displayY: number;
}

export interface DepthProbeView {
  x: number;
  y: number;
  displayX: number;
  displayY: number;
  depthMeters?: number | null;
  loading: boolean;
  error?: string;
}

const PROBE_DELAY_MS = 60;
const STATIONARY_REFRESH_MS = 250;
const RETRY_DELAY_MS = 1_000;

const sameSample = (
  left: DepthProbeView | undefined,
  right: DepthProbeView,
): boolean =>
  left?.x === right.x &&
  left.y === right.y &&
  left.displayX === right.displayX &&
  left.displayY === right.displayY &&
  left.depthMeters === right.depthMeters &&
  left.loading === right.loading &&
  left.error === right.error;

/** Samples the latest aligned depth map at the pointer with one bounded request. */
export function useDepthProbe(
  camera: CameraEntry | undefined,
  stream: CameraEntry['stream'] | undefined,
) {
  const [sample, setSample] = useState<DepthProbeView>();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const generation = useRef(0);
  const inFlight = useRef(false);
  const pointer = useRef<{
    generation: number;
    point: PreviewImagePoint;
  }>();
  const scheduleRef = useRef<(delay: number) => void>(() => undefined);
  const enabled =
    camera?.kind === 'depth' && stream?.state === 'running' && stream.hasFrame;

  const clear = useCallback(() => {
    generation.current += 1;
    pointer.current = undefined;
    clearTimeout(timer.current);
    timer.current = undefined;
    setSample(undefined);
  }, []);

  useEffect(() => {
    if (!enabled) clear();
    return () => {
      clearTimeout(timer.current);
      generation.current += 1;
    };
  }, [clear, enabled, camera?.id]);

  const schedule = useCallback(
    (delay: number) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = undefined;
        const active = pointer.current;
        if (!active || !camera || active.generation !== generation.current)
          return;
        if (inFlight.current) {
          scheduleRef.current(60);
          return;
        }
        if (typeof document !== 'undefined' && document.hidden) {
          scheduleRef.current(RETRY_DELAY_MS);
          return;
        }
        inFlight.current = true;
        void sampleDepth(
          camera.id,
          Math.floor(active.point.x),
          Math.floor(active.point.y),
        )
          .then((result) => {
            if (
              pointer.current !== active ||
              generation.current !== active.generation
            )
              return;
            const next: DepthProbeView = {
              x: result.x,
              y: result.y,
              displayX: active.point.displayX,
              displayY: active.point.displayY,
              depthMeters: result.depthMeters,
              loading: false,
            };
            setSample((current) =>
              sameSample(current, next) ? current : next,
            );
            scheduleRef.current(STATIONARY_REFRESH_MS);
          })
          .catch((cause) => {
            if (
              pointer.current !== active ||
              generation.current !== active.generation
            )
              return;
            const next: DepthProbeView = {
              x: Math.floor(active.point.x),
              y: Math.floor(active.point.y),
              displayX: active.point.displayX,
              displayY: active.point.displayY,
              loading: false,
              error: cause instanceof Error ? cause.message : String(cause),
            };
            setSample((current) =>
              sameSample(current, next) ? current : next,
            );
            scheduleRef.current(RETRY_DELAY_MS);
          })
          .finally(() => {
            inFlight.current = false;
          });
      }, delay);
    },
    [camera],
  );

  useEffect(() => {
    scheduleRef.current = schedule;
    return () => {
      scheduleRef.current = () => undefined;
    };
  }, [schedule]);

  const onPointerSample = useCallback(
    (point: PreviewImagePoint | undefined) => {
      clearTimeout(timer.current);
      timer.current = undefined;
      if (!enabled || !camera || !point) {
        clear();
        return;
      }
      const current = generation.current + 1;
      generation.current = current;
      pointer.current = { generation: current, point };
      setSample({
        x: Math.floor(point.x),
        y: Math.floor(point.y),
        displayX: point.displayX,
        displayY: point.displayY,
        loading: true,
      });
      schedule(PROBE_DELAY_MS);
    },
    [camera, clear, enabled, schedule],
  );

  return { sample, onPointerSample };
}
