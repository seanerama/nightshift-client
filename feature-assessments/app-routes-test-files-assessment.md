# Bug assessment — unit-test files in `src/app/` become crashing tabs

- **Date:** 2026-07-29
- **Source:** owner report from the field ("the app crashes when I click on the
  app.test tab, is that supposed to be there?")
- **Verdict:** **ACCEPT as stage 15 (bug).** No contract change, no ADR.

## Claim / reality — verified against live source

| # | Claim | Reality | Verdict |
|---|---|---|---|
| 1 | A tab named `app.test` exists and crashes | `src/app/` holds `apps.test.tsx`, `settings.test.tsx`, `chat-copy.test.tsx`. `src/app/` is expo-router's routes directory, so each is a route; in a `Tabs` layout an undeclared route still gets a tab. | **CONFIRMED** |
| 2 | It crashes rather than rendering blank | `grep -c "export default"` → **0** for all three. No component to render, and the module body calls `describe`/`it`, undefined outside jest. | **CONFIRMED** |
| 3 | expo-router should have ignored test files | It should not and does not. Its ignore list is `[/^\.\/\+(html\|native-intent)\.[tj]sx?$/]` plus `+api`/`+middleware` (`getRoutesCore.js:102-110`). **No `.test.` rule, no `_`-prefix rule** — so `src/app/__tests__/` would also be routed. | **FRAMEWORK BEHAVES CORRECTLY; the layout was wrong** |
| 4 | The released build is affected | `git log --diff-filter=A -- src/app/apps.test.tsx` → `97b5e8b` (stage 11); `git tag --contains 97b5e8b` → **v0.4.0**. | **CONFIRMED — the shipped APK has it** |
| 5 | CI should have caught it | The `structure` job checks only that `README.md` and `LICENSE` exist. jest's `testMatch` is `src/**/*.test.tsx`, so tests pass from anywhere. Typecheck and lint are indifferent. No test renders the layout or enumerates routes. | **NO CHECK EXISTED** |
| 6 | The smoke docs should have caught it | The **stage-11** doc — which governs the released build — never mentions the tab bar. Stage 12's step 1 *does* assert the bar reads Chat / Apps / Connections / Settings and would have caught it, one stage too late. And the v0.4.0 device smoke was never run. | **GAP IN THE DOC THAT MATTERED** |
| 7 | Moving the files is enough | Their requires reach for their subject by `./` (`./apps`, `./settings`, `./index`), so a move needs those repointed. jest patterns are `src/**`, so any location under `src/` is collected. | **TRUE, with a caveat to spec** |

## How this escaped — three independent gaps, not one

Worth recording because the fix only closes the first:

1. **No structural check on the routes directory.** Now closed by the guard test
   in stage 15.
2. **The smoke doc for the released stage did not assert the tab bar.** Closed by
   amending the stage-11 doc. The general lesson: a smoke doc should assert what
   the user *sees first*, and none of mine asserted the app's own navigation
   until stage 12 happened to.
3. **The v0.4.0 device smoke was never run.** Not closable by code. It is the
   reason a defect that shipped on 2026-07-28 was found by the owner rather than
   by the gate that exists for exactly this.

Reviewer note: I was the reviewer on both stage 11 and stage 12 and did not
catch this in either pass. Both reviews verified acceptance conditions against
the diff — and the diff plainly contained `src/app/apps.test.tsx`. The condition
lists simply had no item about repository layout, so a file in the wrong
directory was invisible to a checklist-driven review. That is an argument for
the guard test over reviewer diligence.

## Impact and contract safety

**No contract touched, no ADR needed, no schema change.** This is a file-layout
defect with no wire surface. `app-ingress` v1 and `ui-bridge` v1 are
byte-unchanged, which is an explicit acceptance condition.

Kill-switch: **N/A** — this is a bug stage; the acceptance condition is a
regression test proven to fail without the fix.

## Scope decision

Fixing `main` does **not** fix the owner's phone. The v0.4.0 APK is already
built and carries `/apps.test`. A **v0.4.1 patch release is required** and is
deliberately *not* folded into this stage — releasing is the Release/Deploy
Operator's call, and bundling it here would hide the fact that the field defect
outlives the merge. Recorded in the stage's Deferred section so it is not
treated as closed at merge.

Also deferred: widening the `structure` CI job beyond "README and LICENSE
exist". The guard test covers this specific class from inside the suite; whether
that job should grow real repo-layout checks is a separate chore, not a
prerequisite.
