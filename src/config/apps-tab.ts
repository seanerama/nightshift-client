/**
 * APPS_TAB_ENABLED, resolved once at module load from app config
 * (`expo.extra.appsTabEnabled` in app.json). Semantics and rationale live
 * with the tested resolver in ./flags.ts; this thin module exists only
 * because expo-constants cannot load in the pure-TS unit environment.
 */

import Constants from 'expo-constants';

import { resolveAppsTabEnabled } from './flags';

/** The stage-5 kill-switch (see docs/ui-smoke/stage-5-apps.md). */
export const APPS_TAB_ENABLED: boolean = resolveAppsTabEnabled(
  Constants.expoConfig?.extra?.appsTabEnabled,
  __DEV__,
);
