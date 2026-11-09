import type {
  CalibrationBatchCommand,
  CalibrationBatchPlan,
  CalibrationBatchState,
  WorkstationScreenState,
} from '@midscene/arm-kit-shared/assisted-contracts';
import { markerRequest } from './marker-client';
import type { TeachingBinding } from './teaching-client';
export class BatchClient {
  constructor(readonly cameraId: string) {}
  private async request<T>(action: string, input: object = {}): Promise<T> {
    return markerRequest<T>('/api/calibration-batch', {
      action,
      cameraId: this.cameraId,
      ...input,
    });
  }
  calibrationBatch() {
    return this.request<CalibrationBatchState | null>('read');
  }
  calibrationBatchPlan(cameraId: string) {
    return this.request<CalibrationBatchPlan>('plan', { cameraId });
  }
  screens() {
    return this.request<WorkstationScreenState[]>('screens');
  }
  startCalibrationBatch(input: {
    cameraId: string;
    planVersion: string;
    auto: true;
    horizontalConfirmed: true;
    acceptance?: 'manual';
    corridorConfirmed?: true;
  }) {
    return this.request<CalibrationBatchState>('start', input);
  }
  calibrationBatchCommand(id: string, command: CalibrationBatchCommand) {
    return this.request<CalibrationBatchState>('command', { id, ...command });
  }
  clearCalibrationBatches() {
    return this.request<void>('clear');
  }
  deleteCalibration(calibrationProfileId: string) {
    return this.request<void>('delete-calibration', { calibrationProfileId });
  }
  preparePageMapping(
    binding: Pick<
      TeachingBinding,
      'robotProfileId' | 'toolProfileId' | 'screenProfileId'
    >,
  ) {
    return this.request<void>('prepare-mapping', { binding });
  }
}
