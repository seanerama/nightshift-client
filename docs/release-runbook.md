# Release runbook — nightshift-client

> Method `eas-github-releases` (ADR 0005): EAS cloud build → APK on the GitHub
> Release page → sideload. Pipeline: `.github/workflows/release.yml`.
> Credential locations: `.verity/deploy-access.md` (gitignored).

## 1. One-time setup (before the first release)

1. **Log in to Expo** (interactive; inside a Claude Code session prefix with `!`):

   ```sh
   npx eas-cli login
   ```

2. **Link the EAS project** (writes `extra.eas.projectId` into `app.json` —
   commit that change in a follow-up commit/PR, it is not a secret):

   ```sh
   npx eas-cli init
   ```

3. **Create the CI token**: expo.dev → Account settings → Access tokens →
   create token, then store it as a repo Actions secret:

   ```sh
   gh secret set EXPO_TOKEN
   ```

4. **Keystore**: EAS generates and manages the Android keystore on the first
   build — accept the defaults. Inspect/back it up any time with:

   ```sh
   npx eas-cli credentials -p android
   ```

Optional dry run before tagging: Actions → Release → **Run workflow** on any
ref. Same build path; the APK lands as a workflow artifact, no release/tag is
created.

## 2. Cut a release

```sh
git tag v0.1.0            # from the commit on main you are releasing
git push origin v0.1.0
```

Watch Actions → Release. On success the tag's GitHub Release page holds
`nightshift-client-v0.1.0.apk`. If the run fails at "Preflight", the one-time
setup above is incomplete.

## 3. Verify

1. On the phone, open the release page, download the APK, install it
   (allow install-from-browser if prompted).
2. Launch the app — it must reach the placeholder tabs.
3. Record in `STATUS.md` → Releases: current released tag and installed
   on-device version, plus the Actions run URL in the release PR/notes.
