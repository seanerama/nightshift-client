/**
 * Apps resource-list state (stage 11).
 *
 * The list is no longer fetched once and forgotten — it refreshes on gesture,
 * on tab focus, and on a foreground poll (ADR 0006). That makes two states the
 * stage-5 code collapsed into one worth separating:
 *
 * - an INITIAL load, where there is no list yet and a failure has nothing to
 *   fall back to → the mandatory FallbackCard surface (ADR 0004); versus
 * - a REFRESH over a list we already have, where blanking the tab or replacing
 *   the list with an error card would destroy known-good content the user is
 *   looking at.
 *
 * Hence the invariant this reducer exists to enforce: **once a list is known,
 * no event can take it away.** A failed refresh keeps the last list and sets
 * `staleError`; a refresh in flight sets `refreshing`. Neither leaves `ready`.
 *
 * Reconciliation preserves object identity for entries that did not change,
 * and returns the PREVIOUS array reference when nothing changed at all, so a
 * no-op refresh causes no re-render churn downstream.
 */

import type { McpResourceDescriptor } from '@/mcp/client';

export type ResourceListState =
  /** No list yet: first load for this connection, or a retry after failure. */
  | { status: 'initial-loading' }
  /** First load failed; there is no list to show. FallbackCard territory. */
  | { status: 'initial-error'; detail: string }
  /** A list is known. It STAYS known — see the module invariant. */
  | {
      status: 'ready';
      resources: readonly McpResourceDescriptor[];
      /** A refresh is in flight over the list above. */
      refreshing: boolean;
      /** Last refresh failed; the list shown is the last known good one. */
      staleError: string | null;
    };

export type ResourceListEvent =
  | { type: 'refresh-started' }
  | { type: 'refresh-succeeded'; resources: readonly McpResourceDescriptor[] }
  | { type: 'refresh-failed'; detail: string };

export const INITIAL_RESOURCE_LIST_STATE: ResourceListState = { status: 'initial-loading' };

/** Order-insensitive structural comparison for the `_meta` extension bag. */
const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
};

/**
 * Do two descriptors describe the same thing? `_meta` is included because it
 * carries `ui/tools` (contracts/ui-bridge.md) — a change there changes what a
 * freshly opened resource may call, so it is a real change, not noise.
 */
export const sameDescriptor = (a: McpResourceDescriptor, b: McpResourceDescriptor): boolean =>
  a.uri === b.uri &&
  a.name === b.name &&
  a.mimeType === b.mimeType &&
  stableStringify(a._meta) === stableStringify(b._meta);

/**
 * Reconcile a freshly fetched list against the previous one.
 *
 * Server order wins (the agent decides presentation order). Unchanged entries
 * keep their PREVIOUS object identity; if every entry is unchanged and the
 * length and order match, the previous array itself is returned.
 *
 * A version bump — the agent republishing `…@v1` as `…@v2` — is an add plus a
 * remove, because the version is part of the uri. A same-uri change (name,
 * mimeType, `_meta`) is an update in place.
 */
export const reconcileResources = (
  previous: readonly McpResourceDescriptor[],
  next: readonly McpResourceDescriptor[],
): readonly McpResourceDescriptor[] => {
  const byUri = new Map(previous.map((entry) => [entry.uri, entry]));
  let identical = previous.length === next.length;

  const merged = next.map((entry, index) => {
    const prior = byUri.get(entry.uri);
    if (prior !== undefined && sameDescriptor(prior, entry)) {
      if (previous[index] !== prior) identical = false;
      return prior;
    }
    identical = false;
    return entry;
  });

  return identical ? previous : merged;
};

export const reduceResourceList = (
  state: ResourceListState,
  event: ResourceListEvent,
): ResourceListState => {
  switch (event.type) {
    case 'refresh-started':
      // A retry after a failed initial load goes back to loading; a refresh
      // over a known list never leaves `ready` (module invariant).
      if (state.status === 'ready') return { ...state, refreshing: true };
      return { status: 'initial-loading' };

    case 'refresh-succeeded': {
      const resources =
        state.status === 'ready'
          ? reconcileResources(state.resources, event.resources)
          : event.resources;
      return { status: 'ready', resources, refreshing: false, staleError: null };
    }

    case 'refresh-failed':
      // The whole point: a failed refresh costs the user nothing but freshness.
      if (state.status === 'ready') {
        return { ...state, refreshing: false, staleError: event.detail };
      }
      return { status: 'initial-error', detail: event.detail };
  }
};
