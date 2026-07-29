# Stage 15: Fix: unit-test files in src/app/ become crashing tabs

- **Type:** bug
- **Depends on:** 12

## Objectives

`src/app/` is expo-router's routes directory: **every** `.tsx` file in it becomes
a route, and in a `Tabs` layout an undeclared route still gets a tab. Three unit
test files were placed there, so the app shows phantom tabs that **crash on
tap** — they export no component, and their module body calls `describe`/`it`,
which do not exist outside jest.

**Reported from the field by the owner**, not by any check.

| File | Introduced by | Route created |
|---|---|---|
| `src/app/apps.test.tsx` | stage 11 (`97b5e8b`) | `/apps.test` |
| `src/app/settings.test.tsx` | stage 12 | `/settings.test` |
| `src/app/chat-copy.test.tsx` | stage 12 | `/chat-copy.test` |

`git tag --contains 97b5e8b` → **v0.4.0**, so the released APK ships one of
these. `main` currently has three.

## What to build

1. **Move the three files out of the routes directory** into `src/app-tests/`.
   Anywhere under `src/` works — jest's patterns are
   `<rootDir>/src/**/*.test.ts` and `<rootDir>/src/**/*.test.tsx` — but it must
   be **outside `src/app/`**. Nothing about the tests themselves changes except
   their relative requires, which currently reach for their subject by `./`:
   - `apps.test.tsx` → `require('./apps')` becomes `../app/apps`
   - `settings.test.tsx` → `require('./settings')` becomes `../app/settings`
   - `chat-copy.test.tsx` → `require('./index')` becomes `../app/index`

   Do **not** try to solve this with an expo-router ignore rule. Its ignore list
   is `[/^\.\/\+(html|native-intent)\.[tj]sx?$/]` plus `+api`/`+middleware`
   (`getRoutesCore.js`) — there is **no `.test.` exclusion and no `_`-prefix
   exclusion**, so `src/app/__tests__/` would still be routed. Keeping tests out
   of the directory is the fix that does not depend on framework internals.

2. **Guard test so this cannot recur.** For every file in `src/app/` other than
   `_layout.tsx`, assert both:
   - it is **not** a `.test.`/`.spec.` file; and
   - it contains a **default export** — a route without one is precisely the
     crash being fixed.

   Assert the behaviour, not a hard-coded file list: stages 13 and 14 add UI and
   may add legitimate routes, and a guard that must be edited for every new
   route will be edited without thought. Give it must-catch and must-not-fire
   samples in both directions, the way `no-raw-colours.test.ts` does — that is
   what stops a future narrowing from passing quietly.

3. **Add the tab-bar assertion to the stage-11 smoke doc**
   (`docs/ui-smoke/stage-11-live-apps.md`). That doc governs the **released**
   build and never mentioned the tab bar, which is why the smoke would not have
   caught this even if it had been run. Stage 12's doc already asserts the bar
   reads Chat / Apps / Connections / Settings — one stage too late.
   State the expected tab set explicitly: **exactly four tabs, no others.**

## Interface contracts

- **Exposes:** nothing new.
- **Consumes:** nothing new. `contracts/app-ingress.md` and
  `contracts/ui-bridge.md` are **untouched** — this is a file-layout defect with
  no wire surface. No new contract, no ADR, no schema change.

## Testing requirements

- **Regression test (the acceptance condition for a bug):** the guard in (2).
  It must **fail** if a `.test.tsx` file is placed in `src/app/`, and fail if a
  file there has no default export. Demonstrate both by planting each violation,
  observing the failure names the file, and removing it — do not merely assert
  that the guard passes today.
- Existing suites keep passing unchanged after the move (the three moved files
  must still run and still pass — confirm they are still being collected, not
  silently skipped; check the reported suite count does not drop).
- No new UI-smoke asset — this stage adds no user-facing surface. It **amends**
  the stage-11 doc per (3).

## Acceptance conditions

- [ ] Regression test covers the reported defect and is proven to fail without
      the fix (both violation forms)
- [ ] `src/app/` contains only `_layout.tsx` and real routes
- [ ] Suite count does not drop — the moved tests still run
- [ ] Stage-11 smoke doc asserts the exact tab set
- [ ] `contracts/app-ingress.md` and `contracts/ui-bridge.md` byte-unchanged
- [ ] Existing suite stays green; CI all-green

## Pipeline test: NO

## Deferred (recorded)

- **A v0.4.1 patch release is required and is NOT part of this stage.** Fixing
  `main` does not fix the APK already on the owner's device; the artifact is
  built. The Release/Deploy Operator cuts v0.4.1 after this merges. Recorded
  here so the field defect is not considered closed at merge.
- **Widen the `structure` CI job.** It currently only checks that `README.md`
  and `LICENSE` exist, which is why nothing caught this. The guard in (2) covers
  this specific class from inside the test suite; whether `structure` should
  grow real repo-layout checks is a separate chore.
