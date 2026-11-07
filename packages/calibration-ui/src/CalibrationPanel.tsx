import type { CameraMappingAccuracy } from '@midscene/arm-kit-shared/assisted-contracts';
import { Alert, Steps } from 'antd';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { CalibrationClient } from './client';
import { PhonePairStep } from './components/robot-arm/PhonePairStep';
import { WebCalibrationWorkspace } from './components/robot-arm/WebCalibrationWorkspace';
import { WebCameraMappingStep } from './components/robot-arm/WebCameraMappingStep';
import { useAssistedCalibration } from './hooks/useAssistedCalibration';
import { t, useCalibrationLanguage } from './i18n';
import type {
  CalibrationModelConfig,
  CalibrationServerModel,
} from './model-settings';
import type {
  AssistedCalibrationInput,
  AssistedMappingInput,
  CalibrationProfile,
} from './robot-arm-api';
import type { CameraProfile } from './types';

/** Shared wizard. Hosts supply camera preview/editor; all calibration commands use one client. */
function CalibrationPanelContent(props: {
  client: CalibrationClient;
  deviceId: string;
  input?: AssistedCalibrationInput;
  output?: AssistedMappingInput;
  camera?: CameraProfile;
  correctionKey?: string;
  result?: CalibrationProfile;
  preview?: ReactNode;
  mappingPreview?: ReactNode;
  correctedPreview?: ReactNode;
  outputSize?: { width: number; height: number };
  checkDraft?(): Promise<CameraMappingAccuracy | undefined>;
  onConfirmMapping?(): Promise<void>;
  savingMapping?: boolean;
  controls?: ReactNode;
  showSessionCancel?: boolean;
  ready?: boolean;
  editing?: boolean;
  onDetect?(): Promise<void>;
  onDetectAI?(modelConfig?: CalibrationModelConfig): Promise<void>;
  detectionModel?: CalibrationServerModel;
  onComplete?(): void;
  completionLabel?: string;
  footerContainer?: HTMLElement | null;
  navigationContainer?: HTMLElement | null;
  onStepChange?(step: number): void;
  onEditSetup?(): void;
}) {
  useCalibrationLanguage((state) => state.language);
  const controller = useAssistedCalibration(props.client, props.deviceId, true);
  const [step, setStep] = useState(0);
  const [localFooter, setFooter] = useState<HTMLDivElement | null>(null);
  const footer = props.footerContainer ?? localFooter;
  useEffect(() => props.onStepChange?.(step), [step, props.onStepChange]);
  const [error, setError] = useState<string>();
  const beforeLeave = useRef<(() => Promise<void>) | null>(null);
  const registerLeave = useCallback((handler: (() => Promise<void>) | null) => {
    beforeLeave.current = handler;
  }, []);
  const changeStep = async (next: number) => {
    if (next === step) return;
    setError(undefined);
    try {
      if (controller.busy)
        throw new Error(
          t('Wait for the current calibration command to finish.'),
        );
      if (next === 2 && props.editing)
        throw new Error(t('Confirm the screen area before continuing.'));
      await beforeLeave.current?.();
      setStep(next);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <section className="arm-calibration-panel">
      {props.navigationContainer ? (
        createPortal(
          <Steps
            size="small"
            current={step + 1}
            onChange={(next) => {
              if (next === 0) {
                if (controller.busy) return;
                void (beforeLeave.current?.() ?? Promise.resolve())
                  .then(() => props.onEditSetup?.())
                  .catch((error) => setError(String(error)));
              } else void changeStep(next - 1);
            }}
            items={[
              'Touch Tool',
              'Connect Phone',
              'Camera correction',
              'Arm calibration',
            ].map((title, index) => ({
              title: t(title),
              status:
                index === step + 1
                  ? ('process' as const)
                  : index === 0 ||
                      (index === 1 && controller.setup.phoneConnected) ||
                      (index === 2 && controller.setup.mapping) ||
                      (index === 3 && controller.session?.stage === 'completed')
                    ? ('finish' as const)
                    : ('wait' as const),
            }))}
          />,
          props.navigationContainer,
        )
      ) : (
        <Steps
          current={step}
          onChange={(next) => void changeStep(next)}
          items={['Connect Phone', 'Camera correction', 'Calibration'].map(
            (title) => ({ title: t(title) }),
          )}
        />
      )}
      {error && <Alert type="error" showIcon message={error} />}
      {step === 0 && (
        <PhonePairStep
          controller={controller}
          footer={footer}
          onContinue={() => void changeStep(1)}
        />
      )}
      {step === 1 && (
        <WebCameraMappingStep
          controller={controller}
          camera={props.camera}
          live={props.mappingPreview ?? props.preview}
          hasCorners={Boolean(props.mappingPreview)}
          corrected={props.correctedPreview}
          size={props.outputSize}
          input={props.input}
          output={props.output}
          correctionKey={props.correctionKey}
          footer={footer}
          editing={props.editing}
          checkDraft={props.checkDraft}
          onConfirm={props.onConfirmMapping}
          saving={props.savingMapping}
          onDetect={props.onDetect}
          onDetectAI={props.onDetectAI}
          detectionModel={props.detectionModel}
          onPair={() => void changeStep(0)}
          onContinue={() => void changeStep(2)}
        />
      )}
      {step === 2 && (
        <WebCalibrationWorkspace
          controller={controller}
          result={props.result}
          footer={footer}
          preview={props.preview}
          controls={props.controls}
          showSessionCancel={props.showSessionCancel}
          readyToStart={props.ready ?? false}
          readyToCapture={props.ready ?? false}
          readyToVerify={props.ready ?? false}
          onActivated={async () => {}}
          onBeforeLeaveChange={registerLeave}
          onCheckCamera={() => void changeStep(1)}
          onConnectPhone={() => void changeStep(0)}
          onReturn={props.onComplete}
          completionLabel={props.completionLabel}
        />
      )}
      {!props.footerContainer && (
        <div className="arm-calibration-footer" ref={setFooter} />
      )}
    </section>
  );
}

/** Switching devices creates an isolated view/store; the SDK retains the calibration session. */
export function CalibrationPanel(
  props: Parameters<typeof CalibrationPanelContent>[0],
) {
  return <CalibrationPanelContent key={props.deviceId} {...props} />;
}
