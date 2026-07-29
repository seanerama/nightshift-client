/**
 * Semantic colour tokens (stage 12, ADR 0008).
 *
 * Before this module the app spelled colour inline: 53 hardcoded literals
 * across 8 files, every one a light-mode value, while agent-served resources
 * already honoured dark mode through the ui-bridge `ui/theme` push. A dark
 * dashboard rendered inside a white app.
 *
 * Tokens are SEMANTIC, not descriptive: `danger`, not `red`. A screen asks for
 * the meaning and the palette decides the value, which is what makes a second
 * scheme a data change rather than an edit to every screen.
 *
 * Pure data + pure resolution, so this is unit tested in the node project with
 * no React and no device.
 */

export interface Palette {
  /** Screen background, behind everything. */
  background: string;
  /** Cards, sheets, inputs, bars — raised above `background`. */
  surface: string;
  /** Recessed blocks: agent bubbles, fallback bodies. */
  surfaceMuted: string;
  /** Secondary buttons and other low-emphasis fills. */
  surfaceSubtle: string;

  border: string;
  /** Higher-contrast outline: focused//interactive inputs. */
  borderStrong: string;

  text: string;
  textMuted: string;
  /** Text on top of `accent` (or any strong fill). */
  textInverse: string;

  accent: string;

  danger: string;
  dangerSurface: string;
  warn: string;
  warnSurface: string;
  success: string;
  successSurface: string;
  info: string;
  infoSurface: string;

  /**
   * Dimming layer behind a modal sheet. Scheme-specific on purpose: the same
   * 40% black that separates a sheet from a light page barely registers over an
   * already-dark one, so dark uses a heavier scrim.
   */
  scrim: string;

  /** Connection health dots (src/connections/health.ts). */
  healthOk: string;
  healthDegraded: string;
  healthUnreachable: string;
  healthUnknown: string;
}

export type Scheme = 'light' | 'dark';

/** Light values are the ones the app already shipped — this stage is a
 * behaviour-preserving move for anyone who never opens Settings. */
const light: Palette = {
  background: '#f9fafb',
  surface: '#ffffff',
  surfaceMuted: '#f3f4f6',
  surfaceSubtle: '#e5e7eb',

  border: '#d1d5db',
  borderStrong: '#9ca3af',

  text: '#111827',
  textMuted: '#6b7280',
  textInverse: '#ffffff',

  accent: '#2563eb',

  danger: '#b91c1c',
  dangerSurface: '#fee2e2',
  warn: '#b45309',
  warnSurface: '#fef9c3',
  success: '#15803d',
  successSurface: '#dcfce7',
  info: '#3730a3',
  infoSurface: '#e0e7ff',

  scrim: 'rgba(0, 0, 0, 0.4)',

  healthOk: '#22c55e',
  healthDegraded: '#f59e0b',
  healthUnreachable: '#ef4444',
  healthUnknown: '#9ca3af',
};

/** Dark values: surfaces lift as they come forward (background darkest,
 * surface lighter), and accents lighten so they stay legible on dark fills. */
const dark: Palette = {
  background: '#0b0b12',
  surface: '#16161f',
  surfaceMuted: '#1f1f2b',
  surfaceSubtle: '#2a2a38',

  border: '#3a3a48',
  borderStrong: '#5a5a6b',

  text: '#f3f4f6',
  textMuted: '#9ca3af',
  textInverse: '#0b0b12',

  accent: '#60a5fa',

  danger: '#fca5a5',
  dangerSurface: '#3f1d1d',
  warn: '#fcd34d',
  warnSurface: '#3b2f10',
  success: '#86efac',
  successSurface: '#12331f',
  info: '#c7d2fe',
  infoSurface: '#252a4d',

  scrim: 'rgba(0, 0, 0, 0.6)',

  healthOk: '#4ade80',
  healthDegraded: '#fbbf24',
  healthUnreachable: '#f87171',
  healthUnknown: '#6b7280',
};

export const PALETTES: Readonly<Record<Scheme, Palette>> = { light, dark };

export const paletteFor = (scheme: Scheme): Palette => PALETTES[scheme];
