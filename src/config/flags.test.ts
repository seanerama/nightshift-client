/**
 * APPS_TAB_ENABLED kill-switch resolution (stage-5 acceptance condition):
 * explicit app-config boolean wins; absent → ON in dev, OFF in release
 * (dark-launch default-off for shipped builds).
 */

import { resolveAppsTabEnabled, resolveTranscriptPersistenceEnabled } from './flags';

describe('resolveAppsTabEnabled', () => {
  it('explicit true enables regardless of build type', () => {
    expect(resolveAppsTabEnabled(true, false)).toBe(true);
    expect(resolveAppsTabEnabled(true, true)).toBe(true);
  });

  it('explicit false is the kill-switch — off even in dev', () => {
    expect(resolveAppsTabEnabled(false, true)).toBe(false);
    expect(resolveAppsTabEnabled(false, false)).toBe(false);
  });

  it('absent defaults ON in dev, OFF in release', () => {
    expect(resolveAppsTabEnabled(undefined, true)).toBe(true);
    expect(resolveAppsTabEnabled(undefined, false)).toBe(false);
  });

  it('non-boolean junk is treated as absent (never accidentally enables release)', () => {
    expect(resolveAppsTabEnabled('true', false)).toBe(false);
    expect(resolveAppsTabEnabled(1, false)).toBe(false);
    expect(resolveAppsTabEnabled(null, false)).toBe(false);
  });
});

describe('resolveTranscriptPersistenceEnabled (stage-9 kill-switch)', () => {
  it('defaults ON when absent — the RECORDED planner deviation from the default-OFF template', () => {
    expect(resolveTranscriptPersistenceEnabled(undefined)).toBe(true);
  });

  it('explicit true stays ON', () => {
    expect(resolveTranscriptPersistenceEnabled(true)).toBe(true);
  });

  it('explicit false is the kill-switch', () => {
    expect(resolveTranscriptPersistenceEnabled(false)).toBe(false);
  });

  it('non-boolean junk fails toward the default (ON for this flag)', () => {
    expect(resolveTranscriptPersistenceEnabled('false')).toBe(true);
    expect(resolveTranscriptPersistenceEnabled(0)).toBe(true);
    expect(resolveTranscriptPersistenceEnabled(null)).toBe(true);
  });
});
