import type { ServerResponse } from 'node:http';
import type { DeviceEntry } from './devices.js';

/** Share the camera stream; corrected frames use the same accepted mapping as task screenshots. */
export async function streamCameraPreview(
  res: ServerResponse,
  entry: DeviceEntry,
  corrected = false,
) {
  const stream = entry.camera.stream;
  if (corrected) await entry.device.configuration();
  if (res.destroyed) return;
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  let blocked = false;
  let processing = false;
  let lastCorrectedAt = 0;
  const writeFrame = async (frame: { jpeg: Buffer }) => {
    if (blocked || processing || res.destroyed || res.writableEnded) return;
    // Drop intermediate frames instead of queuing expensive perspective transforms.
    if (corrected && Date.now() - lastCorrectedAt < 100) return;
    processing = true;
    try {
      const jpeg = corrected
        ? Buffer.from(await entry.device.screenshotBase64(), 'base64')
        : frame.jpeg;
      if (res.destroyed || res.writableEnded) return;
      const header = Buffer.from(
        `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`,
      );
      blocked = !res.write(Buffer.concat([header, jpeg, Buffer.from('\r\n')]));
      lastCorrectedAt = Date.now();
    } catch {
      // Never silently substitute raw frames for an invalid corrected view.
      res.destroy();
    } finally {
      processing = false;
    }
  };
  const drained = () => {
    blocked = false;
  };
  const ended = () => res.end();
  res.on('drain', drained);
  stream.on('frame', writeFrame);
  stream.once('stopped', ended);
  stream.once('failed', ended);
  res.once('close', () => {
    res.off('drain', drained);
    stream.off('frame', writeFrame);
    stream.off('stopped', ended);
    stream.off('failed', ended);
  });
}
