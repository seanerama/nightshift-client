/**
 * Stage 11: debounce + coalesce on the single refresh entry point.
 *
 * The properties that matter to the agent on the other end: a burst is ONE
 * call, and two fetches are never in flight at once.
 */

import type { McpResourceDescriptor } from '@/mcp/client';
import { createRefreshController, REFRESH_DEBOUNCE_MS } from './refresh-controller';

const resources: McpResourceDescriptor[] = [{ uri: 'ui://a' }];

const harness = () => {
  const onStarted = jest.fn();
  const onSucceeded = jest.fn();
  const onFailed = jest.fn();
  let inFlight = 0;
  let maxConcurrent = 0;
  const pending: Array<{
    resolve: (value: readonly McpResourceDescriptor[]) => void;
    reject: (reason: Error) => void;
  }> = [];

  const fetchList = jest.fn(
    () =>
      new Promise<readonly McpResourceDescriptor[]>((resolve, reject) => {
        inFlight += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        pending.push({
          resolve: (value) => {
            inFlight -= 1;
            resolve(value);
          },
          reject: (reason) => {
            inFlight -= 1;
            reject(reason);
          },
        });
      }),
  );

  const controller = createRefreshController({ fetchList, onStarted, onSucceeded, onFailed });
  const settle = async (outcome: 'ok' | 'fail' = 'ok') => {
    const next = pending.shift();
    if (next === undefined) throw new Error('no fetch in flight to settle');
    if (outcome === 'ok') next.resolve(resources);
    else next.reject(new Error('network down'));
    await Promise.resolve();
    await Promise.resolve();
  };

  return {
    controller,
    fetchList,
    onStarted,
    onSucceeded,
    onFailed,
    settle,
    pendingCount: () => pending.length,
    maxConcurrent: () => maxConcurrent,
  };
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('createRefreshController', () => {
  it('collapses a burst of requests into ONE fetch', async () => {
    const h = harness();
    for (let i = 0; i < 10; i += 1) h.controller.request();
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);

    expect(h.fetchList).toHaveBeenCalledTimes(1);
    expect(h.onStarted).toHaveBeenCalledTimes(1);
    await h.settle();
    expect(h.onSucceeded).toHaveBeenCalledWith(resources);
  });

  it('does not fetch before the debounce window elapses', () => {
    const h = harness();
    h.controller.request();
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS - 1);
    expect(h.fetchList).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(h.fetchList).toHaveBeenCalledTimes(1);
  });

  it('a gesture skips the debounce entirely', () => {
    const h = harness();
    h.controller.request({ immediate: true });
    expect(h.fetchList).toHaveBeenCalledTimes(1);
  });

  it('never runs two fetches concurrently, and runs ONE follow-up after settle', async () => {
    const h = harness();
    h.controller.request({ immediate: true });
    expect(h.fetchList).toHaveBeenCalledTimes(1);

    // A stampede arrives while the first fetch is still outstanding.
    h.controller.request();
    h.controller.request({ immediate: true });
    h.controller.request();
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS * 3);
    expect(h.fetchList).toHaveBeenCalledTimes(1); // still just the one

    await h.settle();
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    expect(h.fetchList).toHaveBeenCalledTimes(2); // exactly one follow-up
    expect(h.maxConcurrent()).toBe(1);

    await h.settle();
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS * 3);
    expect(h.fetchList).toHaveBeenCalledTimes(2); // and it does not keep going
  });

  it('reports a failure and stays usable', async () => {
    const h = harness();
    h.controller.request({ immediate: true });
    await h.settle('fail');
    expect(h.onFailed).toHaveBeenCalledWith('network down');
    expect(h.onSucceeded).not.toHaveBeenCalled();

    h.controller.request({ immediate: true });
    await h.settle();
    expect(h.onSucceeded).toHaveBeenCalledWith(resources);
  });

  it('drains a queued request even when the in-flight fetch failed', async () => {
    const h = harness();
    h.controller.request({ immediate: true });
    h.controller.request();
    await h.settle('fail');
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    expect(h.fetchList).toHaveBeenCalledTimes(2);
  });

  it('dispose() cancels a pending debounce', () => {
    const h = harness();
    h.controller.request();
    h.controller.dispose();
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS * 5);
    expect(h.fetchList).not.toHaveBeenCalled();
  });

  it('dispose() swallows an in-flight result (no setState after unmount)', async () => {
    const h = harness();
    h.controller.request({ immediate: true });
    h.controller.dispose();
    await h.settle();
    expect(h.onSucceeded).not.toHaveBeenCalled();
    expect(h.onFailed).not.toHaveBeenCalled();
  });

  it('ignores requests after dispose()', () => {
    const h = harness();
    h.controller.dispose();
    h.controller.request({ immediate: true });
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS * 5);
    expect(h.fetchList).not.toHaveBeenCalled();
  });
});
