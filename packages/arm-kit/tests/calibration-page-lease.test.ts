import { expect, it } from '@rstest/core';
import { CalibrationPageLease } from '../src/calibration-server/page-lease.js';

it('gives the first page a startup window, then permits reload within the disconnect grace', () => {
  let now = 0;
  const lease = new CalibrationPageLease(90, 300, () => now);
  now = 250;
  expect(lease.renew()).toBe(true);
  now = 330;
  expect(lease.renew()).toBe(true);
  now = 419;
  expect(lease.expired()).toBe(false);
  now = 420;
  expect(lease.expired()).toBe(true);
  expect(lease.renew()).toBe(false);
  expect(lease.message).toContain('disconnected');
});
it('expires unopened pages and rejects invalid timer configuration', () => {
  let now = 0;
  const lease = new CalibrationPageLease(90, 300, () => now);
  now = 300;
  expect(lease.renew()).toBe(false);
  expect(lease.message).toContain('not opened');
  for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
    expect(() => new CalibrationPageLease(value)).toThrow('positive finite');
});
