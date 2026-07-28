# Stage 7: Fix: allow cleartext http to private-network agents

- **Type:** bug
- **Depends on:** none

## Objectives

Fix GitHub issue #16, found during the v0.1.1 device smoke: the release APK
cannot connect to ANY `http://` agent — Android 9+ kills cleartext app
traffic by OS policy unless `usesCleartextTraffic` is declared, and app.json
never declared it. The same phone's browser reaching the same URL (contract
401 JSON) proves the network path; the app's fetch dies before a packet
leaves. Complete connectivity blocker: the entire agent topology is
private-network http (tailnet — WireGuard-encrypted at the network layer — or
LAN), per idea.md §3 assumptions.

## What to build

- `app.json`: `expo.android.usesCleartextTraffic: true`, with a comment-style
  rationale recorded here (app.json cannot carry comments): private-network
  agents only, bearer auth per contract, tailnet path encrypted by WireGuard;
  revisit with a scoped networkSecurityConfig if a public-endpoint capability
  ever ships.
- Regression assertion in `scripts/check-release-config.mjs` (runs in the CI
  workflows-lint job): `expo.android.usesCleartextTraffic === true` — fails
  the build if the flag ever silently drops out (e.g. a config regeneration).

## Interface contracts

- **Exposes / Consumes:** nothing new. Contracts untouched. No code paths
  change — OS-policy configuration only.

## Testing requirements

- The check-release-config assertion IS the regression test (config-class
  bug → config-class test; jest/Node cannot observe Android network policy).
  Verified fails-before/passes-after by running the script against the
  unmodified and modified app.json.
- Device verification (operator, post-release): the v0.1.1 smoke's
  add-connection step against `http://<lan-ip>:8788` succeeds — same step
  that produced the screenshot in #16.

## Acceptance conditions

- [ ] Reproduction captured (issue #16 screenshot + browser-vs-app evidence) +
      regression assertion (fails before, passes after)
- [ ] Existing suite stays green; CI all-green

## Process note

Executed inline by the Stage Manager (deviation from the delegate-to-executor
default): the diff is two lines of config plus one assertion, and the
device-blocked operator is waiting on it.

## Pipeline test: NO
