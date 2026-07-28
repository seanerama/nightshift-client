/**
 * The single refresh entry point for the Apps tab (stage 11, ADR 0006).
 *
 * Every trigger — the pull-to-refresh gesture, tab focus, the foreground poll,
 * and (later, once agent-app-contract#14 lands) a pushed resources-changed
 * event — calls `request()` on one of these. That is deliberate: the deferred
 * push stage adds an event branch and NO new refresh logic.
 *
 * Two behaviors it owes the caller:
 *
 * - **Debounce.** A burst of requests collapses into one fetch. Focus + poll +
 *   a pushed event can easily fire together; the agent should see one call.
 * - **Coalesce.** Requests arriving while a fetch is in flight never start a
 *   second concurrent fetch. They are remembered, and one follow-up runs after
 *   the current fetch settles — dropping them instead would lose exactly the
 *   change that prompted the request.
 *
 * A user gesture passes `immediate` to skip the debounce; it already waited on
 * a human, and the RefreshControl spinner is on screen.
 *
 * Fully injectable (fetch + callbacks), so it is tested in the node project
 * with fake timers — no React, no device.
 */

import type { McpResourceDescriptor } from '@/mcp/client';

/** Collapse window for non-gesture triggers. */
export const REFRESH_DEBOUNCE_MS = 400;

/**
 * Slow backstop beneath the gesture and focus triggers, NOT the primary
 * mechanism (ADR 0006). Deliberately longer than HEALTH_POLL_INTERVAL_MS:
 * health is a status dot the user watches, a resource list is not.
 */
export const RESOURCE_POLL_INTERVAL_MS = 60_000;

export interface RefreshControllerOptions {
  /** Fetch the current list. Rejection detail is surfaced verbatim. */
  fetchList: () => Promise<readonly McpResourceDescriptor[]>;
  onStarted: () => void;
  onSucceeded: (resources: readonly McpResourceDescriptor[]) => void;
  onFailed: (detail: string) => void;
  debounceMs?: number;
}

export interface RefreshController {
  /** Ask for a refresh. `immediate` skips the debounce (user gestures). */
  request: (options?: { immediate?: boolean }) => void;
  /** Stop timers and ignore any in-flight result. Idempotent. */
  dispose: () => void;
  /** Test/diagnostic seam — true while a fetch is outstanding. */
  isFetching: () => boolean;
}

export const createRefreshController = ({
  fetchList,
  onStarted,
  onSucceeded,
  onFailed,
  debounceMs = REFRESH_DEBOUNCE_MS,
}: RefreshControllerOptions): RefreshController => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fetching = false;
  let queued = false;
  let disposed = false;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const run = () => {
    if (disposed) return;
    fetching = true;
    onStarted();
    fetchList().then(
      (resources) => {
        fetching = false;
        // A result that arrived after dispose() belongs to a screen that is
        // gone; delivering it would be a setState on an unmounted tree.
        if (disposed) return;
        onSucceeded(resources);
        drainQueued();
      },
      (err: unknown) => {
        fetching = false;
        if (disposed) return;
        onFailed(err instanceof Error ? err.message : String(err));
        drainQueued();
      },
    );
  };

  // A request that arrived mid-fetch runs once, after settle, through the
  // normal debounce — so a stampede during a slow fetch still yields one call.
  const drainQueued = () => {
    if (!queued || disposed) return;
    queued = false;
    schedule();
  };

  const schedule = () => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (fetching) {
        queued = true;
        return;
      }
      run();
    }, debounceMs);
  };

  return {
    request: ({ immediate = false } = {}) => {
      if (disposed) return;
      if (fetching) {
        queued = true;
        return;
      }
      if (immediate) {
        clearTimer();
        run();
        return;
      }
      schedule();
    },
    dispose: () => {
      disposed = true;
      queued = false;
      clearTimer();
    },
    isFetching: () => fetching,
  };
};
