export interface DepthSample {
  frameId: number;
  capturedAt: number;
  x: number;
  y: number;
  width: number;
  height: number;
  units: number;
  scaleMeters: number;
  depthMeters: number | null;
}

export interface DepthPointCloudFrame {
  colorJpeg: Blob;
  depth: ArrayBuffer;
  height: number;
  width: number;
  scaleMeters: number;
  frameId: number;
  capturedAt: number;
  intrinsics: {
    fx: number;
    fy: number;
    cx: number;
    cy: number;
  };
}

async function responseError(response: Response): Promise<never> {
  let message = `Request failed with status ${response.status}`;
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // A proxy can fail without a JSON body.
  }
  throw new Error(message);
}

export async function updateDepthControls(
  cameraId: string,
  controls: Record<string, number>,
): Promise<{
  controls: Record<string, number>;
  stream?: {
    state: string;
    width: number;
    height: number;
    hasFrame: boolean;
  };
}> {
  const response = await fetch('/api/cameras/depth/controls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: cameraId, controls }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) await responseError(response);
  return response.json();
}

export function depthImageUrl(cameraId: string): string {
  return `/api/cameras/preview?id=${encodeURIComponent(cameraId)}&view=raw`;
}

export async function sampleDepth(
  cameraId: string,
  x: number,
  y: number,
): Promise<DepthSample> {
  const query = new URLSearchParams({
    id: cameraId,
    x: String(x),
    y: String(y),
    fresh: 'false',
  });
  const response = await fetch(`/api/cameras/depth/sample?${query}`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) await responseError(response);
  return response.json();
}

export async function depthPointCloudFrame(
  cameraId: string,
): Promise<DepthPointCloudFrame> {
  const response = await fetch(
    `/api/cameras/pointcloud?id=${encodeURIComponent(cameraId)}&fresh=true`,
    {
      headers: { Accept: 'application/octet-stream' },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) await responseError(response);
  const payload = await response.arrayBuffer();
  const headerBytes = 40;
  if (payload.byteLength < headerBytes)
    throw new Error('Point cloud response is too short');
  const view = new DataView(payload);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  const width = view.getUint32(4, true);
  const height = view.getUint32(8, true);
  const depthBytes = view.getUint32(12, true);
  const colorBytes = view.getUint32(16, true);
  const scaleMeters = view.getFloat32(20, true);
  const fx = view.getFloat32(24, true);
  const fy = view.getFloat32(28, true);
  const cx = view.getFloat32(32, true);
  const cy = view.getFloat32(36, true);
  if (
    magic !== 'RSPC' ||
    width === 0 ||
    height === 0 ||
    depthBytes !== width * height * 2 ||
    colorBytes === 0 ||
    headerBytes + depthBytes + colorBytes !== payload.byteLength ||
    scaleMeters <= 0 ||
    fx <= 0 ||
    fy <= 0
  )
    throw new Error('Point cloud response has invalid metadata');
  return {
    colorJpeg: new Blob([payload.slice(headerBytes + depthBytes)], {
      type: 'image/jpeg',
    }),
    depth: payload.slice(headerBytes, headerBytes + depthBytes),
    width,
    height,
    scaleMeters,
    frameId: Number(response.headers.get('x-frame-id')),
    capturedAt: Number(response.headers.get('x-captured-at')),
    intrinsics: { fx, fy, cx, cy },
  };
}
