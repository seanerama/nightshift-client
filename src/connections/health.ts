/**
 * Health state machine for the active connection's status dot (stage 3).
 *
 * Pure logic, fully unit-testable; the polling side effects (interval,
 * AppState foreground gating) live in the provider and feed events in here.
 *
 * States:
 * - unknown     (grey)  — no result yet, or the active connection changed
 * - ok          (green) — health responded with ok: true
 * - degraded    (amber) — health responded 200 but ok: false
 * - unreachable (red)   — typed client error (network / http / shape)
 */

export type HealthState = 'unknown' | 'ok' | 'degraded' | 'unreachable';

export type HealthEvent =
  /** Active connection changed (or removed) — forget stale results. */
  | { type: 'reset' }
  /** A health response arrived; `ok` is the body's ok flag. */
  | { type: 'result'; ok: boolean }
  /** getHealth rejected (network failure, non-2xx, bad shape). */
  | { type: 'error' };

export const reduceHealth = (_state: HealthState, event: HealthEvent): HealthState => {
  switch (event.type) {
    case 'reset':
      return 'unknown';
    case 'result':
      return event.ok ? 'ok' : 'degraded';
    case 'error':
      return 'unreachable';
  }
};

/** Poll only while the app is foregrounded and a connection is active. */
export const shouldPoll = (appState: string, hasActiveConnection: boolean): boolean =>
  hasActiveConnection && appState === 'active';

export const HEALTH_POLL_INTERVAL_MS = 30_000;

/** Health dot colours come from the active palette (stage 12) rather than
 * being spelled here — the dot has to be legible in both schemes, and the
 * palette is the single place a scheme is defined. */
export interface HealthPalette {
  healthOk: string;
  healthDegraded: string;
  healthUnreachable: string;
  healthUnknown: string;
}

export const healthColor = (state: HealthState, palette: HealthPalette): string => {
  switch (state) {
    case 'ok':
      return palette.healthOk;
    case 'degraded':
      return palette.healthDegraded;
    case 'unreachable':
      return palette.healthUnreachable;
    case 'unknown':
      return palette.healthUnknown;
  }
};

export const healthLabel = (state: HealthState): string => {
  switch (state) {
    case 'ok':
      return 'Healthy';
    case 'degraded':
      return 'Degraded';
    case 'unreachable':
      return 'Unreachable';
    case 'unknown':
      return 'Checking…';
  }
};
