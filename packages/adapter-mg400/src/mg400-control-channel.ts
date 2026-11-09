import net from 'node:net';
import { RobotArmError } from '@midscene/arm-kit/adapter-development';
import { exchangeMg400Http } from './mg400-http.js';

/** ASCII dashboard channel. Refused wholesale while the controller keeps it. */
export const MG400_DASHBOARD_PORT = 29999;

export interface Mg400DashboardProbeOptions {
  port?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Send `RobotMode()` once and return the raw reply, or `null` when the channel
 * stayed silent, failed, or was refused.
 *
 * A refused controller still answers, with vendor code `-1` and no data:
 * `-1,{},RobotMode();`. Treating that as "reachable" is what makes an adapter
 * initialize against a controller that will reject every later command, so only
 * a `0,` reply counts as serviceable here.
 */
export function probeMg400Dashboard(
  host: string,
  options: Mg400DashboardProbeOptions = {},
): Promise<string | null> {
  const { port = MG400_DASHBOARD_PORT, timeoutMs = 2000, signal } = options;
  return new Promise<string | null>((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        signal.reason instanceof RobotArmError
          ? signal.reason
          : new RobotArmError('ACTION_STOPPED', 'MG400 probe interrupted', 409),
      );
      return;
    }
    const socket = new net.Socket();
    let settled = false;
    let buffer = '';
    const finish = (value: string | null, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const onAbort = () =>
      finish(
        null,
        signal?.reason instanceof RobotArmError
          ? signal.reason
          : new RobotArmError('ACTION_STOPPED', 'MG400 probe interrupted', 409),
      );
    const timer = setTimeout(() => finish(null), Math.max(1, timeoutMs));
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const end = buffer.indexOf(';');
      if (end >= 0) {
        const line = buffer.slice(0, end + 1).trim();
        finish(line.startsWith('0,') ? line : null);
      }
    });
    // A refused or resetting controller is a "not usable" answer, not a crash.
    socket.on('error', () => finish(null));
    socket.on('close', () => finish(null));
    socket.connect(port, host, () => socket.write('RobotMode()\n'));
  });
}

/** The two factory Ethernet endpoints. Only a valid mode reply identifies a controller. */
export async function discoverMg400Hosts(
  probe = probeMg400Dashboard,
): Promise<string[]> {
  const hosts = ['192.168.1.6', '192.168.2.6'];
  const replies = await Promise.all(
    hosts.map((host) => probe(host, { timeoutMs: 1500 })),
  );
  return hosts.filter((_, i) =>
    /^0,\{\s*\d+\s*\},\s*RobotMode\(\);$/.test(replies[i] ?? ''),
  );
}

/** Internal TCP/IP connection preparation, not a user-selectable mode API.
 * On the supported MG400 firmware, wire value `tp` means TCP/IP development.
 * Never try alternate values: acknowledgment alone does not prove TCP works.
 */
export async function prepareMg400TcpConnection(
  host: string,
  options: Mg400DashboardProbeOptions & {
    httpPort?: number;
    settleMs?: number;
    readinessTimeoutMs?: number;
  } = {},
): Promise<void> {
  const {
    httpPort,
    settleMs = 400,
    readinessTimeoutMs = 10_000,
    ...probe
  } = options;
  const connection = await exchangeMg400Http(host, {
    port: httpPort,
    timeoutMs: probe.timeoutMs,
    signal: probe.signal,
    path: '/connection/state',
  });
  if ((connection as { value?: unknown })?.value !== 'connected')
    throw new RobotArmError(
      'VENDOR_ERROR',
      'MG400 controller is unavailable or occupied; TCP/IP connection preparation was not applied',
      409,
    );
  const body = await exchangeMg400Http(host, {
    port: httpPort,
    timeoutMs: probe.timeoutMs,
    signal: probe.signal,
    method: 'POST',
    path: '/settings/function/remoteControl',
    body: { mode: 'tp', name: '' },
  });
  if ((body as { status?: unknown })?.status !== true)
    throw new RobotArmError(
      'VENDOR_ERROR',
      'MG400 did not accept TCP/IP development connection preparation',
      502,
    );
  // The HTTP acknowledgement can precede the command channel becoming ready.
  // Retry only the read-only probe, keeping the mode write a single operation.
  const deadline = Date.now() + readinessTimeoutMs;
  do {
    if (settleMs > 0)
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(settleMs, Math.max(0, deadline - Date.now())),
        ),
      );
    if (
      await probeMg400Dashboard(host, {
        ...probe,
        timeoutMs: Math.max(
          1,
          Math.min(probe.timeoutMs ?? 2000, deadline - Date.now()),
        ),
      })
    )
      return;
  } while (Date.now() < deadline);
  throw new RobotArmError(
    'VENDOR_ERROR',
    'MG400 TCP/IP command channel did not become ready within the connection timeout. Check TCP/IP development mode in DobotStudio and close other controller clients before reconnecting.',
    409,
    {
      host,
      dashboardPort: probe.port ?? MG400_DASHBOARD_PORT,
      readinessTimeoutMs,
    },
  );
}
