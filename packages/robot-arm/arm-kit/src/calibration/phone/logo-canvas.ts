import type { CalibrationLogoStatus } from '../../assisted-contracts.js';

/** Serialized into the calibration page, so keep the implementation self-contained. */
export function mountLogoCanvas(
  canvas: HTMLCanvasElement,
  signature: HTMLElement,
  error: HTMLElement,
  onPaint: () => void,
) {
  const ink = canvas.getContext('2d');
  let run: CalibrationLogoStatus | undefined;
  let painted: string | undefined;
  let pointer: number | undefined;
  let strokeStart: [number, number] | undefined;
  let strokes = 0;
  let strokeInvalid = false;
  let strokeExtent = 0;

  const showResult = () => {
    const signed =
      run?.state === 'completed' &&
      pointer === undefined &&
      strokes === run.expectedStrokes &&
      !strokeInvalid;
    signature.setAttribute('aria-hidden', String(!signed));
    const warning =
      run?.state === 'failed'
        ? (run.error ?? 'Logo drawing stopped')
        : run?.state === 'completed' && pointer === undefined && !signed
          ? 'Check the drawing'
          : '';
    error.textContent = warning;
    error.hidden = !warning;
  };
  const point = (event: PointerEvent): [number, number] => {
    const bounds = canvas.getBoundingClientRect();
    return [event.clientX - bounds.left, event.clientY - bounds.top];
  };
  canvas.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    if (!ink || !painted || run?.state !== 'drawing' || pointer !== undefined)
      return;
    event.preventDefault();
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    strokeStart = point(event);
    strokeExtent = 0;
    ink.beginPath();
    ink.moveTo(...strokeStart);
  });
  canvas.addEventListener('pointermove', (event) => {
    event.stopPropagation();
    if (!ink || pointer !== event.pointerId) return;
    const samples = event.getCoalescedEvents?.();
    for (const sample of samples?.length ? samples : [event]) {
      const position = point(sample);
      ink.lineTo(...position);
      if (strokeStart)
        strokeExtent = Math.max(
          strokeExtent,
          Math.hypot(
            position[0] - strokeStart[0],
            position[1] - strokeStart[1],
          ),
        );
    }
    ink.stroke();
    ink.beginPath();
    ink.moveTo(...point(event));
  });
  const finish = (event: PointerEvent) => {
    event.stopPropagation();
    if (!ink || pointer !== event.pointerId) return;
    pointer = undefined;
    if (event.type !== 'pointerup') strokeInvalid = true;
    else {
      const end = point(event);
      ink.lineTo(...end);
      ink.stroke();
      if (
        !strokeStart ||
        strokeExtent < 4 ||
        Math.hypot(end[0] - strokeStart[0], end[1] - strokeStart[1]) > 12
      )
        strokeInvalid = true;
      strokes++;
    }
    showResult();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('lostpointercapture', finish);

  return {
    supported: Boolean(ink),
    get painted() {
      return painted;
    },
    show(next?: CalibrationLogoStatus) {
      const changed = run?.id !== next?.id;
      run = next;
      canvas.hidden = !run;
      if (changed) {
        painted = undefined;
        strokes = 0;
        strokeInvalid = false;
        pointer = undefined;
        strokeStart = undefined;
        if (ink && next) {
          const bounds = canvas.getBoundingClientRect();
          if (bounds.width > 0 && bounds.height > 0) {
            const scale = Math.min(devicePixelRatio || 1, 2);
            canvas.width = Math.round(bounds.width * scale);
            canvas.height = Math.round(bounds.height * scale);
            ink.setTransform(scale, 0, 0, scale, 0, 0);
            ink.lineCap = ink.lineJoin = 'round';
            ink.lineWidth = 2.5;
            ink.strokeStyle = '#f8fafc';
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                if (run?.id !== next.id || run.state !== 'drawing') return;
                painted = next.id;
                onPaint();
              }),
            );
          }
        }
      }
      showResult();
    },
  };
}
