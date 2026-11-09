import type { CalibrationSnapshot } from '../robot-arm-api';
import { robotCue, robotVoice } from './browser';
/** A fresh subscription is silent. Only subsequent transitions announce. */
export function calibrationAnnouncements() {
  let previous: CalibrationSnapshot | undefined;
  return (next: CalibrationSnapshot) => {
    const old = previous;
    previous = next;
    if (!old) return;
    const s = next.session;
    const stage = s?.stage;
    if (
      next.setup.markerCapture?.request !== old.setup.markerCapture?.request &&
      next.setup.markerCapture
    )
      robotVoice.notify(
        next.setup.markerCapture.attempt > 1
          ? 'markersRetry'
          : 'markersCountdown',
        1,
      );
    if (stage !== old.session?.stage || s?.id !== old.session?.id) {
      const event =
        stage === 'collecting'
          ? 'autoStarted'
          : stage === 'avoiding-camera'
            ? 'autoAvoiding'
            : stage === 'return-ready'
              ? 'autoWaitingSafe'
              : stage === 'review'
                ? 'autoReview'
                : stage === 'completed'
                  ? 'autoCompleted'
                  : stage === 'interrupted' || stage === 'capture-failed'
                    ? 'autoFailed'
                    : stage === 'cancelled'
                      ? 'autoStopped'
                      : stage?.startsWith('positioning')
                        ? 'drag'
                        : stage === 'safety'
                          ? 'hover'
                          : undefined;
      if (event) robotVoice.notify(event, stage === 'interrupted' ? 2 : 1);
    }
    if (
      s?.samples !== old.session?.samples &&
      (s?.samples ?? 0) > (old.session?.samples ?? 0)
    )
      robotCue.play('click');
  };
}
