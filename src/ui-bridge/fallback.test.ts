/**
 * Mandatory-fallback trigger logic (ADR 0004): load failure, read failure,
 * render crash, and bridge violation storms all degrade to the markdown
 * fallback; fallback is terminal for the opened view.
 */

import {
  isViolationStorm,
  type ResourceViewState,
  reduceResourceView,
  VIOLATION_STORM_THRESHOLD,
} from './fallback';

const rendering: ResourceViewState = { phase: 'rendering', html: '<p>hi</p>', ready: true };

describe('isViolationStorm', () => {
  it('tolerates counts below the threshold', () => {
    expect(isViolationStorm({ malformed: 4, violations: 5 })).toBe(false);
  });
  it('trips at the combined threshold', () => {
    expect(isViolationStorm({ malformed: 5, violations: 5 })).toBe(true);
    expect(isViolationStorm({ malformed: VIOLATION_STORM_THRESHOLD, violations: 0 })).toBe(true);
  });
});

describe('reduceResourceView', () => {
  it('loading → rendering when html arrives, then ready on ui/ready', () => {
    const afterHtml = reduceResourceView({ phase: 'loading' }, { type: 'html', html: '<p>x</p>' });
    expect(afterHtml).toEqual({ phase: 'rendering', html: '<p>x</p>', ready: false });
    expect(reduceResourceView(afterHtml, { type: 'ready' })).toEqual({
      phase: 'rendering',
      html: '<p>x</p>',
      ready: true,
    });
  });

  it('resources/read failure selects the fallback', () => {
    const state = reduceResourceView({ phase: 'loading' }, { type: 'read-failed', detail: 'boom' });
    expect(state).toEqual({ phase: 'fallback', reason: 'read-failed', detail: 'boom' });
  });

  it('load error and render crash select the fallback', () => {
    expect(reduceResourceView(rendering, { type: 'load-error', detail: 'x' })).toMatchObject({
      phase: 'fallback',
      reason: 'load-error',
    });
    expect(reduceResourceView(rendering, { type: 'render-crash', detail: 'x' })).toMatchObject({
      phase: 'fallback',
      reason: 'render-crash',
    });
  });

  it('bridge counts below the storm threshold do NOT trigger fallback', () => {
    expect(reduceResourceView(rendering, { type: 'counts', malformed: 1, violations: 2 })).toBe(
      rendering,
    );
  });

  it('a violation storm triggers the fallback', () => {
    expect(
      reduceResourceView(rendering, { type: 'counts', malformed: 6, violations: 6 }),
    ).toMatchObject({ phase: 'fallback', reason: 'violation-storm' });
  });

  it('fallback is terminal — later events cannot resurrect the WebView', () => {
    const fallback = reduceResourceView(rendering, { type: 'render-crash', detail: 'x' });
    expect(reduceResourceView(fallback, { type: 'html', html: '<p>y</p>' })).toBe(fallback);
    expect(reduceResourceView(fallback, { type: 'ready' })).toBe(fallback);
  });
});
