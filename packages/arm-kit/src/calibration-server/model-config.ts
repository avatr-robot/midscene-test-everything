import { type RobotArmAiRequest, RobotArmError } from '../contracts.js';

/** Validate a request-local override. Never mutate process-wide Agent settings. */
export function parseDetectionModel(
  value: unknown,
): RobotArmAiRequest['modelConfig'] | undefined {
  if (value === undefined) return undefined;
  const fields = ['modelName', 'modelFamily', 'baseUrl', 'apiKey'] as const;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RobotArmError(
      'INVALID_MODEL_CONFIG',
      'Invalid detection model settings',
      400,
    );
  const input = value as Record<string, unknown>;
  if (
    fields.some(
      (field) =>
        typeof input[field] !== 'string' ||
        (input[field] as string).length > 8192,
    ) ||
    !(input.modelName as string).trim() ||
    !(input.modelFamily as string).trim()
  )
    throw new RobotArmError(
      'INVALID_MODEL_CONFIG',
      'Provide a model name and family with string configuration fields',
      400,
    );
  return Object.fromEntries(
    fields.map((field) => [field, input[field]]),
  ) as RobotArmAiRequest['modelConfig'];
}
