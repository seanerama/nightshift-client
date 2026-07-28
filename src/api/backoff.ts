/**
 * Reconnect backoff for the SSE event stream (stage 4).
 *
 * Capped exponential: 1s, 2s, 4s, ... capped at 30s. The stream client resets
 * the attempt counter to 0 whenever a valid event arrives, so a healthy
 * reconnect starts the ladder over from 1s.
 */

export const BACKOFF_INITIAL_MS = 1_000;
export const BACKOFF_CAP_MS = 30_000;

/** Delay before reconnect attempt number `attempt` (0-based). */
export const backoffDelayMs = (attempt: number): number => {
  const step = Math.max(0, Math.floor(attempt));
  // 2 ** 15 already exceeds the cap; clamping the exponent avoids overflow
  // for absurd attempt counts instead of trusting Math.min with Infinity.
  const exponent = Math.min(step, 15);
  return Math.min(BACKOFF_INITIAL_MS * 2 ** exponent, BACKOFF_CAP_MS);
};
