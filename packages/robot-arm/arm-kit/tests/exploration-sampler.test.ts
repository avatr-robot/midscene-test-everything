// Ported upstream simulation scenarios; acceptance is tested separately in Arm Kit.
import { describe, expect, it } from '@rstest/core';
import { fitExploration } from '../src/calibration/exploration/fit.js';
import { runAutoExploration } from '../src/calibration/exploration/sampler.js';
import type {
  ApplicationContext,
  AutoExplorationHost,
  CalibrationSession,
  SlideRecovery,
} from '../src/calibration/exploration/types.js';

import {
  type CartesianPose,
  type MotionAcceleration,
  type MotionSpeed,
  RobotArmError,
} from '../src/contracts.js';
import { contactPoint } from '../src/domain.js';
import {
  scaleAcceleration,
  scaleSpeed,
} from '../src/screen-interaction/motion-policy.js';
import { fixture, pose } from './fixtures.js';

describe('first-time automatic exploration', () => {
  it.each([
    'standard',
    'standard-tilt',
    'standard-floor-press',
    'fast-local-recovery',
    'fast-tap',
    'fast-slide',
    'fast-reference-fallback-slide',
    'fast-refine-stalled',
    'fast-adaptive-slide',
    'fast-corner-slide',
    'fast-intermittent-height-slide',
    'fast-return-height-slide',
    'fast-previous-height-slide',
    'fast-vertical-fallback-slide',
    'fast-floor-recovery-slide',
    'fast-extended-recovery-slide',
    'fast-recovery-no-touch-slide',
    'fast-recovery-budget-slide',
    'fast-hysteresis',
    'fast-offset-hysteresis',
    'fast-reported-failure',
    'fast-tilt-audit',
    'press-recovers',
    'bad-validation',
    'fast-no-touch',
    'fast-delayed',
    'initial-touch-offset',
    'release-missing',
    'repress-missing',
    'snapshot-missing',
    'snapshot-stale',
    'safety-floor',
  ])(
    'explores with %s and preserves independent acceptance',
    async (mode) => {
      const f = await fixture();
      const page = {
        id: 'page',
        connected: true,
        display: { width: 400, height: 800, visible: true },
        config: { pixelWidth: 1000, pixelHeight: 500 },
        mapping: { version: 1, displayKey: 'display' },
        cursor: 0,
        sampleId: undefined as string | undefined,
        sampleAcked: false,
        sampleSnapshot: undefined as
          | undefined
          | {
              sampleId: string;
              mappingVersion: number;
              pointerCount: number;
              screen: { x: number; y: number } | null;
            },
      };
      const startZ = mode === 'fast-reported-failure' ? -194.62645 : 60;
      const activationZ =
        mode === 'fast-reported-failure'
          ? -202.37645
          : mode === 'fast-offset-hysteresis' || mode === 'press-recovers'
            ? 30.7
            : 30;
      const releaseZ =
        mode === 'fast-reported-failure'
          ? -200.12645
          : mode.includes('hysteresis')
            ? activationZ + 2.5
            : mode === 'fast-adaptive-slide'
              ? activationZ + 0.15
              : activationZ;
      let previousHeld = false;
      let missedPressZ: number | undefined;
      let coarseTouchZ: number | undefined;
      let firstSlideTouchZ: number | undefined;
      const referenceFallback = mode === 'fast-reference-fallback-slide';
      const testReferenceTouch = mode === 'fast-slide' || referenceFallback;
      const firstTouchRecorded = new Error('First touch recorded');
      const firstSlidePresses: Array<{
        fromZ: number;
        toZ: number;
        touching: boolean;
      }> = [];
      let motionCountAfterRetry: number | undefined;
      let contact: { x: number; y: number; z: number } | undefined;
      let touching = false;
      let releaseProbeStarted = false;
      let repressing = false;
      let delayedUntil = 0;
      let delayedOnce = false;
      let delayedMoveCount = 0;
      const motions: CartesianPose[] = [];
      let actualPose = pose(100, -50, startZ);
      const finishedSampling = false;
      let missedSlide = false;
      const gridPressHeights: number[] = [];
      let gridPressReleased = false;
      const auditPressHeights: number[] = [];
      let auditPressReleased = false;
      const confirmedSweeps = new Set<string>();
      const heightSweeps: Array<{ z: number; touching: boolean }> = [];
      const gridStarted = new Error('Reached the sampling grid');
      const usePreviousHeight = mode === 'fast-previous-height-slide';
      const testHeightReturn =
        usePreviousHeight || mode === 'fast-return-height-slide';
      const slideRecoveries: SlideRecovery[] = [];
      const slideEndpoints = new Map<number, { x: number; y: number }>();
      let refining = false;
      let lowestZ = Number.POSITIVE_INFINITY;
      const isFast = !mode.startsWith('standard') && mode !== 'safety-floor';
      const slides = mode.endsWith('slide');
      const tilted = mode === 'standard-tilt';
      const slopeX = tilted ? 0.015 : 0;
      const pagePixel = () =>
        contact && touching
          ? {
              x: (contact.x / 200) * 999,
              y: (-contact.y / 100) * 499,
            }
          : null;
      const targets = [
        [0, 0],
        [0, 1],
        [0, 2],
        [1, 0],
        [1, 1],
        [1, 2],
        [2, 0],
        [2, 1],
        [2, 2],
      ].map(([row, column]) => {
        const x = [100, 500, 900][column];
        const y = [50, 250, 450][row];
        return {
          id: `grid-${row}-${column}`,
          role:
            (row === 1 && (column === 0 || column === 2)) ||
            (row === 2 && column === 1)
              ? ('validation' as const)
              : ('fit' as const),
          css: { x: x / 2.5, y: y / 2 },
          screen: { x, y },
        };
      });
      const screenCalib = {
        findMappedSession: async () => ({ ...page }),
        session: async () => {
          if (Date.now() < delayedUntil)
            expect(motions).toHaveLength(delayedMoveCount);
          return {
            ...page,
            sampleSnapshot:
              mode === 'snapshot-missing' || Date.now() < delayedUntil
                ? undefined
                : mode === 'snapshot-stale' && page.sampleSnapshot
                  ? { ...page.sampleSnapshot, sampleId: 'old-height' }
                  : page.sampleSnapshot,
          };
        },
        setSample: async (_id: string, sampleId: string, purpose: string) => {
          let screen = pagePixel();
          if (testReferenceTouch && !session.auto?.collectedSamples?.length) {
            if (purpose === 'coarse-search' && screen)
              firstSlideTouchZ = contactPoint(
                motions.at(-1)!,
                f.tool.offsetMm,
              ).z;
            if (purpose === 'press') {
              const toZ = contactPoint(motions.at(-1)!, f.tool.offsetMm).z;
              const lastPress = firstSlidePresses.at(-1);
              const priorPress = firstSlidePresses.at(-2);
              if (
                referenceFallback &&
                lastPress?.touching === false &&
                priorPress?.touching &&
                priorPress.toZ === toZ
              )
                screen = null;
              firstSlidePresses.push({
                fromZ: contactPoint(motions.at(-2)!, f.tool.offsetMm).z,
                toZ,
                touching: Boolean(screen),
              });
            }
          }
          if (
            testHeightReturn &&
            purpose === 'slide' &&
            session.auto?.progress?.phase === 'height' &&
            session.auto.progress.index === 1 &&
            contact
          ) {
            const firstMiss = heightSweeps.findIndex(
              (sample) => !sample.touching,
            );
            if (
              usePreviousHeight &&
              firstMiss > 0 &&
              heightSweeps[firstMiss - 1].z === contact.z
            )
              screen = null;
            heightSweeps.push({ z: contact.z, touching: Boolean(screen) });
          }
          if (mode === 'fast-vertical-fallback-slide' && purpose === 'slide') {
            const progress = session.auto?.progress;
            expect(progress?.phase).toBe('height');
            if (progress && contact)
              slideEndpoints.set(progress.index, {
                x: contact.x,
                y: contact.y,
              });
            screen = null;
          }
          const firstAudit = slideEndpoints.get(1);
          if (
            mode === 'fast-vertical-fallback-slide' &&
            firstAudit &&
            contact &&
            Math.hypot(contact.x - firstAudit.x, contact.y - firstAudit.y) <
              1e-6
          ) {
            if (
              purpose === 'release' &&
              auditPressHeights.length === 1 &&
              !screen
            )
              auditPressReleased = true;
            if (purpose === 'press') {
              auditPressHeights.push(contact.z);
              if (auditPressHeights.length === 1) screen = null;
            }
          }
          if (
            mode === 'fast-intermittent-height-slide' &&
            purpose === 'slide' &&
            session.auto?.progress?.phase === 'height' &&
            screen &&
            contact
          ) {
            const position = `${contact.x},${contact.y},${contact.z}`;
            if (confirmedSweeps.has(position) && !missedSlide) {
              missedSlide = true;
              screen = null;
            }
            confirmedSweeps.add(position);
          }
          if (
            mode === 'fast-adaptive-slide' &&
            purpose === 'slide' &&
            session.auto?.progress?.phase === 'grid' &&
            !missedSlide
          ) {
            missedSlide = true;
            screen = null;
          }
          if (
            mode === 'fast-corner-slide' &&
            purpose === 'slide' &&
            session.auto?.progress?.phase === 'grid' &&
            session.auto.progress.index === 1
          )
            screen = null;
          if (
            mode === 'fast-extended-recovery-slide' &&
            contact &&
            contact.x < 25 &&
            contact.y > -15
          ) {
            if (
              purpose === 'release' &&
              gridPressHeights.length === 1 &&
              !screen
            )
              gridPressReleased = true;
            if (purpose === 'press') {
              gridPressHeights.push(contact.z);
              if (gridPressHeights.length === 1)
                throw new RobotArmError(
                  'PHONE_TOUCH_UNSTABLE',
                  'Contact changed during the grid press',
                  409,
                  { reason: 'intermittent_contact' },
                );
            }
          }
          if (
            mode === 'press-recovers' &&
            motionCountAfterRetry === undefined &&
            finalPressCount <= 2 &&
            contact
          ) {
            if (purpose === 'coarse-search' && screen && finalPressCount === 0)
              coarseTouchZ = contact.z;
            if (purpose === 'press') {
              if (finalPressCount === 1) {
                missedPressZ = contact.z;
                screen = null;
              } else if (contact.z !== coarseTouchZ) screen = null;
              else motionCountAfterRetry = motions.length;
            }
          }
          if (mode === 'fast-delayed' && purpose === 'press' && !delayedOnce) {
            delayedOnce = true;
            delayedUntil = Date.now() + 350;
            delayedMoveCount = motions.length;
          }
          if (screen && mode === 'initial-touch-offset' && !repressing)
            screen.x += 20;
          if (
            screen &&
            mode === 'bad-validation' &&
            targets.some(
              (target) =>
                target.role === 'validation' &&
                Math.hypot(
                  target.screen.x - screen.x,
                  target.screen.y - screen.y,
                ) < 1,
            )
          )
            screen.x += 20;
          page.sampleId = sampleId;
          page.sampleAcked = true;
          page.sampleSnapshot = {
            sampleId,
            mappingVersion: 1,
            pointerCount: screen ? 1 : 0,
            screen,
          };
          return { ...page };
        },
        targets: async () => ({
          mappingVersion: 1,
          displayKey: 'display',
          pixelWidth: 1000,
          pixelHeight: 500,
          targets,
        }),
        events: async () => {
          throw new Error('Sampling must use a fresh pointer snapshot');
        },
      } as AutoExplorationHost['screenCalib'];
      const ctx: ApplicationContext = {
        tool: f.tool,
        screen: {
          ...f.screen,
          physicalWidthMm: 0,
          physicalHeightMm: 0,
        },
      };
      const session: CalibrationSession = { auto: {} };
      const constraints = {
        speed: {
          ratio: { min: 0.001, max: 1 },
          linear: { min: 0.01, max: 1000 },
          angular: { min: 0.01, max: 360 },
          joints: { min: 0.01, max: 360 },
        },
        acceleration: {
          ratio: { min: 0.001, max: 1 },
          linear: { min: 0.01, max: 1000 },
          angular: { min: 0.01, max: 360 },
          joints: { min: 0.01, max: 360 },
        },
      };
      let finalPress = false;
      let finalPressCount = 0;
      const host = {
        adapter: {
          ...f.adapter,
          capabilities: f.runtime.capabilities,
          resolver: {
            descriptor: (token: string) =>
              token === 'motion.linear' ? { constraints } : undefined,
          },
          getPose: async () => pose(100, -50, startZ),
        },
        profileStore: {
          saveSession: async () => {
            if (referenceFallback && session.auto?.collectedSamples?.length)
              throw firstTouchRecorded;
          },
        },
        check: () => undefined,
        interrupted: () => false,
        ready: async () => undefined,
        drag: async () => undefined,
        target: () => undefined,
        preflight: async ([step]: Parameters<
          AutoExplorationHost['preflight']
        >[0]) => {
          finalPress = step.name.endsWith(' press');
          refining = step.name.endsWith(' refine');
        },
        move: async (
          target: CartesianPose,
          _ctx: unknown,
          speed: MotionSpeed,
          acceleration: MotionAcceleration,
        ) => {
          if (isFast) {
            // Probe approaches and presses keep the fast factor; pure travel
            // legs are allowed to run at the faster travel factor.
            const factors = [0.25, 0.6];
            expect(
              factors.map((factor) =>
                scaleSpeed(ctx.screen.actionSpeed, factor),
              ),
            ).toContainEqual(speed);
            expect(
              factors.map((factor) =>
                scaleAcceleration(ctx.screen.actionAcceleration, factor),
              ),
            ).toContainEqual(acceleration);
          } else {
            const factor = finalPress ? 0.25 : 0.1;
            expect(speed).toEqual(scaleSpeed(ctx.screen.actionSpeed, factor));
            expect(acceleration).toEqual(
              scaleAcceleration(ctx.screen.actionAcceleration, factor),
            );
          }
          if (finalPress) finalPressCount++;
          finalPress = false;
          const measured = structuredClone(target);
          if (testReferenceTouch) measured.positionMm.z += 0.04;
          if (mode === 'fast-refine-stalled' && refining)
            measured.positionMm.z +=
              activationZ - contactPoint(target, f.tool.offsetMm).z;
          const point = contactPoint(measured, f.tool.offsetMm);
          const previous = contactPoint(actualPose, f.tool.offsetMm);
          if (!finishedSampling) motions.push(target);
          if (point.z > previous.z && previous.z <= 30)
            releaseProbeStarted = true;
          if (releaseProbeStarted && point.z < previous.z) repressing = true;
          actualPose = measured;
          contact = point;
          lowestZ = Math.min(lowestZ, point.z);
          previousHeld = touching;
          const inside =
            point.x >= 0 && point.x <= 200 && point.y <= 0 && point.y >= -100;
          let tiltOffset = tilted
            ? slopeX * (point.x - 100) - 0.005 * (point.y + 50)
            : 0;
          // Raise the corners enough to exceed the audit threshold while
          // keeping both contacts above the downward safety limit.
          if (mode === 'fast-tilt-audit')
            tiltOffset = 0.04 * Math.abs(point.x - 100);
          if (mode === 'fast-adaptive-slide')
            tiltOffset = -0.007 * (point.x - 100) + 0.006 * (point.y + 50);
          if (testHeightReturn && session.auto?.progress?.phase === 'height')
            tiltOffset = 0.65;
          if (
            mode === 'fast-floor-recovery-slide' &&
            session.auto?.progress?.phase === 'height'
          )
            tiltOffset = -1.9;
          touching =
            inside &&
            (touching
              ? point.z < releaseZ + tiltOffset
              : point.z <= activationZ + tiltOffset);
          if (mode === 'release-missing' && releaseProbeStarted)
            touching = true;
          if (mode === 'repress-missing' && repressing) touching = false;
          if (mode === 'fast-no-touch' && point.x < 50) touching = false;
          if (mode === 'fast-local-recovery' && point.x < 50)
            touching = inside && point.z <= activationZ - 0.75;
          if (point.x < 25 && point.y > -15) {
            if (
              mode === 'fast-extended-recovery-slide' ||
              mode === 'fast-recovery-budget-slide'
            )
              touching = inside && point.z <= activationZ - 1.75;
            if (mode === 'fast-recovery-no-touch-slide') touching = false;
          }
          if (
            mode === 'fast-recovery-budget-slide' &&
            point.x > 175 &&
            point.y > -15
          )
            touching = false;
          // The buffered command floor leaves no reachable touch in this case.
          if (mode === 'safety-floor' && point.x > 105)
            touching = point.z <= 27.625;
          if (mode === 'standard-floor-press' && point.x > 105)
            touching = point.z <= 27.8;
          return measured;
        },
        stable: async () => undefined,
        stationaryPose: async () => pose(100, -50, startZ),
        contactAction: async () => {
          throw new Error('unused');
        },
        safeLift: (p: CartesianPose) => p,
        validateCalibration: () => undefined,
        validateScreenTargets: () => undefined,
        currentPose: async () => actualPose,
        screenCalib,
        progress: (current: CalibrationSession) => {
          if (testHeightReturn && current.auto?.progress?.phase === 'grid')
            throw gridStarted;
          if (current.auto?.progress?.message === 'Initial touch · refine')
            expect(previousHeld).toBe(false);
        },
      };
      const samplingTiming = new Map<string, number>();
      const job = runAutoExploration(host as never, session, ctx, {
        startPose: pose(100, -50, startZ),
        onSlideRecovery: (recovery) => slideRecoveries.push(recovery),
        onTiming: (event) =>
          samplingTiming.set(event, (samplingTiming.get(event) ?? 0) + 1),
        ...(isFast
          ? {
              mode: 'fast-horizontal' as const,
              horizontalConfirmed: true,
              collection: slides ? ('slide' as const) : ('tap' as const),
            }
          : {}),
      });
      try {
        if (referenceFallback) {
          await expect(job).rejects.toBe(firstTouchRecorded);
          expect(firstSlideTouchZ).toBeDefined();
          const referenceZ = contactPoint(
            pose(100, -50, startZ),
            f.tool.offsetMm,
          ).z;
          expect(firstSlidePresses.slice(-3)).toEqual(
            [2, 1.5, 1].map((offset, index) => ({
              fromZ: referenceZ,
              toZ: firstSlideTouchZ! + offset,
              touching: index === 2,
            })),
          );
          const first = session.auto!.collectedSamples![0];
          const [touchZ, clearZ] = first.heightIntervalMm!;
          expect(touchZ).toBeCloseTo(firstSlideTouchZ! + 1.04);
          expect(clearZ).toBeCloseTo(firstSlideTouchZ! + 1.54);
          expect(first.pressedZMm).toBe(touchZ);
          return;
        }
        if (testHeightReturn) {
          await expect(job).rejects.toBe(gridStarted);
          const firstMiss = heightSweeps.findIndex(
            (sample) => !sample.touching,
          );
          expect(firstMiss).toBeGreaterThan(1);
          const previous = heightSweeps[firstMiss - 1];
          const miss = heightSweeps[firstMiss];
          expect(miss.z).toBeGreaterThan(previous.z);
          const retained = usePreviousHeight
            ? heightSweeps[firstMiss - 2]
            : previous;
          const upper = usePreviousHeight ? previous : miss;
          const missedRecheck = { z: previous.z, touching: false };
          expect(heightSweeps.slice(firstMiss + 1)).toEqual(
            usePreviousHeight
              ? [missedRecheck, missedRecheck, retained]
              : [retained],
          );
          expect(session.auto?.collectedSamples?.[3]).toMatchObject({
            pressedZMm: retained.z,
            heightIntervalMm: [retained.z, upper.z],
          });
          return;
        }
        if (mode === 'fast-recovery-budget-slide') {
          await expect(job).rejects.toMatchObject({
            details: {
              label: 'Grid grid-0-2 vertical recovery',
              searchScope: 'grid-point',
              maxSearchSteps: 12,
            },
          });
          expect(
            session.auto?.collectedSamples?.find(
              (sample) => sample.role === 'fit',
            ),
          ).toMatchObject({ zSource: 'measured' });
          expect(lowestZ).toBeGreaterThanOrEqual(
            session.auto!.collectedSamples![0].pressedZMm - 2,
          );
          return;
        }
        const expected: Record<string, string> = {
          'release-missing': 'No confirmed release',
          'repress-missing': 'refined press',
          'snapshot-missing': 'Phone step acknowledgement timed out',
          'snapshot-stale': 'Phone step acknowledgement timed out',
          'safety-floor': 'safety floor',
          'fast-no-touch': 'did not sustain touch within the safe depth',
          'fast-tilt-audit': 'screen height error at the audit points',
          'fast-refine-stalled': 'could not narrow the contact interval',
          'fast-recovery-no-touch-slide':
            'No page touch before the safety floor',
        };
        if (expected[mode]) {
          await expect(job).rejects.toThrow(expected[mode]);
          if (mode === 'fast-tilt-audit')
            await expect(job).rejects.toMatchObject({
              code: 'SCREEN_TILT_UNSUPPORTED',
            });
          if (mode.startsWith('snapshot-')) expect(motions).toHaveLength(0);
          if (mode === 'fast-refine-stalled')
            expect(session.auto?.collectedSamples).toBeUndefined();
          if (mode === 'safety-floor')
            expect(lowestZ).toBeGreaterThanOrEqual(27.625);
          if (mode === 'fast-recovery-no-touch-slide')
            await expect(job).rejects.toMatchObject({
              code: 'TOUCH_SAFETY_LIMIT',
              details: { confirmedNoTouch: true },
            });
          if (mode === 'fast-no-touch') {
            await expect(job).rejects.toMatchObject({
              code: 'TOUCH_CONTACT_LOST',
              details: {
                audit: true,
                cause: 'TOUCH_SAFETY_LIMIT',
                retryCause: 'TOUCH_SAFETY_LIMIT',
              },
            });
            expect(lowestZ).toBeGreaterThanOrEqual(activationZ - 2.25);
          }
          return;
        }
        const collection = await job;
        expect(collection.probes).toHaveLength(slides ? 5 : 3);
        expect(collection.grid).toHaveLength(isFast ? 6 : 9);
        if (mode === 'standard-floor-press') {
          const floor = collection.probes[0].pressedZ - 2;
          const limitedPress = collection.probes.find(
            (point) => point.contact.x > 105,
          );
          expect(limitedPress?.pressedZ).toBeCloseTo(floor + 0.01);
          expect(lowestZ).toBeGreaterThanOrEqual(floor);
          return;
        }
        if (mode === 'fast-vertical-fallback-slide') {
          expect(auditPressReleased).toBe(true);
          expect(auditPressHeights).toEqual([
            collection.probes[3].pressedZ,
            collection.probes[3].pressedZ,
          ]);
          expect(
            slideRecoveries.map((recovery) => recovery.switchedToVertical),
          ).toEqual([false, true]);
          for (const [index, point] of collection.probes.slice(3).entries()) {
            const endpoint = slideEndpoints.get(index + 1)!;
            expect(point.contact.x).toBeCloseTo(endpoint.x);
            expect(point.contact.y).toBeCloseTo(endpoint.y);
            expect(point.heightIntervalMm).toBeDefined();
          }
          expect(
            collection.grid.every((point) => point.zSource === 'measured'),
          ).toBe(true);
        }
        if (mode === 'fast-floor-recovery-slide') {
          const [first] = collection.probes;
          expect(collection.grid[0]).toMatchObject({
            recovered: true,
            zSource: 'measured',
          });
          expect(lowestZ).toBeGreaterThanOrEqual(first.pressedZ - 2);
          return;
        }
        if (mode === 'fast-extended-recovery-slide') {
          expect(collection.grid[0]).toMatchObject({
            recovered: true,
            zSource: 'measured',
          });
          expect(gridPressReleased).toBe(true);
          expect(gridPressHeights).toEqual([
            collection.grid[0].pressedZ,
            collection.grid[0].pressedZ,
          ]);
          expect(lowestZ).toBeGreaterThanOrEqual(
            collection.probes[0].pressedZ - 2,
          );
          return;
        }
        if (mode === 'standard') expect(finalPressCount).toBe(12);
        const fit = () =>
          fitExploration(
            collection,
            f.tool,
            f.runtime.capabilities,
            {
              id: 'candidate',
              ...f.binding,
              robotGeometryRevision: 1,
              toolGeometryRevision: 1,
              screenGeometryRevision: 1,
            },
            isFast,
          );
        if (mode === 'bad-validation') {
          const result = fit();
          expect(result.evidence.validationMaxPx).toBeCloseTo(20);
          expect(result.warnings).toContainEqual(
            expect.objectContaining({ label: 'Holdout maximum' }),
          );
          expect(result.candidate.acceptanceStatus).toBe('pending');
          return;
        }
        const result = fit();
        // Timing events are the evidence a speed change is read from.
        expect(samplingTiming.get('movl')).toBeGreaterThan(0);
        expect(samplingTiming.get('phone-confirmation')).toBeGreaterThan(0);
        expect(samplingTiming.get('initial-search')).toBe(1);
        if (isFast)
          expect(samplingTiming.get('point-travel')).toBeGreaterThan(0);
        // Predicted press heights may locate the next move, never the plane.
        expect(result.evidence.samplingMode).toBe(isFast ? 'fast' : 'standard');
        const fitPoints = [
          ...collection.probes,
          ...collection.grid.filter((point) => point.target.role === 'fit'),
        ];
        const predictedFit = fitPoints.filter(
          (point) => point.zSource === 'predicted',
        );
        expect(result.evidence.predictedSamples).toBe(predictedFit.length);
        expect(result.evidence.predictedFraction).toBeCloseTo(
          predictedFit.length / fitPoints.length,
        );
        expect(
          result.evidence.predictedSamples! +
            result.evidence.measuredPlaneSamples!,
        ).toBe(result.quality.total);
        for (const sample of session.auto?.collectedSamples ?? [])
          expect(sample.zSource).toBe(
            sample.method === 'stepped' || sample.heightIntervalMm
              ? 'measured'
              : 'predicted',
          );
        if (!isFast) {
          expect(predictedFit).toHaveLength(0);
          expect(result.evidence.measuredPlaneSamples).toBe(
            result.quality.total,
          );
        } else {
          expect(predictedFit.length).toBeGreaterThan(0);
          expect(result.evidence.measuredPlaneSamples).toBeGreaterThanOrEqual(
            1,
          );
          // Fast-horizontal measures the first contact plus any local recovery.
          // Below three measured heights the plane is the stated assumption,
          // and the normal must be exactly the approach direction.
          const assumed = result.evidence.measuredPlaneSamples! < 3;
          expect(result.evidence.planeSource).toBe(
            assumed ? 'assumed-horizontal' : 'measured',
          );
          if (assumed)
            expect(Math.abs(result.candidate.plane.normal.z)).toBeCloseTo(1, 3);
          expect(result.evidence.predictedHeightResidualMaxMm).toBeDefined();
          expect(result.evidence.predictedHeightResidualMaxMm!).toBeLessThan(3);
        }
        if (mode === 'fast-local-recovery') {
          // Validation points are measured now, so recovery is asserted on a
          // fit corner: the predicted press missed and the local search found it.
          const recovered = collection.grid.find(
            (point) => point.target.role === 'fit' && point.recovered,
          );
          expect(recovered).toBeDefined();
          const [touchZ, clearZ] = recovered!.heightIntervalMm!;
          expect(recovered!.pressedZ).toBeCloseTo(
            touchZ - (clearZ - touchZ) / 2,
            6,
          );
          // Three measured fit points (first + two audit corners), plus any
          // corner that needed a local recovery, define the plane.
          expect(result.evidence.measuredPlaneSamples).toBe(4);
          expect(result.evidence.planeSource).toBe('measured');
          return;
        }
        if (tilted) {
          const { normal } = result.candidate.plane;
          expect(-normal.x / normal.z).toBeCloseTo(slopeX, 2);
          expect(-normal.y / normal.z).toBeCloseTo(-0.005, 2);
        }
        expect(result.candidate.acceptanceStatus).toBe('pending');
        // The simulated screen maps pixels in XY; the measured axes follow its surface.
        const sizePrecision =
          tilted || mode === 'fast-adaptive-slide' ? 1 : isFast ? 2 : 3;
        expect(result.measuredSize.physicalWidthMm).toBeCloseTo(
          tilted ? Math.hypot(200, slopeX * 200) : 200,
          sizePrecision,
        );
        expect(result.measuredSize.physicalHeightMm).toBeCloseTo(
          tilted ? Math.hypot(100, 0.5) : 100,
          sizePrecision,
        );
        expect(result.coverage).toBeGreaterThan(0.6);
        expect(result.gridRmsMm).toBeLessThan(0.75);
        expect(result.evidence.validationMaxMm).toBeLessThan(1);
        if (!isFast) expect(result.evidence.planeSource).toBe('measured');
        const samples = session.auto?.collectedSamples ?? [];
        const methodsOf = (role: 'probe' | 'fit' | 'validation') =>
          samples
            .filter((sample) => sample.role === role)
            .map((sample) => sample.method);
        if (slides && mode !== 'fast-vertical-fallback-slide') {
          const firstGridRecovered =
            mode === 'fast-adaptive-slide' || mode === 'fast-corner-slide';
          expect(methodsOf('fit')).toEqual([
            firstGridRecovered ? 'stepped' : 'slide',
            firstGridRecovered ? 'direct' : 'slide',
            'slide',
            'slide',
          ]);
          expect(methodsOf('validation')).toEqual(Array(2).fill('slide'));
          expect(methodsOf('probe').slice(3)).toEqual(['slide', 'slide']);
          for (const probe of collection.probes.slice(3)) {
            expect(probe.zSource).toBe('measured');
            const [touchedZ, clearZ] = probe.heightIntervalMm!;
            expect(clearZ).toBeGreaterThan(touchedZ);
            expect(clearZ - touchedZ).toBeLessThanOrEqual(0.251);
          }
          expect(result.evidence.validationHeightMaxMm).toBeUndefined();
        }
        if (mode === 'fast-tap') {
          expect(result.evidence.validationHeightMaxMm).toBeUndefined();
          expect(methodsOf('validation')).toEqual(['direct', 'direct']);
          const fitMethods = methodsOf('fit');
          expect(fitMethods.slice(0, 2)).toEqual(['stepped', 'stepped']);
          expect(
            fitMethods
              .slice(2)
              .every((method) => method === 'direct' || method === 'stepped'),
          ).toBe(true);
          // First touch plus the two audit corners always press; a predicted
          // press that misses adds one local-recovery press.
          expect(finalPressCount).toBeGreaterThanOrEqual(3);
        }
        if (mode === 'fast-slide') {
          const first = collection.probes[0];
          expect(first.heightIntervalMm?.[0]).toBeLessThanOrEqual(activationZ);
          expect(first.heightIntervalMm?.[1]).toBeGreaterThan(activationZ);
          const [touchZ, clearZ] = first.heightIntervalMm!;
          expect(first.pressedZ).toBe(touchZ);
          expect(clearZ - touchZ).toBeCloseTo(0.5);
          expect(firstSlideTouchZ).toBeDefined();
          const referenceZ = contactPoint(
            pose(100, -50, startZ),
            f.tool.offsetMm,
          ).z;
          expect(firstSlidePresses).toEqual(
            [0.5, 1, 1.5, 2, 1.5].map((offset, index) => ({
              fromZ: referenceZ,
              toZ: firstSlideTouchZ! + offset,
              touching: index !== 3,
            })),
          );
          for (const point of [...collection.probes, ...collection.grid]) {
            // Predicted presses use the anchor height; the measured audit
            // points sit within one bracket of it on this flat screen.
            if (point.zSource === 'predicted') {
              // The plane is fitted from the two interior audits plus the first
              // touch, so the far side extrapolates a fraction of a millimetre.
              expect(Math.abs(point.pressedZ - first.pressedZ)).toBeLessThan(
                0.5,
              );
              expect(Math.abs(point.contact.z - first.contact.z)).toBeLessThan(
                0.3,
              );
            } else
              expect(Math.abs(point.contact.z - first.contact.z)).toBeLessThan(
                0.3,
              );
          }
        }
        if (mode === 'fast-adaptive-slide' || mode === 'fast-corner-slide') {
          const [corner] = collection.grid;
          expect(corner.screen.x).toBeCloseTo(corner.target.screen.x);
          expect(corner.screen.y).toBeCloseTo(corner.target.screen.y);
          expect(corner.zSource).toBe('measured');
          const [touchedZ, clearZ] = corner.heightIntervalMm!;
          expect(clearZ).toBeGreaterThan(touchedZ);
          expect(clearZ - touchedZ).toBeLessThanOrEqual(0.251);
        }
        if (mode === 'press-recovers') {
          expect(missedPressZ).toBeDefined();
          expect(coarseTouchZ).toBeDefined();
          expect(motionCountAfterRetry).toBeDefined();
          expect(collection.probes[0].pressedZ).toBeLessThan(missedPressZ!);
          expect(collection.probes[0].pressedZ).toBe(coarseTouchZ);
          for (const motion of motions.slice(motionCountAfterRetry!)) {
            expect(
              contactPoint(motion, f.tool.offsetMm).z,
            ).toBeGreaterThanOrEqual(missedPressZ! - 2);
          }
        }
        if (mode === 'fast-intermittent-height-slide')
          expect(missedSlide).toBe(true);
        expect(f.store.getScreen(f.screen.id)).toEqual(f.screen);
      } finally {
        await f.cleanup();
      }
    },
    90000,
  );
});
