export type CameraView = 'raw' | 'corrected';
export function cameraPreviewUrl(id: string, view: CameraView = 'raw') {
  return `/api/cameras/preview?id=${encodeURIComponent(id)}&view=${view}`;
}
