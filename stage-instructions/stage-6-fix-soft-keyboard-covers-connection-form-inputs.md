# Stage 6: Fix: soft keyboard covers connection form inputs

- **Type:** bug
- **Depends on:** none

## Objectives

Fix GitHub issue #13, found during the v0.1.0 device smoke: on the physical
Android device, tapping the URL or token field in the Add/Edit connection
modal raises the soft keyboard OVER the form — the focused input and the save
button are hidden, making first-run setup near-impossible. The v0.1.1
unblocker for the walking-skeleton smoke.

## What to build

- Keyboard handling for the connection form modal
  (`src/components/connection-form.tsx`, hosted by `src/app/index.tsx`):
  wrap the form content in `KeyboardAvoidingView` + a `ScrollView` with
  `keyboardShouldPersistTaps="handled"` so the focused field scrolls above
  the keyboard and taps on Save work while the keyboard is up.
- Consider `android.softwareKeyboardLayoutMode` in app.json ONLY if the
  component-level fix is insufficient — it is app-global, so prefer the local
  fix. Note SDK 57 edge-to-edge interacts with adjustResize; verify the
  chosen approach against it.
- Audit the OTHER text-input surface shipped in v0.1.0 (the chat composer,
  `src/app/chat.tsx`) for the same failure mode while in here; fix if
  affected (the composer sits at the screen bottom — prime suspect).

## Interface contracts

- **Exposes:** nothing new.
- **Consumes:** nothing new — pure UI-behavior fix. Contracts untouched.

## Testing requirements

- Regression test, honest about what jest can assert (no device rendering in
  CI): a component/structure test that fails on the v0.1.0 tree — e.g.
  assert the form's rendered element tree includes the KeyboardAvoidingView
  wrapper with correct behavior prop and the ScrollView with
  keyboardShouldPersistTaps, via react-test-renderer with native modules
  mocked. It must FAIL before the fix and PASS after.
- Device verification (operator, post-release): update
  `docs/ui-smoke/stage-3-connections.md` with an explicit keyboard step —
  "tap each field: the focused field and Save remain visible above the
  keyboard".

## Acceptance conditions

- [ ] Reproduction captured + a regression test (fails before, passes after)
- [ ] Chat composer audited for the same defect; fixed if affected
- [ ] UI-smoke script updated with the keyboard-visibility step
- [ ] Existing suite stays green; CI all-green

## Pipeline test: NO
