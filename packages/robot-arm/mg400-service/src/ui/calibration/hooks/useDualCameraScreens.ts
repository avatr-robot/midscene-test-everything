import type { DualCameraScreenAssociations } from '@midscene/robotics-shared/assisted-contracts';
import { useEffect, useRef, useState } from 'react';

async function requestAssociations(
  cameraId: string,
  signal: AbortSignal,
  screenIds?: string[],
): Promise<DualCameraScreenAssociations> {
  const params = new URLSearchParams({ camera: cameraId });
  const response = await fetch(`/api/camera-screen-associations?${params}`, {
    signal,
    cache: 'no-store',
    ...(screenIds && {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ screenIds }),
    }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? 'Could not associate the two camera views.');
  return data;
}

export function useDualCameraScreens({
  cameraId,
  active,
  ready,
  screenRevision,
  readyScreenIds,
  readOnly = false,
  pollMs,
}: {
  cameraId: string;
  active: boolean;
  ready: boolean;
  screenRevision: string;
  readyScreenIds: readonly string[];
  /** Observation only: never start an association that needs the cameras. */
  readOnly?: boolean;
  /** Re-read saved associations while something else may be refreshing them. */
  pollMs?: number;
}) {
  const scope = JSON.stringify([cameraId, active, screenRevision]);
  const [snapshot, setSnapshot] = useState<{
    scope: string;
    data: DualCameraScreenAssociations;
  }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController>();
  const attempted = useRef(new Set<string>());
  const data = snapshot?.scope === scope ? snapshot.data : undefined;
  const readyIds = new Set(readyScreenIds);
  const readyKey = JSON.stringify(readyScreenIds);
  const remaining = (data?.screens ?? [])
    .filter(
      ({ screenId, status }) =>
        status !== 'associated' &&
        readyIds.has(screenId) &&
        !attempted.current.has(screenId),
    )
    .map(({ screenId }) => screenId);
  const remainingKey = JSON.stringify(remaining);

  useEffect(() => {
    attempted.current.clear();
    setSnapshot(undefined);
    setError(undefined);
    setBusy(false);
    if (!active) return;
    const load = new AbortController();
    void requestAssociations(cameraId, load.signal).then(
      (result) => {
        if (!load.signal.aborted) setSnapshot({ scope, data: result });
      },
      (cause) => {
        if (!load.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      load.abort();
      pending.current?.abort();
      pending.current = undefined;
    };
  }, [active, cameraId, scope]);

  useEffect(() => {
    if (pending.current || readOnly) return;
    const currentReady = new Set<string>(JSON.parse(readyKey));
    for (const id of attempted.current)
      if (!currentReady.has(id)) attempted.current.delete(id);
    const ids: string[] = JSON.parse(remainingKey);
    if (!active || !ready || !data?.sideCamera || !ids.length) return;
    const controller = new AbortController();
    pending.current = controller;
    for (const id of ids) attempted.current.add(id);
    setBusy(true);
    setError(undefined);
    void requestAssociations(cameraId, controller.signal, ids)
      .then(
        (result) => {
          if (!controller.signal.aborted) setSnapshot({ scope, data: result });
        },
        (cause) => {
          if (!controller.signal.aborted)
            setError(cause instanceof Error ? cause.message : String(cause));
        },
      )
      .finally(() => {
        if (pending.current === controller) {
          pending.current = undefined;
          setBusy(false);
        }
      });
  }, [
    active,
    busy,
    cameraId,
    data,
    ready,
    readOnly,
    readyKey,
    remainingKey,
    scope,
  ]);

  /*
   * The calibration step only reads saved associations, but the batch refreshes
   * them per screen. Re-read on a timer so its regions reach this preview.
   */
  useEffect(() => {
    if (!active || !pollMs || !readOnly) return;
    const poll = new AbortController();
    const timer = setInterval(() => {
      if (pending.current) return;
      void requestAssociations(cameraId, poll.signal).then(
        (result) => {
          if (!poll.signal.aborted) setSnapshot({ scope, data: result });
        },
        () => undefined,
      );
    }, pollMs);
    return () => {
      clearInterval(timer);
      poll.abort();
    };
  }, [active, cameraId, pollMs, readOnly, scope]);

  const waiting =
    !readOnly &&
    !busy &&
    active &&
    ready &&
    ((!data && !error) || Boolean(data?.sideCamera && remaining.length));
  return { data, error, busy, waiting };
}
