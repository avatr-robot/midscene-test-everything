import { PlaygroundSDK } from '@midscene/playground';
import { Alert, Button, Spin, Tooltip } from 'antd';
import { MessageSquare } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useConnection } from '../connection';
import { usePreferences } from '../i18n';
import { type TaskEntry, useTasks } from '../tasks';
import { EnvConfig } from '../vendor/visualizer/component/env-config';
import { UniversalPlayground } from '../vendor/visualizer/component/universal-playground';
import { PlaygroundTranslationContext } from '../vendor/visualizer/component/universal-playground/translation';
import { useEnvConfig } from '../vendor/visualizer/store/store';
import type { UniversalPlaygroundConfig } from '../vendor/visualizer/types';
import { translateVisualizer } from '../visualizer-i18n';

function TaskPanel({
  task,
  header,
}: { task: TaskEntry; header?: HTMLElement | null }) {
  const armBlocked = useConnection((s) =>
    Boolean(s.recoveryRequired || s.controlPending || s.controlError),
  );
  const language = usePreferences((s) => s.language);
  const sdk = useMemo(
    () =>
      new PlaygroundSDK({
        type: 'remote-execution',
        serverUrl: `${window.location.origin}/api/tasks/${task.id}`,
      }),
    [task.id],
  );
  const { cancel, pending } = useTasks();
  const config = useMemo<UniversalPlaygroundConfig>(
    () => ({
      serverMode: true,
      persistMessages: true,
      storageNamespace: task.id,
      historyNamespace: task.id,
      executionScopeKey: task.id,
      // Host owns robot readiness; keep the vendor unaware of arm/task state.
      onBeforeExecutionStart: async () => {
        const connection = useConnection.getState();
        const current = useTasks
          .getState()
          .tasks.find((entry) => entry.id === task.id);
        if (
          connection.recoveryRequired ||
          connection.controlPending ||
          connection.controlError ||
          !current ||
          current.phase === 'running' ||
          current.phase === 'error' ||
          current.phase === 'closing'
        ) {
          throw new Error(
            language === 'zh'
              ? '当前任务暂不可执行，请先处理机械臂状态。'
              : 'This task cannot run until the robot is ready.',
          );
        }
        // Ensure the shared model settings are applied before execution, including changes made while another task was running.
        await sdk.overrideConfig(useEnvConfig.getState().config);
      },
      showContextPreview: false,
      showSystemMessageHeader: false,
      executionFlow: { collapsible: true },
      translate: (message, values) =>
        translateVisualizer(message, values, language),
      suppressConfigErrorToast: true,
      promptInputChrome: { variant: 'minimal' },
    }),
    [task.id, language, sdk],
  );
  return (
    <>
      {task.error && <Alert type="error" message={task.error} />}
      {task.requestId && (
        <Alert
          type="info"
          message={
            language === 'zh'
              ? '任务正在运行，切换页面不会中断执行。'
              : 'Task is running. Switching pages does not stop execution.'
          }
          action={
            <Button
              loading={pending}
              onClick={() => void cancel(task.id, task.requestId!)}
            >
              {language === 'zh' ? '停止任务' : 'Stop task'}
            </Button>
          }
        />
      )}
      <PlaygroundTranslationContext.Provider value={config.translate!}>
        {header &&
          createPortal(
            <EnvConfig playgroundSDK={sdk} showTooltipWhenEmpty={false} />,
            header,
          )}
        <fieldset
          disabled={
            armBlocked ||
            task.phase === 'running' ||
            task.phase === 'error' ||
            task.phase === 'closing'
          }
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
          <UniversalPlayground
            playgroundSDK={sdk}
            config={config}
            branding={{
              targetName: language === 'zh' ? '手机屏幕' : 'phone screen',
            }}
          />
        </fieldset>
      </PlaygroundTranslationContext.Provider>
    </>
  );
}
export function TaskWorkspace({ cameraId }: { cameraId?: string }) {
  const language = usePreferences((s) => s.language);
  const [header, setHeader] = useState<HTMLDivElement | null>(null);
  const { tasks, refresh, add, error, pollError } = useTasks();
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (disposed) return;
      if (cameraId) {
        const current = useTasks.getState();
        if (
          !current.pollError &&
          !current.error &&
          !current.pending &&
          !current.tasks.some((task) => task.cameraId === cameraId)
        )
          await current.add(cameraId);
      }
      if (!disposed) timer = setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [refresh, cameraId]);
  const active = tasks.find((task) => task.cameraId === cameraId)?.id;
  return (
    <section className="task-workspace">
      <header className="task-device-heading">
        <Tooltip title={language === 'zh' ? '对话' : 'Chat'}>
          <span
            className="task-heading-icon"
            role="img"
            aria-label={language === 'zh' ? '对话' : 'Chat'}
          >
            <MessageSquare size={18} aria-hidden="true" />
          </span>
        </Tooltip>
        <div className="task-header-actions">
          <div ref={setHeader} />
        </div>
      </header>
      {error && <Alert type="error" showIcon message={error} />}
      {pollError && <Alert type="warning" showIcon message={pollError} />}
      {!active && !error && (
        <Spin
          tip={language === 'zh' ? '准备设备对话…' : 'Preparing conversation…'}
        >
          <div style={{ minHeight: 120 }} />
        </Spin>
      )}
      {error && cameraId && (
        <Button onClick={() => void add(cameraId)}>
          {language === 'zh' ? '重试' : 'Retry'}
        </Button>
      )}
      {tasks.map((task) => (
        <div
          className="task-instance"
          key={task.id}
          hidden={task.id !== active}
        >
          <TaskPanel task={task} header={task.id === active ? header : null} />
        </div>
      ))}
    </section>
  );
}
