/** Unit: health state machine transitions and foreground poll gating. */

import { type HealthState, healthColor, reduceHealth, shouldPoll } from './health';

const ALL_STATES: HealthState[] = ['unknown', 'ok', 'degraded', 'unreachable'];

describe('reduceHealth', () => {
  it.each(ALL_STATES)('ok result → ok (from %s)', (from) => {
    expect(reduceHealth(from, { type: 'result', ok: true })).toBe('ok');
  });

  it.each(ALL_STATES)('ok:false result → degraded (from %s)', (from) => {
    expect(reduceHealth(from, { type: 'result', ok: false })).toBe('degraded');
  });

  it.each(ALL_STATES)('typed error → unreachable (from %s)', (from) => {
    expect(reduceHealth(from, { type: 'error' })).toBe('unreachable');
  });

  it.each(ALL_STATES)('reset (connection switch) → unknown (from %s)', (from) => {
    expect(reduceHealth(from, { type: 'reset' })).toBe('unknown');
  });

  it('models the smoke script: unknown → ok → degrades when the agent dies', () => {
    let state: HealthState = 'unknown';
    state = reduceHealth(state, { type: 'result', ok: true });
    expect(state).toBe('ok');
    state = reduceHealth(state, { type: 'error' });
    expect(state).toBe('unreachable');
    state = reduceHealth(state, { type: 'result', ok: true });
    expect(state).toBe('ok'); // recovers when the agent comes back
  });
});

describe('shouldPoll (foreground-only)', () => {
  it('polls only when foregrounded with an active connection', () => {
    expect(shouldPoll('active', true)).toBe(true);
  });

  it.each([
    ['background', true],
    ['inactive', true],
    ['active', false],
    ['background', false],
  ])('does not poll for appState=%s hasActive=%s', (appState, hasActive) => {
    expect(shouldPoll(appState, hasActive)).toBe(false);
  });
});

describe('healthColor', () => {
  it('maps each state to a distinct dot color', () => {
    const colors = ALL_STATES.map(healthColor);
    expect(new Set(colors).size).toBe(ALL_STATES.length);
  });
});
