# 0007. Rendered resource lifetime is decoupled from the resource list

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

ADR 0006 makes the Apps tab's resource list refresh repeatedly during a
session — on gesture, on focus, on a poll, and later on an agent push. The list
is now mutable state that changes underneath the user without their asking.

An open `ui://` resource is a live, stateful WebView: a half-filled form, a
scrolled dashboard, a bridge call in flight. In the current code the open
resource is looked up out of the list on every render
(`list.resources.find(r => r.uri === openUri)`), so a naive refresh implementation
would remount or unmount it whenever the list object changed — losing the user's
state as a side effect of a background fetch they never initiated. The
`ui.home` auto-open effect has the same hazard: it keys on `list`, and must not
re-fire on refresh, or a refresh would yank the user back to the home resource.

## Decision

**A change to the resource list MUST NOT reload, remount, or tear down a
currently rendered resource.** The user discovers changes in the *list*, never
by losing state mid-use.

Concretely:

- The open resource is pinned by an **owned descriptor snapshot**, captured when
  the user opens it, not re-derived from the live list on each render. A refresh
  replaces the list without touching that snapshot. `ResourceView` keeps a
  stable React key so it is never remounted by a list update.
- **A resource that vanishes from the list while open keeps running.** Closing
  it, then returning to the tab, shows a non-blocking notice that it is gone —
  a dismissible line above the list, never a modal, never a `FallbackCard`.
- **A version bump of the open resource does not hot-swap it.** The refreshed
  entry appears in the list; the running instance is left alone. Users adopt the
  new version by closing and reopening.
- The `ui.home` auto-open stays **once per connection** and must not re-fire on
  refresh. Its guard keys on the connection id, not on list identity.
- Refresh never blanks the tab. The last known list stays on screen while a
  refresh is in flight and after one fails (ADR 0006).

## Alternatives considered

The **contracts-first guide** is silent here — this is client-internal state
lifetime, below the frozen seams — so the constraint comes from ui-bridge v1's
sandbox model: the shell owns resource lifetime, and the resource cannot
re-establish its own state after a teardown.

- **Reconcile the open resource with the list too** — swap in the new descriptor
  on a version bump, close the view when the resource disappears. Keeps exactly
  one source of truth and guarantees the user is never looking at something
  stale. Rejected: it makes an agent-side publish able to destroy the owner's
  in-progress work, which is precisely the failure the brief forbids.
- **Prompt the user on a version bump** ("this app was updated — reload?").
  Preserves state and offers the new version. Rejected for v1 as unnecessary
  interruption for a rare event; the list entry already surfaces it, and this
  remains a clean additive follow-up if reloading ever proves worth offering.
- **Suspend refreshes while a resource is open.** Trivially satisfies the rule.
  Rejected: it makes the list stale exactly when the user is most engaged, and
  the "vanished while open" case still has to be handled on return anyway.

## Consequences

- The open-resource snapshot is a second copy of a descriptor and can go stale
  against the list. That is intended and must be stated in the code, or a later
  reader will "fix" it back into a lookup and silently reintroduce the teardown.
- This invariant is testable without a device: open a resource, refresh with a
  list that drops or bumps it, assert the rendered descriptor and the component
  identity are unchanged. It belongs in the stage's unit suite and is a standing
  regression gate for any future refresh trigger, including the SSE push in
  ADR 0006.
- Allowlist derivation is unaffected: the open resource keeps the allowlist
  derived from the snapshot it was opened with, so a refresh can neither widen
  nor narrow a running resource's tool access mid-flight. Freshly opened
  resources re-read `_meta["ui/tools"]` from the refreshed list as usual.
