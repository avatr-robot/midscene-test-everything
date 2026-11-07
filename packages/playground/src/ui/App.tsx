import { armUiTheme } from '@midscene/arm-kit-shared';
import { App as AntApp, Badge, Button, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { Languages } from 'lucide-react';
import { useEffect } from 'react';
import logo from './assets/midscene-logo.png';
import { ConnectionScreen } from './components/ConnectionScreen';
import { DeviceWorkspace } from './components/DeviceWorkspace';
import { useConnection } from './connection';
import { useSetupStore } from './hooks/useRobotArm';
import { usePreferences, useT } from './i18n';
import './App.less';
import './components/robot-arm/Setup.less';

import { type PlaygroundViews, Views } from './extensions';
export function App(views: PlaygroundViews) {
  const t = useT();
  const { language, setLanguage } = usePreferences();
  const { phase, check } = useConnection();
  const connected = phase === 'connected';
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!useSetupStore.getState().busy) {
        await check();
        if (disposed) return;
        const store = useSetupStore.getState();
        const connection = useConnection.getState();
        const runtime = connection.runtime;
        const state = runtime?.state;
        if (
          connection.phase === 'connected' &&
          connection.recoveryRequired &&
          !connection.controlPending &&
          !store.busy &&
          state?.connected &&
          !runtime?.aiRun &&
          runtime?.operation?.status !== 'running' &&
          !runtime?.softwarePaused &&
          !state.moving &&
          !state.dragMode &&
          !state.paused &&
          !state.faults.length
        ) {
          await connection.recover();
          if (disposed) return;
        }
        const session = connection.setupSession;
        if (
          !store.setup ||
          store.serviceStatus === 'offline' ||
          (session && session !== store.setup.session)
        )
          await store.refreshConfiguration();
      }
      if (!disposed) timer = setTimeout(() => void poll(), 2500);
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [check]);
  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    document.title = t('playground');
  }, [language]);
  return (
    <ConfigProvider theme={armUiTheme} locale={language === 'zh' ? zhCN : enUS}>
      <Views.Provider value={views}>
        <AntApp>
          <div className="app-shell">
            <header className="app-header">
              <div className="brand">
                <img src={logo} alt="Midscene" />
                <span className="brand-divider" />
                <span>{t('playground')}</span>
              </div>
              <div className="header-actions">
                <Badge
                  status={
                    connected
                      ? 'success'
                      : phase === 'connecting' || phase === 'checking'
                        ? 'processing'
                        : 'default'
                  }
                  text={
                    connected
                      ? t('connected')
                      : phase === 'connecting'
                        ? t('connecting')
                        : phase === 'checking'
                          ? t('checking')
                          : t('disconnected')
                  }
                />
                <Button
                  icon={<Languages size={16} />}
                  onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
                >
                  {language === 'zh' ? 'English' : '中文'}
                </Button>
              </div>
            </header>
            {connected ? <DeviceWorkspace /> : <ConnectionScreen />}
          </div>
        </AntApp>
      </Views.Provider>
    </ConfigProvider>
  );
}
