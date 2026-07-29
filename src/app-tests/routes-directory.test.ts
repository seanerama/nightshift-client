/**
 * Enforces that `src/app/` contains ONLY things that can actually be routes.
 *
 * Why this exists (stage 15 / issue #43): `src/app/` is expo-router's routes
 * directory. Every `.tsx` file in it becomes a route, and in a `Tabs` layout an
 * undeclared route still gets a tab. Three unit-test files were placed there and
 * SHIPPED IN v0.4.0 as phantom tabs that crashed on tap — they export no
 * component, and their module bodies call `describe`/`it`, which do not exist
 * outside jest.
 *
 * The framework is not at fault and cannot be configured out of it: expo-router's
 * ignore list is `+html`/`+native-intent` plus `+api`/`+middleware`
 * (`getRoutesCore.js`). There is no `.test.` rule and no `_`-prefix rule, so
 * `src/app/__tests__/` would be routed just the same.
 *
 * Deliberately BEHAVIOURAL rather than an allowlist of filenames: stages 13 and
 * 14 add UI and may add legitimate routes, and a guard that must be hand-edited
 * for every new route gets hand-edited without thought. The two rules below hold
 * for any real route and fail for the defect.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROUTES_DIR = join(__dirname, '..', 'app');

/** expo-router's own special files, which are not screens. */
const NOT_A_SCREEN = /^(_layout|\+html|\+not-found|\+native-intent|\+middleware)\./;

const TEST_FILE = /\.(test|spec)\.[tj]sx?$/;

const routeFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...routeFiles(full));
    } else if (/\.[tj]sx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
};

const rel = (file: string) => relative(ROUTES_DIR, file).split('\\').join('/');

describe('src/app/ (the expo-router routes directory)', () => {
  const files = routeFiles(ROUTES_DIR);

  it('contains no test or spec files — they become crashing tabs', () => {
    expect(files.map(rel).filter((f) => TEST_FILE.test(f))).toEqual([]);
  });

  it('every screen has a default export — a route without one crashes on open', () => {
    const missing = files
      .filter((f) => !NOT_A_SCREEN.test(rel(f).split('/').pop() ?? ''))
      .filter((f) => !/export\s+default/.test(readFileSync(f, 'utf8')))
      .map(rel);

    expect(missing).toEqual([]);
  });

  it('is not empty — a passing check over zero files proves nothing', () => {
    // Guards the guard: if the directory moved, the two rules above would pass
    // vacuously and this file would silently stop protecting anything.
    expect(files.length).toBeGreaterThan(0);
  });
});

describe('the guard’s own rules', () => {
  it.each([
    'apps.test.tsx',
    'settings.test.tsx',
    'chat-copy.test.tsx',
    'thing.spec.ts',
    'nested/deep.test.tsx',
  ])('recognises %s as a test file', (name) => {
    expect(TEST_FILE.test(name)).toBe(true);
  });

  it.each([
    'apps.tsx',
    'index.tsx',
    'connections.tsx',
    'latest.tsx',
    'protest.tsx',
  ])('does not mistake %s for a test file', (name) => {
    expect(TEST_FILE.test(name)).toBe(false);
  });

  it.each([
    '_layout.tsx',
    '+html.tsx',
    '+not-found.tsx',
  ])('treats %s as a non-screen (no default export required)', (name) => {
    expect(NOT_A_SCREEN.test(name)).toBe(true);
  });

  it.each(['apps.tsx', 'index.tsx', 'settings.tsx'])('treats %s as a screen', (name) => {
    expect(NOT_A_SCREEN.test(name)).toBe(false);
  });
});
