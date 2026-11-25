export interface DepthProbePosition {
  left: number;
  top: number;
}

export interface DepthProbePlacement {
  pointerX: number;
  pointerY: number;
  containerWidth: number;
  containerHeight: number;
  probeWidth: number;
  probeHeight: number;
  gap?: number;
  padding?: number;
}

export function placeDepthProbe({
  pointerX,
  pointerY,
  containerWidth,
  containerHeight,
  probeWidth,
  probeHeight,
  gap = 12,
  padding = 4,
}: DepthProbePlacement): DepthProbePosition {
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    probeWidth <= 0 ||
    probeHeight <= 0
  )
    return { left: pointerX + gap, top: pointerY + gap };

  let left = pointerX + gap;
  if (left + probeWidth + padding > containerWidth)
    left = pointerX - probeWidth - gap;
  const maxLeft = Math.max(padding, containerWidth - probeWidth - padding);
  left = Math.min(maxLeft, Math.max(padding, left));

  let top = pointerY + gap;
  if (top + probeHeight + padding > containerHeight)
    top = pointerY - probeHeight - gap;
  const maxTop = Math.max(padding, containerHeight - probeHeight - padding);
  top = Math.min(maxTop, Math.max(padding, top));
  return { left, top };
}
