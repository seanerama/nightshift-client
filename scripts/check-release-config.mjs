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

console.log('check:release-config OK');
