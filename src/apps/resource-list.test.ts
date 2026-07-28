/**
 * Stage 11: the list-state invariant — once a list is known, no event takes it
 * away — plus reconciliation identity semantics.
 */

import type { McpResourceDescriptor } from '@/mcp/client';
import {
  INITIAL_RESOURCE_LIST_STATE,
  type ResourceListState,
  reconcileResources,
  reduceResourceList,
  sameDescriptor,
} from './resource-list';

const r = (uri: string, overrides: Partial<McpResourceDescriptor> = {}): McpResourceDescriptor => ({
  uri,
  name: `name-${uri}`,
  mimeType: 'text/html',
  ...overrides,
});

const ready = (
  resources: McpResourceDescriptor[],
): Extract<ResourceListState, { status: 'ready' }> => ({
  status: 'ready',
  resources,
  refreshing: false,
  staleError: null,
});

describe('sameDescriptor', () => {
  it('ignores key order inside _meta', () => {
    const a = r('ui://a', { _meta: { 'ui/tools': ['x'], other: { p: 1, q: 2 } } });
    const b = r('ui://a', { _meta: { other: { q: 2, p: 1 }, 'ui/tools': ['x'] } });
    expect(sameDescriptor(a, b)).toBe(true);
  });

  it('treats a change to ui/tools as a real change (it changes the allowlist)', () => {
    const a = r('ui://a', { _meta: { 'ui/tools': ['jobs_list'] } });
    const b = r('ui://a', { _meta: { 'ui/tools': ['jobs_list', 'jobs_kill'] } });
    expect(sameDescriptor(a, b)).toBe(false);
  });

  it('distinguishes absent _meta from empty _meta', () => {
    expect(sameDescriptor(r('ui://a'), r('ui://a', { _meta: {} }))).toBe(false);
  });
});

describe('reconcileResources', () => {
  it('returns the PREVIOUS array reference when nothing changed', () => {
    const previous = [r('ui://a'), r('ui://b')];
    const next = [r('ui://a'), r('ui://b')]; // fresh objects, as listResources builds
    expect(reconcileResources(previous, next)).toBe(previous);
  });

  it('keeps object identity for unchanged entries when others change', () => {
    const previous = [r('ui://a'), r('ui://b')];
    const next = [r('ui://a'), r('ui://b', { name: 'renamed' })];
    const merged = reconcileResources(previous, next);
    expect(merged).not.toBe(previous);
    expect(merged[0]).toBe(previous[0]);
    expect(merged[1]).toEqual(next[1]);
  });

  it('adds new resources', () => {
    const previous = [r('ui://a')];
    const merged = reconcileResources(previous, [r('ui://a'), r('ui://new')]);
    expect(merged.map((e) => e.uri)).toEqual(['ui://a', 'ui://new']);
    expect(merged[0]).toBe(previous[0]);
  });

  it('drops removed resources', () => {
    const merged = reconcileResources([r('ui://a'), r('ui://gone')], [r('ui://a')]);
    expect(merged.map((e) => e.uri)).toEqual(['ui://a']);
  });

  it('treats a version bump as an add plus a remove (the version is in the uri)', () => {
    const merged = reconcileResources([r('ui://n/jobs@v1')], [r('ui://n/jobs@v2')]);
    expect(merged.map((e) => e.uri)).toEqual(['ui://n/jobs@v2']);
  });

  it('updates in place when the same uri changes its _meta', () => {
    const previous = [r('ui://a', { _meta: { 'ui/tools': ['jobs_list'] } })];
    const next = [r('ui://a', { _meta: { 'ui/tools': ['jobs_list', 'jobs_kill'] } })];
    const merged = reconcileResources(previous, next);
    expect(merged).toHaveLength(1);
    expect(merged[0]).not.toBe(previous[0]);
    expect(merged[0]._meta).toEqual({ 'ui/tools': ['jobs_list', 'jobs_kill'] });
  });

  it('follows server order, and a pure reorder is a real change', () => {
    const previous = [r('ui://a'), r('ui://b')];
    const merged = reconcileResources(previous, [r('ui://b'), r('ui://a')]);
    expect(merged).not.toBe(previous);
    expect(merged.map((e) => e.uri)).toEqual(['ui://b', 'ui://a']);
    // identity still reused, just repositioned
    expect(merged[0]).toBe(previous[1]);
    expect(merged[1]).toBe(previous[0]);
  });
});

describe('reduceResourceList — initial load', () => {
  it('starts loading and lands on ready', () => {
    const started = reduceResourceList(INITIAL_RESOURCE_LIST_STATE, { type: 'refresh-started' });
    expect(started).toEqual({ status: 'initial-loading' });
    const done = reduceResourceList(started, {
      type: 'refresh-succeeded',
      resources: [r('ui://a')],
    });
    expect(done).toEqual({
      status: 'ready',
      resources: [r('ui://a')],
      refreshing: false,
      staleError: null,
    });
  });

  it('a FIRST-load failure has no list to keep → initial-error (FallbackCard)', () => {
    const failed = reduceResourceList(INITIAL_RESOURCE_LIST_STATE, {
      type: 'refresh-failed',
      detail: 'boom',
    });
    expect(failed).toEqual({ status: 'initial-error', detail: 'boom' });
  });

  it('retrying after an initial error goes back to loading', () => {
    const failed: ResourceListState = { status: 'initial-error', detail: 'boom' };
    expect(reduceResourceList(failed, { type: 'refresh-started' })).toEqual({
      status: 'initial-loading',
    });
  });
});

describe('reduceResourceList — refresh over a known list', () => {
  it('a refresh in flight keeps the list and flags refreshing', () => {
    const state = reduceResourceList(ready([r('ui://a')]), { type: 'refresh-started' });
    expect(state).toMatchObject({ status: 'ready', refreshing: true });
    if (state.status !== 'ready') throw new Error('unreachable');
    expect(state.resources.map((e) => e.uri)).toEqual(['ui://a']);
  });

  it('A FAILED REFRESH LEAVES THE LAST KNOWN LIST INTACT', () => {
    const known = ready([r('ui://a'), r('ui://b')]);
    const refreshing = reduceResourceList(known, { type: 'refresh-started' });
    const failed = reduceResourceList(refreshing, { type: 'refresh-failed', detail: 'network' });

    expect(failed.status).toBe('ready');
    if (failed.status !== 'ready') throw new Error('unreachable');
    expect(failed.resources).toBe(known.resources); // same reference, untouched
    expect(failed.refreshing).toBe(false);
    expect(failed.staleError).toBe('network');
  });

  it('a later success clears the stale error and reconciles', () => {
    const stale: ResourceListState = {
      status: 'ready',
      resources: [r('ui://a')],
      refreshing: false,
      staleError: 'network',
    };
    const recovered = reduceResourceList(stale, {
      type: 'refresh-succeeded',
      resources: [r('ui://a'), r('ui://b')],
    });
    expect(recovered).toMatchObject({ status: 'ready', staleError: null, refreshing: false });
    expect(recovered.status === 'ready' && recovered.resources.map((e) => e.uri)).toEqual([
      'ui://a',
      'ui://b',
    ]);
  });

  it('NO event sequence can blank a known list', () => {
    const events = [
      { type: 'refresh-started' },
      { type: 'refresh-failed', detail: 'a' },
      { type: 'refresh-started' },
      { type: 'refresh-failed', detail: 'b' },
      { type: 'refresh-started' },
    ] as const;
    let state: ResourceListState = ready([r('ui://a')]);
    for (const event of events) {
      state = reduceResourceList(state, event);
      if (state.status !== 'ready') throw new Error('a known list must never be blanked');
      expect(state.resources).toHaveLength(1);
    }
  });

  it('a no-op refresh preserves the array reference through the reducer', () => {
    const known = ready([r('ui://a')]);
    const after = reduceResourceList(known, {
      type: 'refresh-succeeded',
      resources: [r('ui://a')],
    });
    expect(after.status === 'ready' && after.resources).toBe(known.resources);
  });
});
