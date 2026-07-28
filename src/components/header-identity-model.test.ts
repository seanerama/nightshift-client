/**
 * Unit: header identity selector (stage 10) — active agent name + health dot
 * color/label, and the static-title fallback when nothing is active.
 */

import { healthColor, healthLabel } from '../connections/health';
import { headerIdentityModel } from './header-identity-model';

describe('headerIdentityModel', () => {
  it('falls back to the static tab title when no connection is active', () => {
    expect(headerIdentityModel(null, 'unknown', 'Chat')).toEqual({
      kind: 'static',
      title: 'Chat',
    });
    // The fallback ignores health entirely — there is nothing to be healthy.
    expect(headerIdentityModel(null, 'ok', 'Apps')).toEqual({ kind: 'static', title: 'Apps' });
  });

  it('shows the active agent name with the health dot color and label', () => {
    expect(headerIdentityModel({ agentName: 'night-agent' }, 'ok', 'Chat')).toEqual({
      kind: 'identity',
      title: 'night-agent',
      dotColor: healthColor('ok'),
      healthLabel: healthLabel('ok'),
    });
  });

  it.each([
    'unknown',
    'ok',
    'degraded',
    'unreachable',
  ] as const)('reuses the stage-3 health mapping for %s', (state) => {
    const model = headerIdentityModel({ agentName: 'a' }, state, 'Chat');
    expect(model).toMatchObject({
      kind: 'identity',
      dotColor: healthColor(state),
      healthLabel: healthLabel(state),
    });
  });
});
