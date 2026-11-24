import { setTimeout as delay } from 'node:timers/promises';
import {
  type AutomaticCaptureMotionTiming,
  CALIBRATION_PHONE_POLICY,
  CALIBRATION_RELATIVE_SLACK,
  type CalibrationPageUpdate,
  type CalibrationPointProgress,
  type WebPoint,
} from '../../assisted-contracts.js';
import { RobotArmError } from '../../contracts.js';
import type { ProbePurpose } from './types.js';

const CONFIRM_INTERVAL_MS = 100;
const COARSE_NO_TOUCH_CONFIRM_INTERVAL_MS = 50;
const BRIEF_CONTACT_GAP_MS = 150;
/** Give a streaming page one retry window before falling back to request/response. */
const STREAM_CONFIRM_TIMEOUT_MS = 500;
const MAX_BRIEF_CONTACT_GAPS = 2;
type Step = NonNullable<CalibrationPointProgress['step']>;
type Feedback = NonNullable<CalibrationPageUpdate['stepFeedback']>;
type Reading = { revision: number; point?: WebPoint };

export interface PhoneProbeEvidence {
  sampleId: string;
  targetId: string;
  purpose: ProbePurpose;
  requestedTipZMm: number;
  measuredTipZMm?: number;
  motionTiming?: AutomaticCaptureMotionTiming;
  startedAt: string;
  elapsedMs: number;
  outcome: string;
  changes: number;
  recoveredContactGaps?: number;
  lastContactChange?: {
    id: string;
    phase: Step['phase'];
    sequence: number;
    elapsedMs: number;
    outcome: Feedback['outcome'];
  };
  replies: Array<{
    id: string;
    phase: Step['phase'];
    sequence: number;
    roundTripMs: number;
    outcome: Feedback['outcome'];
    reason?: Feedback['reason'];
    releasedBeforeAck?: boolean;
    point?: WebPoint;
  }>;
}

/** One stationary pose. Heartbeats and replies to earlier poses cannot complete a read. */
export class StationaryPhoneObservation {
  private readonly evidence: PhoneProbeEvidence;
  step?: Step;
  private readonly started = performance.now();
  private sentAt = this.started;
  private receivedAt: number;
  private readonly issued = new Map<string, { releasedBeforeAck?: boolean }>();
  private sequence: number;
  private lastFeedbackId?: string;
  private firstReply?: Reading;
  private current?: Reading;
  private pointerId?: string;
  private jitterPx = 0;
  private allowBriefContactGaps = false;
  private contactGap?: { point: WebPoint; startedAt: number };
  private recoveredContactGaps = 0;
  private wake?: () => void;
  private failure?:
    | 'multiple_contacts'
    | 'pointer_cancelled'
    | 'intermittent_contact'
    | 'unstable';
  /** Accepted result frames for the active step, oldest first. */
  private readonly readings: Array<{ at: number; reading: Reading }> = [];

  constructor(
    sampleId: string,
    targetId: string,
    purpose: ProbePurpose,
    requestedTipZMm: number,
    sequence: number,
    receivedAt: number,
    measuredTipZMm?: number,
    motionTiming?: AutomaticCaptureMotionTiming,
    /** The page streams an active step instead of answering each read. */
    private readonly streaming = false,
  ) {
    this.sequence = sequence;
    this.receivedAt = receivedAt;
    this.evidence = {
      sampleId,
      targetId,
      purpose,
      requestedTipZMm,
      measuredTipZMm,
      motionTiming,
      startedAt: new Date().toISOString(),
      elapsedMs: 0,
      outcome: 'interrupted',
      changes: 0,
      replies: [],
    };
  }
  diagnostics(): PhoneProbeEvidence {
    return {
      ...this.evidence,
      elapsedMs: Math.round(performance.now() - this.started),
      recoveredContactGaps: this.recoveredContactGaps || undefined,
    };
  }

  notify() {
    this.wake?.();
  }

  receive(update: CalibrationPageUpdate) {
    if (update.sequence <= this.sequence) return;
    this.notify();
    this.sequence = update.sequence;
    this.receivedAt = performance.now();
    const reply = update.stepFeedback;
    if (reply) this.lastFeedbackId = reply.id;
    const issued = reply && this.issued.get(`${reply.id}/${reply.phase}`);
    if (
      !update.visible ||
      update.targetReady !== this.evidence.targetId ||
      !this.step ||
      !reply ||
      !issued ||
      reply.contactMode !== 'current'
    )
      return;
    if (
      (reply.outcome === 'ready' && reply.phase !== 'prepare') ||
      (reply.outcome === 'no_touch' && reply.phase !== 'result')
    )
      return;

    const point = reply.outcome === 'touched' ? reply.point : undefined;
    const pointerId = point ? update.contact?.id : undefined;
    if (
      reply.outcome === 'unknown' &&
      (!this.failure || this.failure === 'intermittent_contact')
    )
      this.failure = reply.reason ?? 'unstable';
    if (reply.outcome === 'touched' && !point) this.failure = 'unstable';
    if (point && this.pointerId && pointerId && pointerId !== this.pointerId)
      this.failure = 'unstable';
    const earlyRelease = reply.releasedBeforeAck && !issued.releasedBeforeAck;
    if (earlyRelease) issued.releasedBeforeAck = true;
    if (
      earlyRelease ||
      (this.current && Boolean(this.current.point) !== Boolean(point))
    ) {
      this.evidence.changes++;
      this.evidence.lastContactChange = {
        id: reply.id,
        phase: reply.phase,
        sequence: update.sequence,
        elapsedMs: Math.round(this.receivedAt - this.started),
        outcome: reply.outcome,
      };
      // Keep transient contact distinct so refinement can use its existing bracket.
      if (
        (earlyRelease || !point) &&
        this.evidence.purpose !== 'release' &&
        this.evidence.purpose !== 'preflight'
      ) {
        if (
          this.allowBriefContactGaps &&
          !point &&
          this.current?.point &&
          this.recoveredContactGaps < MAX_BRIEF_CONTACT_GAPS
        ) {
          this.contactGap = {
            point: this.current.point,
            startedAt: this.receivedAt,
          };
        } else this.failure ??= 'intermittent_contact';
      }
    }
    if (point && this.contactGap) {
      const { point: before, startedAt } = this.contactGap;
      this.contactGap = undefined;
      if (
        this.receivedAt - startedAt <= BRIEF_CONTACT_GAP_MS &&
        Math.hypot(point.x - before.x, point.y - before.y) <= this.jitterPx
      )
        this.recoveredContactGaps++;
      else this.failure ??= 'intermittent_contact';
    }
    this.pointerId = pointerId;
    this.current = {
      revision: this.evidence.changes,
      point: point && { ...point },
    };
    if (
      this.streaming &&
      this.step &&
      reply.id === this.step.id &&
      reply.phase === this.step.phase
    )
      this.readings.push({ at: this.receivedAt, reading: this.current });
    if (
      !this.firstReply &&
      reply.id === this.step.id &&
      reply.phase === this.step.phase
    ) {
      this.firstReply = this.current;
      this.evidence.replies.push({
        id: reply.id,
        phase: reply.phase,
        sequence: update.sequence,
        roundTripMs: Math.round(this.receivedAt - this.sentAt),
        outcome: reply.outcome,
        reason: reply.reason,
        releasedBeforeAck: reply.releasedBeforeAck,
        point: this.current.point,
      });
    }
  }

  async measure(
    host: { signal: AbortSignal; check(): void },
    publish: () => void,
    shortEdgeCssPx: number,
    settleMs = 0,
    allowBriefContactGaps = this.evidence.purpose === 'search',
    targetAlreadyPainted = false,
  ): Promise<WebPoint | undefined> {
    const deadline =
      this.started + CALIBRATION_PHONE_POLICY.stepAcknowledgementMs;
    this.jitterPx =
      Math.max(1, shortEdgeCssPx * 0.0075) * (1 + CALIBRATION_RELATIVE_SLACK);
    this.allowBriefContactGaps = allowBriefContactGaps;
    const matches = (a: Reading, b: Reading) => {
      if (a.revision !== b.revision) return false;
      if (!a.point || !b.point) return a.point === b.point;
      return (
        Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y) <=
        this.jitterPx
      );
    };
    const fail = (code: string, message: string): never => {
      this.evidence.outcome = code;
      throw new RobotArmError(code, message, 409, {
        sampleId: this.evidence.sampleId,
        targetId: this.evidence.targetId,
        purpose: this.evidence.purpose,
        stepId: this.step?.id,
        phase: this.step?.phase,
        elapsedMs: Math.round(performance.now() - this.started),
        lastUpdateAgeMs: Math.round(performance.now() - this.receivedAt),
        lastUpdateSequence: this.sequence,
        lastFeedbackId: this.lastFeedbackId,
        reason: this.failure,
      });
    };
    const check = () => {
      host.signal.throwIfAborted();
      host.check();
      if (
        this.contactGap &&
        performance.now() - this.contactGap.startedAt >= BRIEF_CONTACT_GAP_MS
      )
        this.failure ??= 'intermittent_contact';
      if (this.failure === 'multiple_contacts')
        fail('TOUCH_AMBIGUOUS', 'Expected zero or one mapped touch');
      if (this.failure === 'pointer_cancelled')
        fail(
          'PHONE_TOUCH_UNSTABLE',
          'The phone cancelled the active pointer. Touch at this position is unknown.',
        );
      if (
        this.failure === 'unstable' ||
        this.failure === 'intermittent_contact'
      )
        fail(
          'PHONE_TOUCH_UNSTABLE',
          'Phone contact changed while the robot was stationary. This position could not be measured.',
        );
      if (performance.now() >= deadline)
        fail(
          'PHONE_STEP_TIMEOUT',
          'Phone step acknowledgement timed out. Touch at this position is unknown.',
        );
    };
    const read = async (id: string, phase: Step['phase']): Promise<Reading> => {
      check();
      this.firstReply = undefined;
      this.sentAt = performance.now();
      this.step = { id, phase, contactMode: 'current' };
      this.issued.set(`${id}/${phase}`, {});
      publish();
      while (!this.firstReply || this.contactGap) {
        check();
        const now = performance.now();
        const freshnessCheckAt =
          this.receivedAt + CALIBRATION_PHONE_POLICY.measurementFreshMs + 1;
        const wakeAt = Math.min(
          deadline,
          freshnessCheckAt > now ? freshnessCheckAt : Number.POSITIVE_INFINITY,
          this.contactGap
            ? this.contactGap.startedAt + BRIEF_CONTACT_GAP_MS
            : Number.POSITIVE_INFINITY,
        );
        await new Promise<void>((resolve) => {
          const wake = () => {
            clearTimeout(timer);
            host.signal.removeEventListener('abort', wake);
            this.wake = undefined;
            resolve();
          };
          const timer = setTimeout(wake, Math.max(1, Math.ceil(wakeAt - now)));
          this.wake = wake;
          host.signal.addEventListener('abort', wake, { once: true });
          if (host.signal.aborted) wake();
        });
      }
      check();
      return this.firstReply;
    };
    /**
     * Streaming path: arm the step once, then accept the same rule from frames
     * the page pushes continuously. Two frames must agree and be at least
     * CONFIRM_INTERVAL_MS apart, and the settle window still starts at
     * `started + settleMs`.
     */
    const streamed = async () => {
      const id = this.evidence.sampleId;
      // Repeated coarse probes can reuse the painted target. Results still
      // carry the new sample ID and must agree after the stationary settle.
      if (!targetAlreadyPainted || this.evidence.purpose !== 'coarse-search')
        await read(id, 'prepare');
      check();
      this.readings.length = 0;
      this.firstReply = undefined;
      this.sentAt = performance.now();
      this.step = { id, phase: 'result', contactMode: 'current' };
      this.issued.set(`${id}/result`, {});
      publish();
      // A page that advertises streaming but stops sending frames must not
      // burn the full request timeout: two frames arrive within ~120 ms at
      // 25 Hz, so a short budget is enough to tell the two apart.
      const streamDeadline =
        this.started + settleMs + STREAM_CONFIRM_TIMEOUT_MS;
      for (;;) {
        check();
        const settledAt = this.started + settleMs;
        const ready = this.readings.filter((entry) => entry.at >= settledAt);
        if (ready.length >= 2) {
          const latest = ready[ready.length - 1];
          const earlier = ready.find(
            (entry) => latest.at - entry.at >= CONFIRM_INTERVAL_MS,
          );
          if (
            earlier &&
            this.current &&
            matches(earlier.reading, latest.reading) &&
            matches(latest.reading, this.current)
          ) {
            this.evidence.outcome = latest.reading.point
              ? 'touched'
              : 'no_touch';
            return latest.reading.point;
          }
        }
        if (performance.now() >= streamDeadline)
          throw new RobotArmError(
            'PHONE_STEP_TIMEOUT',
            'The phone page advertised streamed results but did not confirm the step',
            504,
          );
        await new Promise<void>((resolve) => {
          const wake = () => {
            clearTimeout(timer);
            host.signal.removeEventListener('abort', wake);
            this.wake = undefined;
            resolve();
          };
          const timer = setTimeout(wake, 25);
          this.wake = wake;
          host.signal.addEventListener('abort', wake, { once: true });
          if (host.signal.aborted) wake();
        });
      }
    };
    try {
      if (this.streaming) return await streamed();
      const id = this.evidence.sampleId;
      let previous = await read(id, 'prepare');
      // Two independent browser reads while the arm is still. A late change gets one recheck.
      for (let index = 0; index < 2 + this.recoveredContactGaps * 2; index++) {
        const nextId =
          index === 0 ? id : `${id}-confirm${index === 1 ? '' : `-${index}`}`;
        // Allow a full phone report cycle before accepting absence at a depth limit or expected touch.
        const awaitingContact =
          !previous.point &&
          ['search-limit', 'press', 'slide'].includes(this.evidence.purpose);
        const coarseNoTouch =
          nextId === id &&
          this.evidence.purpose === 'coarse-search' &&
          !previous.point &&
          this.evidence.changes === 0;
        const now = performance.now();
        const waitMs = Math.max(
          awaitingContact
            ? CALIBRATION_PHONE_POLICY.heartbeatMs
            : coarseNoTouch
              ? COARSE_NO_TOUCH_CONFIRM_INTERVAL_MS
              : CONFIRM_INTERVAL_MS,
          this.started + settleMs - now,
        );
        await delay(Math.max(0, Math.min(waitMs, deadline - now)), undefined, {
          signal: host.signal,
        });
        const result = await read(nextId, 'result');
        if (matches(previous, result) && matches(result, this.current!)) {
          this.evidence.outcome = result.point ? 'touched' : 'no_touch';
          return result.point;
        }
        previous = result;
      }
      return fail(
        'PHONE_TOUCH_UNSTABLE',
        'Phone contact changed while the robot was stationary. This position could not be measured.',
      );
    } finally {
      this.step = undefined;
      this.readings.length = 0;
    }
  }
}
