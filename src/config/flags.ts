/**
 * App-config-driven feature flags (stage-5 kill-switch requirement) — pure
 * resolution logic. The module that reads the actual app config lives in
 * ./apps-tab.ts (it imports expo-constants, which the pure-TS unit test
 * environment cannot load; the decision logic is fully tested here instead).
 *
 * APPS_TAB_ENABLED — dark-launch switch for the net-new Apps surface:
 * - Source of truth: `expo.extra.appsTabEnabled` in app.json (a boolean).
 *   Flipping it to `false` and rebuilding removes the Apps tab entirely
 *   (expo-router `href: null`), independent of what any agent advertises.
 * - When the key is ABSENT the flag defaults per the stage spec: ON in dev
 *   builds, OFF otherwise (dark-launch default-off for release builds).
 * - The tab ADDITIONALLY self-gates on the agent's `mcp-apps-ui` capability
 *   (src/app/apps.tsx) — the flag never widens what an agent offers.
 *
 * Documented for operators in docs/ui-smoke/stage-5-apps.md.
 */

/** Pure resolver: explicit boolean wins; absent → dev default. */
export const resolveAppsTabEnabled = (extraValue: unknown, isDev: boolean): boolean => {
  if (extraValue === true) return true;
  if (extraValue === false) return false;
  // Any non-boolean value is treated as absent — fail toward the default,
  // never toward accidentally enabling in release.
  return isDev;
};
