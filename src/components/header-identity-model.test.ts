/**
 * Unit: header identity selector (stage 10) — active agent name + health dot
 * color/label, and the static-title fallback when nothing is active.
 */

import { healthColor, healthLabel } from '../connections/health';
import { paletteFor } from '../theme/tokens';
import { headerIdentityModel } from './header-identity-model';

// Health dot colours now come from the active palette (stage 12), so the model
// takes one; light is arbitrary here — the assertions compare against the same
// palette rather than against literals.
const palette = paletteFor('light');

describe('headerIdentityModel', () => {
  it('falls back to the static tab title when no connection is active', () => {
    expect(headerIdentityModel(null, 'unknown', 'Chat', palette)).toEqual({
      kind: 'static',
      title: 'Chat',
    });
    // The fallback ignores health entirely — there is nothing to be healthy.
    expect(headerIdentityModel(null, 'ok', 'Apps', palette)).toEqual({
      kind: 'static',
      title: 'Apps',
    });
  });

  it('shows the active agent name with the health dot color and label', () => {
    expect(headerIdentityModel({ agentName: 'night-agent' }, 'ok', 'Chat', palette)).toEqual({
      kind: 'identity',
      title: 'night-agent',
      dotColor: healthColor('ok', palette),
      healthLabel: healthLabel('ok'),
    });
  });

  it.each([
    'unknown',
    'ok',
    'degraded',
    'unreachable',
  ] as const)('reuses the stage-3 health mapping for %s', (state) => {
    const model = headerIdentityModel({ agentName: 'a' }, state, 'Chat', palette);
    expect(model).toMatchObject({
      kind: 'identity',
      dotColor: healthColor(state, palette),
      healthLabel: healthLabel(state),
    });
  });
});
