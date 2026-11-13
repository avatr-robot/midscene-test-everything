// Ported from avatr-robot/midscene-private dev, commit
// 710f60809eac3dbe824f91a5cf8b3b0e72386282, calibration/auto-exploration.ts.
// Phone transport, persistence and motion ownership
// are supplied by the Arm Kit bridge; boundary verification remains in its workflow.
import { randomUUID } from 'node:crypto';
import {
  CALIBRATION_PHONE_POLICY,
  CALIBRATION_RELATIVE_SLACK,
} from '../../assisted-contracts.js';
import {
  type CalibrationProfile,
  type CartesianPose,
  RobotArmError,
} from '../../contracts.js';
import { contactPoint, dot, flangePose, rotate, unit } from '../../domain.js';
import {
  scaleAcceleration,
  scaleSpeed,
} from '../../screen-interaction/motion-policy.js';
import {
  type ScreenPoint2,
  affinePoint,
  fitAffine,
  screenFrame,
} from './geometry.js';
import { fitContactPlane, fitSamplePlane } from './plane.js';
import {
  type ApplicationContext,
  type AutoCalibrationProgress,
  type AutoExplorationHost,
  type AutoExplorationOptions,
  type CalibrationSession,
  type ProbePurpose,
  type ScreenCalibTarget,
  assertSameScreenPage,
} from './types.js';
// Coarse travel is fast; refine only the final no-touch/touch bracket.
const SEARCH_STEP_MM = 1;
const FAST_SEARCH_STEP_MM = 2;
const SEARCH_WAIT_MS = 100;
const FAST_SEARCH_WAIT_MS = 30;
const MAX_FAST_TILT_DEGREES = 5;
const MAX_FAST_HEIGHT_RANGE_MM = 6;
const MAX_FAST_PLANE_RMSE_MM = 0.5;
const MAX_FAST_HOLDOUT_MM = 1;
const MAX_PLANE_PROBE_DEPTH_MM = 8;
const PLANE_PROBE_APPROACH_MM = 2;
const PLANE_PROBE_MIN_DEPTH_MM = 4;
const PLANE_PROBE_MARGIN_MM = 1;
const PLANE_CORNER_RETRY_INSET_MM = 3;
const FAST_INSET_RETRIES = 3;
const PLANE_CORNER_MAX_BELOW_PREDICTED_MM = 2;
const PLANE_CORNER_NEAR_STEP_MM = 0.25;
const PLANE_CORNER_REPRESS_STEP_MM = 0.25;
const PLANE_CORNER_REPRESS_DRIFT_RATIO = 0.0075;
// Keep commands off the hard floor. Corner audit readbacks differed from
// commands by up to 0.000026 mm; this buffer is not an allowed overshoot.
const FAST_FLOOR_COMMAND_MARGIN_MM = 0.01;
const CONTACT_BRACKET_MM = 0.25;
// Release hysteresis can exceed 2 mm on compliant tools. Clearance is only a
// reset for a fresh downward probe, never a measurement of the screen surface.
const RELEASE_LIFT_MM = 4;
const RELEASE_RETRY_STEP_MM = 2;
const RELEASE_MAX_MM = 8;
const INITIAL_DESCENT_MM = 60;
const SEARCH_DESCENT_MM = 30;
const TOUCH_DESCENT_MM = 20;
/** Maximum depth below the first confirmed contact before a point is unsafe. */
const TOUCH_SAFETY_MARGIN_MM = 2;
const TOUCH_RETRY_ATTEMPTS = 1;
const SEARCH_PITCH_MM = 10;
const PROBE_MM = 10;
const FAST_PLANE_PROBE_MM = 15;
const APPROACH_LIFT_MM = 5;
const TRAVERSE_CLEARANCE_MM = 10;
// Exploration only needs a light press to keep page contact; pressing deeper
// deforms the screen and the stand and biases later validation samples.
const PRESS_MM = 0.5;
const DWELL_MS = 250;
const ACK_POLL_MS = 25;
const STANDARD_MOTION_FACTOR = 0.1;
const FAST_MOTION_FACTOR = 0.25;
const STANDARD_PRESS_FACTOR = 0.25;
const STEP_TIMEOUT_MS = 10000;
interface TouchPoint {
  pressedZ: number;
  heightIntervalMm?: [number, number];
  contact: { x: number; y: number; z: number };
  screen: ScreenPoint2;
  /** Reduced when the point needed a retry or hit the safety floor. */
  weight?: number;
}
interface GridTouch extends TouchPoint {
  target: ScreenCalibTarget;
}
/** Four distributed fit corners in diagonal order, then two held-out edge points. */
export function fastExplorationTargets(
  targets: ScreenCalibTarget[],
): ScreenCalibTarget[] {
  const xs = targets.map((target) => target.css.x);
  const ys = targets.map((target) => target.css.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (!(width > 0 && height > 0))
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Fast exploration requires distributed targets',
      409,
    );
  const fit = targets
    .filter((target) => target.role === 'fit')
    .sort(
      (a, b) =>
        ((b.css.x - cx) / width) ** 2 +
        ((b.css.y - cy) / height) ** 2 -
        ((a.css.x - cx) / width) ** 2 -
        ((a.css.y - cy) / height) ** 2,
    )
    .slice(0, 4);
  const validation = targets
    .filter((target) => target.role === 'validation')
    .slice(0, 2);
  if (fit.length !== 4 || validation.length !== 2)
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Fast exploration requires four fit corners and two validation targets',
      409,
    );
  fit.sort((a, b) => a.css.y - b.css.y || a.css.x - b.css.x);
  return [fit[0], fit[3], fit[1], fit[2], ...validation];
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isIntermittentContact(error: unknown): error is RobotArmError {
  return (
    error instanceof RobotArmError &&
    error.code === 'PHONE_TOUCH_UNSTABLE' &&
    error.details?.reason === 'intermittent_contact'
  );
}

function setPhase(
  host: AutoExplorationHost,
  session: CalibrationSession,
  progress: AutoCalibrationProgress,
) {
  if (!session.auto) return;
  session.auto.progress = progress;
  host.progress?.(session);
}
async function save(host: AutoExplorationHost, session: CalibrationSession) {
  await host.profileStore.saveSession(session, false, () => host.check());
}

export async function runAutoExploration(
  host: AutoExplorationHost,
  session: CalibrationSession,
  ctx: ApplicationContext,
  options: AutoExplorationOptions,
) {
  const fast = options.mode === 'fast-plane';
  if (
    (fast && options.compliantSetupConfirmed !== true) ||
    (options.collection === 'slide' && !fast)
  )
    throw new RobotArmError(
      'INVALID_ARGUMENT',
      'Fast exploration requires confirmation that the screen is secured and the tool has elastic compliance',
      400,
    );
  if (session.auto) {
    session.auto.mode = fast ? 'fast-plane' : 'standard';
    session.auto.collection = options.collection ?? 'tap';
    session.auto.compliantSetupConfirmed =
      options.compliantSetupConfirmed === true;
  }
  const start = options.startPose;
  const dwellMs = fast ? 100 : DWELL_MS;
  const searchStepMm = fast ? FAST_SEARCH_STEP_MM : SEARCH_STEP_MM;
  const searchWaitMs = fast ? FAST_SEARCH_WAIT_MS : SEARCH_WAIT_MS;
  ctx = { ...ctx, screen: { ...ctx.screen } };
  if (ctx.batchTransfer)
    ctx.minimumTravelTipZMm = Math.max(
      ctx.minimumTravelTipZMm ?? Number.NEGATIVE_INFINITY,
      ctx.batchTransfer.travelTipZMm,
    );
  const screen = ctx.screen;
  const tool = ctx.tool;
  const motionAtFactor = (factor: number) => ({
    speed: scaleSpeed(screen.actionSpeed, factor),
    acceleration: scaleAcceleration(screen.actionAcceleration, factor),
  });
  const moveOptions = motionAtFactor(
    fast ? FAST_MOTION_FACTOR : STANDARD_MOTION_FACTOR,
  );
  const pressOptions = fast
    ? moveOptions
    : motionAtFactor(STANDARD_PRESS_FACTOR);
  const poseAt = (contact: { x: number; y: number; z: number }) =>
    flangePose(contact, start.orientation, tool.offsetMm);
  const preflight = async (
    contact: { x: number; y: number; z: number },
    name: string,
    motion = moveOptions,
  ) => host.preflight([{ name, pose: poseAt(contact), options: motion }], ctx);
  const moveTo = async (
    contact: { x: number; y: number; z: number },
    motion = moveOptions,
  ) => {
    const pose = poseAt(contact);
    await assertPage();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let measured: CartesianPose | undefined;
    try {
      measured = await Promise.race([
        host.move(pose, ctx, motion.speed, motion.acceleration),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            Promise.resolve(host.stop?.()).catch(() => undefined);
            reject(
              new RobotArmError(
                'AUTO_MOVE_TIMEOUT',
                `The robot did not complete the step at Z ${contact.z.toFixed(1)} mm within ${STEP_TIMEOUT_MS / 1000} s; the automatic exploration was stopped`,
                504,
              ),
            );
          }, STEP_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    await host.stable(pose, ctx);
    return fast
      ? contactPoint(measured ?? (await host.currentPose()), tool.offsetMm)
      : contact;
  };

  const page = structuredClone(
    options.page ??
      (await host.screenCalib.findMappedSession(ctx.screen.visionTarget)),
  );
  if (
    screen.visionTarget &&
    (page.config?.cameraId !== screen.visionTarget.cameraId ||
      page.config.screenId !== screen.visionTarget.screenId)
  )
    throw new RobotArmError(
      'SCREEN_PAGE_REQUIRED',
      'The page does not belong to the selected screen',
      409,
    );
  if (
    !page.config ||
    page.config.pixelWidth !== screen.pixelWidth ||
    page.config.pixelHeight !== screen.pixelHeight
  )
    throw new RobotArmError(
      'SCREEN_SIZE_MISMATCH',
      'Page mapping pixel size does not match the selected Screen Profile',
      409,
    );
  const shortEdgePx = Math.min(page.config.pixelWidth, page.config.pixelHeight);
  if (!page.mapping)
    throw new RobotArmError(
      'SCREEN_PAGE_REQUIRED',
      'Build the page mapping before automatic exploration',
      409,
    );
  const mappingVersion = page.mapping.version;
  if (session.auto) session.auto.screenSessionId = page.id;
  await save(host, session);

  const assertPage = async () => {
    host.check();
    const current = await host.screenCalib.session(page.id);
    assertSameScreenPage(current, page);
    return current;
  };

  const recordSample = async (
    point: TouchPoint,
    role: 'probe' | 'fit' | 'validation',
    method: 'stepped' | 'slide',
  ) => {
    if (session.auto) {
      session.auto.collectedSamples ??= [];
      session.auto.collectedSamples.push({
        robot: { ...point.contact },
        pressedZMm: point.pressedZ,
        heightIntervalMm: point.heightIntervalMm,
        screen: { ...point.screen },
        role,
        method,
        weight: point.weight,
      });
      await save(host, session);
    }
  };
  const observeOnce = async (
    purpose: ProbePurpose,
    settleMs = searchWaitMs,
    allowBriefContactGaps?: boolean,
  ) => {
    await assertPage();
    const sampleId = `auto-${randomUUID()}`;
    const started = performance.now();
    await host.screenCalib.setSample(
      page.id,
      sampleId,
      purpose,
      settleMs,
      allowBriefContactGaps,
    );
    for (;;) {
      host.check();
      const current = await assertPage();
      const snapshot = current.sampleSnapshot;
      if (
        current.sampleId === sampleId &&
        snapshot?.sampleId === sampleId &&
        snapshot.mappingVersion === mappingVersion
      ) {
        if (
          snapshot.pointerCount > 1 ||
          (snapshot.pointerCount === 1 && !snapshot.screen)
        )
          throw new RobotArmError(
            'TOUCH_AMBIGUOUS',
            'Expected zero or one mapped touch',
            409,
          );
        return { sampleId, screen: snapshot.screen };
      }
      if (
        performance.now() - started >=
        CALIBRATION_PHONE_POLICY.stepAcknowledgementMs
      )
        throw new RobotArmError(
          'PHONE_STEP_TIMEOUT',
          'Phone step acknowledgement timed out. Touch at this position is unknown.',
          409,
          {
            sampleId,
            purpose,
            elapsedMs: Math.round(performance.now() - started),
          },
        );
      await delay(ACK_POLL_MS);
    }
  };
  const observe = async (
    purpose: ProbePurpose,
    settleMs = searchWaitMs,
    allowBriefContactGaps?: boolean,
  ) => {
    try {
      return await observeOnce(purpose, settleMs, allowBriefContactGaps);
    } catch (error) {
      if (
        !(error instanceof RobotArmError) ||
        error.code !== 'PHONE_STEP_TIMEOUT'
      )
        throw error;
      host.check();
      return observeOnce(purpose, settleMs, allowBriefContactGaps);
    }
  };
  const touchAt = async (
    x: number,
    y: number,
    zHigh: number,
    label: string,
    descentLimitMm = TOUCH_DESCENT_MM,
    skipApproach = false,
    safetyFloorZ?: number,
    cornerNearZ?: number,
  ): Promise<TouchPoint> => {
    const floor = Math.max(
      zHigh - descentLimitMm,
      safetyFloorZ ?? Number.NEGATIVE_INFINITY,
    );
    const commandFloor =
      fast && safetyFloorZ !== undefined
        ? floor + FAST_FLOOR_COMMAND_MARGIN_MM
        : floor;
    const checkDepth = (
      requestedTipZMm: number,
      probe: string,
      measuredTipZMm?: number,
    ) => {
      const z = measuredTipZMm ?? requestedTipZMm;
      const limit = measuredTipZMm === undefined ? commandFloor : floor;
      if (z < limit - 1e-6)
        throw new RobotArmError(
          'TOUCH_SAFETY_LIMIT',
          measuredTipZMm === undefined
            ? `Requested tip Z ${z.toFixed(6)} mm is below the command limit ${limit.toFixed(6)} mm (safety floor ${floor.toFixed(6)} mm)`
            : `Measured tip Z ${z.toFixed(6)} mm is below the safety floor ${floor.toFixed(6)} mm (requested ${requestedTipZMm.toFixed(6)} mm)`,
          409,
          {
            probe,
            stage: measuredTipZMm === undefined ? 'command' : 'readback',
            requestedTipZMm,
            measuredTipZMm,
            safetyFloorZMm: floor,
            commandFloorZMm: commandFloor,
            belowLimitMm: limit - z,
          },
        );
    };
    const probeAt = async (z: number, name: string, motion = moveOptions) => {
      checkDepth(z, name);
      await preflight({ x, y, z }, name, motion);
      const measured = await moveTo({ x, y, z }, motion);
      checkDepth(z, name, measured.z);
      return measured;
    };
    const releaseAtApproach = async () => {
      const released = await probeAt(zHigh, `${label} retry release`);
      if ((await observe('release')).screen)
        throw new RobotArmError(
          'TOUCH_NOT_RELEASED',
          'The touch did not release at the approach height',
          409,
        );
      return released;
    };
    const contactBetween = (
      clear: TouchPoint['contact'],
      touched: TouchPoint['contact'],
    ) => ({
      x: (clear.x + touched.x) / 2,
      y: (clear.y + touched.y) / 2,
      z: (clear.z + touched.z) / 2,
    });
    const assertInterval = (clearZ: number, touchedZ: number) => {
      if (clearZ <= touchedZ)
        throw new RobotArmError(
          'CALIBRATION_QUALITY',
          'Measured touch and no-touch heights do not define a contact interval',
          409,
          { label, clearZ, touchedZ },
        );
    };
    await assertPage();
    let approach = { x, y, z: zHigh };
    if (!skipApproach) {
      const current = contactPoint(await host.currentPose(), tool.offsetMm);
      const safeZ = Math.max(
        current.z + TRAVERSE_CLEARANCE_MM,
        zHigh,
        ctx.minimumTravelTipZMm ?? Number.NEGATIVE_INFINITY,
      );
      if (Math.hypot(current.x - x, current.y - y) > 0.2) {
        if (current.z < safeZ - 0.05)
          await moveTo({ x: current.x, y: current.y, z: safeZ });
        await moveTo({ x, y, z: safeZ });
      }
      // After a lost sliding endpoint, XY is already correct but the tip is
      // still down. Establish release before reacquiring this same point.
      await preflight({ x, y, z: zHigh }, `${label} approach`);
      approach = await moveTo({ x, y, z: zHigh });
    } else if (fast) {
      approach = contactPoint(await host.currentPose(), tool.offsetMm);
    }
    let lastProbeZMm: number | undefined;
    for (let attempt = 0; attempt <= TOUCH_RETRY_ATTEMPTS; attempt++) {
      if (attempt > 0) approach = await moveTo({ x, y, z: zHigh });
      // A held pointer must release before another descent, even on retry.
      if ((await observe('release')).screen)
        throw new RobotArmError(
          'TOUCH_NOT_RELEASED',
          'The touch did not release at the approach height',
          409,
        );
      const heights: number[] = [];
      let coarseSteps = 0;
      if (attempt > 0 && cornerNearZ !== undefined) {
        // Retry from the confirmed release height in one move to the same limit.
        if (commandFloor < zHigh - 1e-6) heights.push(commandFloor);
      } else {
        const nearZ = Math.max(
          commandFloor,
          Math.min(cornerNearZ ?? commandFloor, zHigh),
        );
        for (let z = zHigh - searchStepMm; z > nearZ + 1e-6; z -= searchStepMm)
          heights.push(z);
        coarseSteps = heights.length;
        if (nearZ < zHigh - 1e-6) heights.push(nearZ);
        for (
          let z = nearZ - PLANE_CORNER_NEAR_STEP_MM;
          z > commandFloor + 1e-6;
          z -= PLANE_CORNER_NEAR_STEP_MM
        )
          heights.push(z);
        if (nearZ > commandFloor + 1e-6) heights.push(commandFloor);
      }
      let lastClear = approach;
      const reportProbe = (
        kind: 'search' | 'release' | 'refine' | 'press',
        z: number,
        snapshot: Awaited<ReturnType<typeof observe>>,
      ) =>
        setPhase(host, session, {
          phase: 'search',
          index: kind === 'search' ? zHigh - z : 0,
          total: descentLimitMm,
          sampleId: snapshot.sampleId,
          probeZMm: z,
          touching: Boolean(snapshot.screen),
          message: `${label}${kind === 'search' ? '' : ` · ${kind}`}${attempt ? ' · retry' : ''}`,
        });
      for (const [index, z] of heights.entries()) {
        let measured = await probeAt(z, `${label} search`);
        const purpose =
          index === heights.length - 1
            ? 'search-limit'
            : fast && index < coarseSteps
              ? 'coarse-search'
              : 'search';
        let touched: Awaited<ReturnType<typeof observe>> | undefined;
        try {
          touched = await observe(purpose, searchWaitMs);
        } catch (error) {
          if (cornerNearZ === undefined || !isIntermittentContact(error))
            throw error;

          await delay(CALIBRATION_PHONE_POLICY.heartbeatMs);
          try {
            touched = await observe(purpose);
          } catch (recheckError) {
            if (!isIntermittentContact(recheckError)) throw recheckError;
          }
          if (!touched?.screen) {
            lastClear = await releaseAtApproach();
            measured = await probeAt(z, `${label} same-height retry`);
            touched = await observe(
              purpose,
              CALIBRATION_PHONE_POLICY.heartbeatMs,
            );
            // Absence after an intermittent contact cannot justify going deeper.
            if (!touched.screen) throw error;
          }
        }
        reportProbe('search', measured.z, touched);
        lastProbeZMm = measured.z;
        if (!touched.screen) {
          lastClear = measured;
          continue;
        }
        const weight = attempt
          ? 0.5
          : safetyFloorZ !== undefined && z <= safetyFloorZ + 1e-6
            ? 0.7
            : 1;
        // A tool can keep reporting touch well above its downward activation
        // height. Reset that held pointer before testing a shallower depth.
        const release = async (touchZ: number) => {
          for (
            let upZ = touchZ + RELEASE_LIFT_MM;
            upZ <= touchZ + RELEASE_MAX_MM + 1e-6;
            upZ += RELEASE_RETRY_STEP_MM
          ) {
            await preflight({ x, y, z: upZ }, `${label} release`);
            await moveTo({ x, y, z: upZ });
            const snapshot = await observe('release');
            reportProbe('release', upZ, snapshot);
            if (!snapshot.screen) return;
          }
          throw new RobotArmError(
            'TOUCH_RELEASE_NOT_FOUND',
            'No confirmed release within the height probe; stopped instead of reusing a deep press',
            409,
          );
        };
        let touchingPoint = measured;
        let touchingScreen = touched.screen;
        let upperPoint = lastClear;
        if (fast) assertInterval(upperPoint.z, touchingPoint.z);
        let pointerHeld = true;
        let heldZ = measured.z;
        let unchangedSteps = 0;
        // All refinement targets stay inside the original coarse bracket. A
        // touching midpoint must release before the next trial; otherwise an
        // upward midpoint would measure hysteresis instead of activation.
        while (upperPoint.z - touchingPoint.z > CONTACT_BRACKET_MM + 1e-6) {
          if (pointerHeld) await release(heldZ);
          const midZ = Math.max(
            commandFloor,
            (upperPoint.z + touchingPoint.z) / 2,
          );
          const midpoint = await probeAt(midZ, `${label} refine`);
          let snapshot: Awaited<ReturnType<typeof observe>> | undefined;
          try {
            snapshot = await observe('refine');
          } catch (error) {
            if (!fast || !isIntermittentContact(error)) throw error;
          }
          if (snapshot) reportProbe('refine', midpoint.z, snapshot);
          const stableTouch = Boolean(snapshot?.screen);
          // An intermittent midpoint bounds stable activation from above.
          // Confirm release before probing deeper toward the known touch.
          pointerHeld = stableTouch || !snapshot;
          heldZ = midpoint.z;
          if (fast) {
            if (stableTouch) assertInterval(upperPoint.z, midpoint.z);
            else assertInterval(midpoint.z, touchingPoint.z);
            if (
              midpoint.z <= touchingPoint.z + 1e-6 ||
              midpoint.z >= upperPoint.z - 1e-6
            ) {
              if (++unchangedSteps >= 2) {
                if (pointerHeld) await release(heldZ);
                throw new RobotArmError(
                  'CALIBRATION_QUALITY',
                  'Measured probe steps could not narrow the contact interval to 0.25 mm',
                  409,
                  {
                    label,
                    heightIntervalMm: [touchingPoint.z, upperPoint.z],
                  },
                );
              }
              continue;
            }
          }
          unchangedSteps = 0;
          if (snapshot?.screen) {
            touchingPoint = midpoint;
            touchingScreen = snapshot.screen;
          } else upperPoint = midpoint;
        }
        // Even a short bracket needs one confirmed release; a coarse hit is
        // never accepted on the strength of a pointer that stayed held.
        if (pointerHeld) await release(heldZ);
        const contact = contactBetween(upperPoint, touchingPoint);
        let pressedZ =
          cornerNearZ === undefined
            ? contact.z - PRESS_MM
            : Math.max(commandFloor, touchingPoint.z);
        checkDepth(pressedZ, `${label} press`);
        let pressed: Awaited<ReturnType<typeof observe>> | undefined;
        let measuredPressedZ = pressedZ;
        let pressRetried = false;
        let intermittentPress: RobotArmError | undefined;
        for (
          let pressAttempt = 0;
          pressAttempt <= TOUCH_RETRY_ATTEMPTS;
          pressAttempt++
        ) {
          if (pressAttempt) {
            if (cornerNearZ !== undefined) {
              const retryZ = Math.max(
                commandFloor,
                pressedZ - PLANE_CORNER_REPRESS_STEP_MM,
              );
              if (retryZ >= pressedZ - 1e-6) break;
              await releaseAtApproach();
              pressedZ = retryZ;
            } else await release(measuredPressedZ);
            pressRetried = true;
          }
          const press = await probeAt(pressedZ, `${label} press`, pressOptions);
          measuredPressedZ = press.z;
          pressed = undefined;
          try {
            pressed = await observe(
              'press',
              dwellMs,
              cornerNearZ !== undefined,
            );
          } catch (error) {
            if (cornerNearZ === undefined || !isIntermittentContact(error))
              throw error;
            intermittentPress = error;
            continue;
          }
          reportProbe('press', measuredPressedZ, pressed);
          if (pressed.screen) break;
        }
        if (!pressed?.screen)
          throw new RobotArmError(
            'TOUCH_CONTACT_LOST',
            `The refined press at Z ${pressedZ.toFixed(2)} mm did not produce a confirmed touch within the available press depth`,
            409,
            cornerNearZ === undefined
              ? undefined
              : {
                  ...intermittentPress?.details,
                  cornerPressUnconfirmed: true,
                  confirmedNoTouch: pressed !== undefined,
                  lastProbeZMm: measuredPressedZ,
                  commandFloorZMm: commandFloor,
                  pressRetried,
                },
          );
        if (cornerNearZ !== undefined && pressRetried) {
          const driftPx = Math.hypot(
            pressed.screen.x - touchingScreen.x,
            pressed.screen.y - touchingScreen.y,
          );
          const maxDriftPx =
            Math.max(1, shortEdgePx * PLANE_CORNER_REPRESS_DRIFT_RATIO) *
            (1 + CALIBRATION_RELATIVE_SLACK);
          if (driftPx > maxDriftPx)
            throw new RobotArmError(
              'CALIBRATION_QUALITY',
              'The recovered corner touch shifted from its refined position',
              409,
              { label, driftPx, maxDriftPx, pressedZMm: measuredPressedZ },
            );
        }
        return {
          contact,
          pressedZ: measuredPressedZ,
          heightIntervalMm: fast ? [touchingPoint.z, upperPoint.z] : undefined,
          screen: pressed.screen,
          weight: pressRetried ? 0.5 : weight,
        };
      }
    }
    const atSafetyFloor = safetyFloorZ !== undefined && floor === safetyFloorZ;
    throw new RobotArmError(
      atSafetyFloor ? 'TOUCH_SAFETY_LIMIT' : 'TOUCH_NOT_FOUND',
      atSafetyFloor
        ? `No page touch before the safety floor ${floor.toFixed(1)} mm`
        : `No screen touch at (${x.toFixed(1)}, ${y.toFixed(1)}) mm`,
      409,
      {
        confirmedNoTouch: true,
        ...(fast && { lastProbeZMm }),
        ...(atSafetyFloor && {
          safetyFloorZMm: floor,
          commandFloorZMm: commandFloor,
        }),
      },
    );
  };

  setPhase(host, session, {
    phase: 'preflight',
    index: 0,
    total: 1,
    message: 'Finding the screen',
  });
  // Require the current phone protocol before submitting the first motion.
  await observe('preflight', 0);
  const startContact = contactPoint(start, tool.offsetMm);
  let first: TouchPoint | undefined;
  try {
    first = await touchAt(
      startContact.x,
      startContact.y,
      startContact.z,
      'Initial touch',
      INITIAL_DESCENT_MM,
      true,
    );
  } catch (error) {
    if (!(error instanceof RobotArmError) || error.code !== 'TOUCH_NOT_FOUND')
      throw error;
    for (let row = -2; row <= 2 && !first; row++)
      for (let column = -2; column <= 2 && !first; column++) {
        if (row === 0 && column === 0) continue;
        try {
          first = await touchAt(
            startContact.x + column * SEARCH_PITCH_MM,
            startContact.y + row * SEARCH_PITCH_MM,
            startContact.z,
            'Search touch',
            SEARCH_DESCENT_MM,
            false,
          );
        } catch (searchError) {
          if (
            !(searchError instanceof RobotArmError) ||
            searchError.code !== 'TOUCH_NOT_FOUND'
          )
            throw searchError;
        }
      }
  }
  if (!first)
    throw new RobotArmError(
      'TOUCH_NOT_FOUND',
      'No screen touch was found within the search area; place the stylus closer to the centre and retry',
      409,
    );
  // Bound later probes relative to the confirmed light press, and apply the
  // same floor to both search and final press targets.
  const safetyFloorZ = first.pressedZ - TOUCH_SAFETY_MARGIN_MM;

  setPhase(host, session, {
    phase: 'probe',
    operation: 'travel',
    index: 1,
    total: 3,
    message: 'Measuring touch direction',
  });
  const probeZ = first.contact.z + APPROACH_LIFT_MM;
  const probes: TouchPoint[] = [first];
  await recordSample(first, 'probe', 'stepped');
  const probeDistance = fast ? FAST_PLANE_PROBE_MM : PROBE_MM;
  for (const [dx, dy, label] of [
    [probeDistance, 0, 'Probe +X'],
    [0, probeDistance, 'Probe +Y'],
  ] as const) {
    const probe = await touchAt(
      first.contact.x + dx,
      first.contact.y + dy,
      probeZ,
      label,
      TOUCH_DESCENT_MM,
      false,
      safetyFloorZ,
    );
    probes.push(probe);
    await recordSample(probe, 'probe', 'stepped');
  }
  const initialAffine = fitAffine(
    probes.map((probe) => ({ x: probe.contact.x, y: probe.contact.y })),
    probes.map((probe) => probe.screen),
  );
  const initialFrame = screenFrame(initialAffine, screen);
  const targets = await host.screenCalib.targets(page.id);
  if (targets.mappingVersion !== mappingVersion)
    throw new RobotArmError(
      'SCREEN_PAGE_REQUIRED',
      'Page mapping changed before sampling',
      409,
    );

  const grid: GridTouch[] = [];
  if (fast) {
    const preferred = unit(rotate(start.orientation, tool.contactDirection));
    const targetsInOrder = fastExplorationTargets(targets.targets);
    const corners = targetsInOrder.slice(0, 4);
    const validationTargets = targetsInOrder.slice(4);
    // The same three contacts establish the XY map and the initial plane.
    const measured = probes.map((probe) => probe.contact);
    const heightAt = (
      plane: CalibrationProfile['plane'],
      x: number,
      y: number,
    ) => {
      if (Math.abs(plane.normal.z) < 1e-6)
        throw new RobotArmError(
          'CALIBRATION_QUALITY',
          'Screen plane must support vertical probing',
          409,
        );
      return (
        (plane.offset - plane.normal.x * x - plane.normal.y * y) /
        plane.normal.z
      );
    };
    const probeWithInsetRetries = async (
      { x, y }: ScreenPoint2,
      probe: (point: ScreenPoint2, inset: boolean) => Promise<TouchPoint>,
      accepts: (touch: TouchPoint) => boolean,
    ) => {
      const dx = first.contact.x - x;
      const dy = first.contact.y - y;
      const distance = Math.hypot(dx, dy);
      const retries = Math.min(
        FAST_INSET_RETRIES,
        Math.max(0, Math.ceil(distance / PLANE_CORNER_RETRY_INSET_MM) - 1),
      );
      for (let attempt = 0; ; attempt++) {
        const fraction =
          attempt === 0
            ? 0
            : (attempt * PLANE_CORNER_RETRY_INSET_MM) / distance;
        try {
          const touch = await probe(
            { x: x + dx * fraction, y: y + dy * fraction },
            attempt > 0,
          );
          if (accepts(touch) || attempt === retries) return touch;
        } catch (error) {
          if (
            attempt === retries ||
            !(error instanceof RobotArmError) ||
            error.details?.confirmedNoTouch !== true
          )
            throw error;
        }
      }
    };
    let holdoutHeightMm = 0;
    for (const [index, target] of corners.entries()) {
      setPhase(host, session, {
        phase: 'grid',
        operation: 'travel',
        index: index + 1,
        total: targetsInOrder.length,
        message: 'Measuring the screen plane',
      });
      const plane = fitSamplePlane(measured, preferred);
      const { x, y } = affinePoint(initialFrame.inverse, target.screen);
      const predicted = heightAt(plane, x, y);
      const nearest = Math.min(
        ...measured.map((point) => Math.hypot(point.x - x, point.y - y)),
      );
      const depth = Math.min(
        MAX_PLANE_PROBE_DEPTH_MM,
        Math.max(
          PLANE_PROBE_MIN_DEPTH_MM,
          Math.tan((MAX_FAST_TILT_DEGREES * Math.PI) / 180) * nearest +
            PLANE_PROBE_MARGIN_MM,
        ),
      );
      const highest = Math.max(...measured.map((point) => point.z));
      const lowest = Math.min(...measured.map((point) => point.z));
      // Keep the start and floor inside the envelope established by real contacts.
      const approach =
        lowest + MAX_FAST_HEIGHT_RANGE_MM + PLANE_PROBE_APPROACH_MM;
      const envelopeFloor =
        highest - MAX_FAST_HEIGHT_RANGE_MM - PLANE_PROBE_MARGIN_MM;
      const depthFloor = predicted - depth;
      const misses: Record<string, unknown>[] = [];
      const probeCorner = async (point: ScreenPoint2, inset: boolean) => {
        const pointPredicted = heightAt(plane, point.x, point.y);
        const localFloor = pointPredicted - PLANE_CORNER_MAX_BELOW_PREDICTED_MM;
        const probeFloor = Math.max(envelopeFloor, depthFloor, localFloor);
        const label = `Plane ${target.id}${inset ? ' inset retry' : ''}`;
        try {
          return await touchAt(
            point.x,
            point.y,
            approach,
            label,
            approach - probeFloor,
            false,
            probeFloor,
            Math.max(
              pointPredicted + PLANE_PROBE_APPROACH_MM,
              highest + PLANE_PROBE_MARGIN_MM,
            ),
          );
        } catch (error) {
          if (
            !(error instanceof RobotArmError) ||
            (error.details?.confirmedNoTouch !== true &&
              error.details?.cornerPressUnconfirmed !== true)
          )
            throw error;
          misses.push({
            ...error.details,
            point,
            inset,
            predictedZMm: pointPredicted,
            envelopeFloorZMm: envelopeFloor,
            depthFloorZMm: depthFloor,
            localFloorZMm: localFloor,
            probeFloorZMm: probeFloor,
          });
          throw new RobotArmError(
            error.code,
            error.details?.cornerPressUnconfirmed === true
              ? `Fast calibration point ${index + 1} did not sustain touch within the safe depth`
              : `No touch detected at fast calibration point ${index + 1} within the safe depth`,
            error.status,
            { ...error.details, target: target.css, cornerProbes: [...misses] },
          );
        }
      };
      const touch = await probeWithInsetRetries(
        { x, y },
        probeCorner,
        ({ contact }) => {
          if (index !== corners.length - 1) return true;
          holdoutHeightMm = Math.abs(
            heightAt(plane, contact.x, contact.y) - contact.z,
          );
          return holdoutHeightMm <= MAX_FAST_HOLDOUT_MM;
        },
      );
      measured.push(touch.contact);
      grid.push({ ...touch, target });
      await recordSample(touch, 'fit', 'stepped');
      await save(host, session);
    }
    const fitted = fitContactPlane(measured, preferred, {});
    const tiltDeg =
      (Math.acos(
        Math.min(1, Math.max(-1, dot(fitted.plane.normal, preferred))),
      ) *
        180) /
      Math.PI;
    const heights = targetsInOrder.map((target) => {
      const { x, y } = affinePoint(initialFrame.inverse, target.screen);
      return heightAt(fitted.plane, x, y);
    });
    const heightRangeMm = Math.max(...heights) - Math.min(...heights);
    if (tiltDeg > MAX_FAST_TILT_DEGREES)
      throw new RobotArmError(
        'SCREEN_TILT_UNSUPPORTED',
        `Fast calibration measured ${tiltDeg.toFixed(2)} degrees (limit ${MAX_FAST_TILT_DEGREES})`,
        422,
        { tiltDeg },
      );
    if (
      heightRangeMm > MAX_FAST_HEIGHT_RANGE_MM ||
      fitted.quality.rmseMm > MAX_FAST_PLANE_RMSE_MM ||
      holdoutHeightMm > MAX_FAST_HOLDOUT_MM
    )
      throw new RobotArmError(
        'CALIBRATION_QUALITY',
        `Fast plane: height range ${heightRangeMm.toFixed(2)}/${MAX_FAST_HEIGHT_RANGE_MM} mm, RMSE ${fitted.quality.rmseMm.toFixed(2)}/${MAX_FAST_PLANE_RMSE_MM} mm, holdout error ${holdoutHeightMm.toFixed(2)}/${MAX_FAST_HOLDOUT_MM} mm`,
        409,
        { heightRangeMm, holdoutHeightMm },
      );

    const slide = options.collection === 'slide';
    const measuredValidation: TouchPoint[] = [];
    for (const [index, target] of validationTargets.entries()) {
      const slideToTarget = slide && index > 0;
      const started = performance.now();
      setPhase(host, session, {
        phase: 'grid',
        operation: slideToTarget ? 'slide' : 'travel',
        index: corners.length + index + 1,
        total: targetsInOrder.length,
        message: 'Sampling the validation points',
      });
      const { x, y } = affinePoint(initialFrame.inverse, target.screen);
      const predicted = heightAt(fitted.plane, x, y);
      const pressedZ = predicted - PRESS_MM;
      let touch: TouchPoint | undefined;
      if (slideToTarget) {
        await assertPage();
        await preflight({ x, y, z: pressedZ }, 'Plane sliding endpoint');
        const measured = await moveTo({ x, y, z: pressedZ });
        // Snapshot the active pointer only after the arm stops at the endpoint.
        const { screen: touched } = await observe('slide', dwellMs);
        if (touched)
          touch = {
            contact: {
              x: measured.x,
              y: measured.y,
              z: heightAt(fitted.plane, measured.x, measured.y),
            },
            pressedZ: measured.z,
            screen: touched,
            weight: 0.5,
          };
      }
      const method = touch ? 'slide' : 'stepped';
      if (!touch) {
        const probeValidation = async (point: ScreenPoint2, inset = false) => {
          const pointZ = heightAt(fitted.plane, point.x, point.y);
          const approach = pointZ + APPROACH_LIFT_MM;
          const floor = Math.max(
            pressedZ - TOUCH_SAFETY_MARGIN_MM,
            pointZ - PRESS_MM - TOUCH_SAFETY_MARGIN_MM,
          );
          return touchAt(
            point.x,
            point.y,
            approach,
            `Grid ${target.id}${inset ? ' inset retry' : ''}`,
            approach - floor,
            false,
            floor,
          );
        };
        const measureHeight = ({ contact }: TouchPoint) => {
          const predictedZMm = heightAt(fitted.plane, contact.x, contact.y);
          return {
            predictedZMm,
            heightErrorMm: Math.abs(contact.z - predictedZMm),
          };
        };
        touch = await probeWithInsetRetries(
          { x, y },
          probeValidation,
          (sample) =>
            measureHeight(sample).heightErrorMm <= MAX_FAST_HOLDOUT_MM,
        );
        const { predictedZMm, heightErrorMm } = measureHeight(touch);
        if (index === 0 && touch.heightIntervalMm && session.auto) {
          const [lower, upper] = touch.heightIntervalMm;
          session.auto.independentHeightCheck = {
            predictedZMm,
            heightIntervalMm: touch.heightIntervalMm,
            errorMm: heightErrorMm,
            predictionInInterval:
              lower <= predictedZMm && predictedZMm <= upper,
            elapsedMs: Math.round(performance.now() - started),
          };
        }
        if (heightErrorMm > MAX_FAST_HOLDOUT_MM)
          throw new RobotArmError(
            'CALIBRATION_QUALITY',
            `Fast validation touch differs from the plane by ${heightErrorMm.toFixed(2)} mm (limit ${MAX_FAST_HOLDOUT_MM} mm)`,
            409,
            {
              heightErrorMm,
              independentHeightCheck: session.auto?.independentHeightCheck,
            },
          );
        measuredValidation.push(touch);
      }
      grid.push({ ...touch, target });
      await recordSample(touch, 'validation', method);
      await save(host, session);
    }
    return {
      probes,
      grid,
      start,
      screen,
      fastPlane: {
        ...fitted,
        tiltDeg,
        heightRangeMm,
        holdoutHeightMm,
        independentHeightCheck: session.auto?.independentHeightCheck,
        measuredValidation,
      },
    };
  }

  const gridZ =
    Math.max(...probes.map((probe) => probe.contact.z)) + APPROACH_LIFT_MM;
  for (const [index, target] of targets.targets.entries()) {
    setPhase(host, session, {
      phase: 'grid',
      operation: 'travel',
      index: index + 1,
      total: targets.targets.length,
      message: 'Sampling the screen',
    });
    const { x, y } = affinePoint(initialFrame.inverse, target.screen);
    try {
      const touch = await touchAt(
        x,
        y,
        gridZ,
        `Grid ${target.id}`,
        TOUCH_DESCENT_MM,
        false,
        safetyFloorZ,
      );
      grid.push({ ...touch, target });
      await recordSample(touch, target.role, 'stepped');
    } catch (error) {
      if (
        !(error instanceof RobotArmError) ||
        error.code !== 'TOUCH_NOT_FOUND' ||
        target.role !== 'validation'
      )
        throw error;
    }
    await save(host, session);
  }
  if (grid.length < 5)
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Fewer than five grid touches were collected',
      409,
    );
  const validationGrid = grid.filter(
    (point) => point.target.role === 'validation',
  );
  if (validationGrid.length < 2)
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Fewer than two validation touches were collected',
      409,
    );

  return { probes, grid, start, screen };
}
