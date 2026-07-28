/**
 * Stage 11 / ADR 0007: open-resource lifetime semantics.
 */

import type { McpResourceDescriptor } from '@/mcp/client';
import { homeResourceToAutoOpen, isStillListed, noticeForClosedResource } from './open-resource';

const r = (uri: string, name?: string): McpResourceDescriptor => ({ uri, name });

describe('isStillListed', () => {
  it('matches by uri', () => {
    expect(isStillListed([r('ui://a'), r('ui://b')], 'ui://b')).toBe(true);
    expect(isStillListed([r('ui://a')], 'ui://b')).toBe(false);
  });

  it('a version bump means the old uri is gone', () => {
    expect(isStillListed([r('ui://n/jobs@v2')], 'ui://n/jobs@v1')).toBe(false);
  });
});

describe('noticeForClosedResource', () => {
  it('is silent when the resource is still listed', () => {
    expect(noticeForClosedResource(r('ui://a'), [r('ui://a')])).toBeNull();
  });

  it('names the resource when it vanished while open', () => {
    expect(noticeForClosedResource(r('ui://a', 'Jobs'), [r('ui://b')])).toBe(
      'Jobs is no longer offered by this agent.',
    );
  });

  it('falls back to the uri when the resource had no name', () => {
    expect(noticeForClosedResource(r('ui://a'), [])).toBe(
      'ui://a is no longer offered by this agent.',
    );
  });

  it('fires for a version bump — the opened version is genuinely gone', () => {
    expect(
      noticeForClosedResource(r('ui://n/jobs@v1', 'Jobs'), [r('ui://n/jobs@v2', 'Jobs')]),
    ).toBe('Jobs is no longer offered by this agent.');
  });
});

describe('homeResourceToAutoOpen', () => {
  const resources = [r('ui://n/jobs@v1', 'Jobs'), r('ui://n/status@v1')];

  it('opens the home resource on first sight of a connection', () => {
    expect(
      homeResourceToAutoOpen({
        uiHome: 'ui://n/jobs@v1',
        connectionId: 'conn-1',
        openedFor: null,
        resources,
      }),
    ).toEqual(r('ui://n/jobs@v1', 'Jobs'));
  });

  it('DOES NOT re-fire once this connection has auto-opened (refresh safety)', () => {
    expect(
      homeResourceToAutoOpen({
        uiHome: 'ui://n/jobs@v1',
        connectionId: 'conn-1',
        openedFor: 'conn-1',
        resources,
      }),
    ).toBeNull();
  });

  it('fires again for a different connection', () => {
    expect(
      homeResourceToAutoOpen({
        uiHome: 'ui://n/jobs@v1',
        connectionId: 'conn-2',
        openedFor: 'conn-1',
        resources,
      }),
    ).not.toBeNull();
  });

  it('no ui.home means nothing to open', () => {
    expect(
      homeResourceToAutoOpen({
        uiHome: null,
        connectionId: 'conn-1',
        openedFor: null,
        resources,
      }),
    ).toBeNull();
  });

  it('degrades to the plain list when the agent does not serve its declared home', () => {
    expect(
      homeResourceToAutoOpen({
        uiHome: 'ui://n/missing@v1',
        connectionId: 'conn-1',
        openedFor: null,
        resources,
      }),
    ).toBeNull();
  });
});
