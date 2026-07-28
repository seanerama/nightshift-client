import { BACKOFF_CAP_MS, backoffDelayMs } from './backoff';

it('doubles from 1s and caps at 30s', () => {
  expect([0, 1, 2, 3, 4, 5].map(backoffDelayMs)).toEqual([
    1_000, 2_000, 4_000, 8_000, 16_000, 30_000,
  ]);
});

it('stays at the cap for large attempt counts', () => {
  expect(backoffDelayMs(6)).toBe(BACKOFF_CAP_MS);
  expect(backoffDelayMs(100)).toBe(BACKOFF_CAP_MS);
  expect(backoffDelayMs(10_000)).toBe(BACKOFF_CAP_MS);
});

it('treats negative or fractional attempts as the first attempt', () => {
  expect(backoffDelayMs(-3)).toBe(1_000);
  expect(backoffDelayMs(0.5)).toBe(1_000);
});
