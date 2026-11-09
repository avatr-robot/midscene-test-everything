import { useEffect, useState } from 'react';
import {
  type PerspectiveObservation,
  observePerspective,
} from '../utils/perspective-observer';
export type { PerspectiveObservation } from '../utils/perspective-observer';

/** A screen switch/unmount aborts polling and discards late results. */
export function usePerspectiveValidity(
  baseUrl: string,
  enabled: boolean,
  revision = '',
): PerspectiveObservation {
  const key = `${baseUrl}:${revision}`;
  const [result, setResult] = useState<
    PerspectiveObservation & { key: string }
  >();
  useEffect(() => {
    if (!enabled) return;
    const watcher = observePerspective({
      baseUrl,
      visible: () => document.visibilityState !== 'hidden',
      publish: (value) => setResult({ ...value, key }),
    });
    const visible = () => {
      if (document.visibilityState !== 'hidden') void watcher.refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      watcher.close();
      document.removeEventListener('visibilitychange', visible);
    };
  }, [baseUrl, enabled, key]);
  return enabled && result?.key === key ? result : {};
}
