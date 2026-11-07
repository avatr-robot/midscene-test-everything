import { create } from 'zustand';
export interface TaskEntry {
  id: string;
  cameraId: string;
  name: string;
  phase?: 'idle' | 'running' | 'closing' | 'error';
  requestId?: string;
  error?: string;
}
let revision = 0;
let refreshing = false;
async function request(path = '', options?: RequestInit) {
  const response = await fetch(`/api/tasks${path}`, {
    signal: AbortSignal.timeout(options?.method ? 120000 : 10000),
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Task request failed');
  return data;
}
export const useTasks = create<{
  tasks: TaskEntry[];
  pending: boolean;
  error?: string;
  pollError?: string;
  refresh(): Promise<void>;
  add(cameraId: string): Promise<void>;
  cancel(id: string, requestId: string): Promise<void>;
}>((set, get) => ({
  tasks: [],
  pending: false,
  refresh: async () => {
    if (refreshing || get().pending) return;
    refreshing = true;
    const started = revision;
    try {
      const { tasks } = await request();
      if (started === revision) set({ tasks, pollError: undefined });
    } catch (error) {
      if (started === revision) set({ pollError: String(error) });
    } finally {
      refreshing = false;
    }
  },
  add: async (cameraId) => {
    if (get().pending || get().tasks.some((task) => task.cameraId === cameraId))
      return;
    revision++;
    set({ pending: true, error: undefined });
    try {
      const entry = await request('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cameraId,
          name: 'Device conversation',
        }),
      });
      set({
        tasks: [
          ...get().tasks.filter((task) => task.cameraId !== cameraId),
          entry,
        ],
      });
    } catch (error) {
      set({ error: String(error) });
    } finally {
      revision++;
      set({ pending: false });
    }
  },
  cancel: async (id, requestId) => {
    if (get().pending) return;
    revision++;
    set({ pending: true, error: undefined });
    try {
      await request(`/${id}/cancel/${encodeURIComponent(requestId)}`, {
        method: 'POST',
      });
    } catch (error) {
      set({ error: String(error) });
    } finally {
      revision++;
      set({ pending: false });
      await get().refresh();
    }
  },
}));
