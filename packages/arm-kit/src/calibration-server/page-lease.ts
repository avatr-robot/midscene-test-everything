/** Only the desktop calibration page renews this lease; phone traffic cannot keep it alive. */
export class CalibrationPageLease {
  private deadline: number;
  private active = false;
  constructor(
    private readonly timeoutMs = 90_000,
    startTimeoutMs = 300_000,
    private readonly now = () => Date.now(),
  ) {
    for (const value of [timeoutMs, startTimeoutMs]) {
      if (!Number.isFinite(value) || value <= 0)
        throw new Error(
          'Calibration page timeouts must be positive finite milliseconds',
        );
    }
    this.deadline = this.now() + startTimeoutMs;
  }
  renew(): boolean {
    if (this.expired()) return false;
    this.active = true;
    this.deadline = this.now() + this.timeoutMs;
    return true;
  }
  expired(): boolean {
    return this.now() >= this.deadline;
  }
  get message(): string {
    return this.active
      ? 'Calibration page disconnected; calibration cancelled'
      : 'Calibration page was not opened before the timeout';
  }
}
