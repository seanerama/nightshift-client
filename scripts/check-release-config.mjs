// Machine-checkable half of the release pipeline (stage 2): asserts the
// eas.json shape that .github/workflows/release.yml depends on. Runs in CI
// (workflows-lint job) and locally via `npm run check:release-config`.
// Requires no Expo auth — it is exactly the part of the pipeline that CAN be
// validated before EXPO_TOKEN / `eas init` exist.
import { readFileSync } from 'node:fs';

const fail = (msg) => {
  console.error(`check:release-config FAILED — ${msg}`);
  process.exit(1);
};

const readJson = (relPath) => {
  try {
    return JSON.parse(readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8'));
  } catch (err) {
    fail(`${relPath} unreadable or not valid JSON: ${err.message}`);
  }
};

const eas = readJson('eas.json');

if (!eas.cli?.version) fail('cli.version (eas-cli version pin) missing');
if (!eas.cli?.appVersionSource) fail('cli.appVersionSource missing');

const prod = eas.build?.production;
if (!prod) fail('build.production profile missing');
if (prod.android?.buildType !== 'apk') {
  fail("build.production.android.buildType must be 'apk' — sideload target, ADR 0005");
}

const preview = eas.build?.preview;
if (!preview) fail('build.preview profile missing');
if (preview.android?.buildType !== 'apk') fail("build.preview.android.buildType must be 'apk'");
if (preview.distribution !== 'internal') fail("build.preview.distribution must be 'internal'");

if (Object.values(eas.build).some((profile) => profile.ios)) {
  fail('iOS build config present — out of scope until an iOS stage exists (ADR 0005)');
}

// The APK's application id must stay pinned in app.json.
const app = readJson('app.json');
if (!app.expo?.android?.package) fail('app.json expo.android.package missing');

// Agents are private-network http (tailnet/LAN — contract auth is bearer, the
// tailnet path is WireGuard-encrypted). Android kills cleartext app traffic
// unless the manifest declares it; without it the release APK cannot reach ANY
// agent (issue #16). Stage-7 lesson: `expo.android.usesCleartextTraffic` is
// NOT an Expo config field and prebuild ignores it silently — the working
// mechanism is the expo-build-properties plugin (manifest-verified in stage 8
// via `expo prebuild`). If a public-endpoint capability ever ships, replace
// with a scoped networkSecurityConfig instead of dropping the assertion.
const buildProps = (app.expo?.plugins ?? []).find(
  (entry) => Array.isArray(entry) && entry[0] === 'expo-build-properties',
);
if (buildProps?.[1]?.android?.usesCleartextTraffic !== true) {
  fail(
    'expo-build-properties plugin must set android.usesCleartextTraffic true — issue #16 (the bare expo.android field is silently ignored)',
  );
}

console.log('check:release-config OK');
