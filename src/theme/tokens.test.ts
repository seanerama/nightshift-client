/**
 * Unit: palette completeness (stage 12).
 *
 * The point of these is not to assert particular hex values — those are design
 * choices that may change — but that BOTH schemes define EVERY token. A missing
 * dark token renders as `undefined`, which React Native silently treats as "no
 * colour", i.e. invisible text. That is the failure mode worth locking.
 */

import { PALETTES, paletteFor } from './tokens';

const SCHEMES = ['light', 'dark'] as const;

describe('palettes', () => {
  it('define the same token set in both schemes', () => {
    expect(Object.keys(PALETTES.dark).sort()).toEqual(Object.keys(PALETTES.light).sort());
  });

  it.each(SCHEMES)('%s defines every token as a non-empty string', (scheme) => {
    const empty = Object.entries(paletteFor(scheme))
      .filter(([, value]) => typeof value !== 'string' || value.length === 0)
      .map(([token]) => token);
    expect(empty).toEqual([]);
  });

  it.each(SCHEMES)('%s has no undefined token (the invisible-text failure)', (scheme) => {
    expect(Object.values(paletteFor(scheme)).some((v) => v === undefined)).toBe(false);
  });

  it('actually differs between schemes — a copied palette would defeat the feature', () => {
    const light = paletteFor('light');
    const dark = paletteFor('dark');
    const differing = Object.keys(light).filter(
      (k) => light[k as keyof typeof light] !== dark[k as keyof typeof dark],
    );
    expect(differing.length).toBe(Object.keys(light).length);
  });

  it('paletteFor returns the matching palette', () => {
    expect(paletteFor('light')).toBe(PALETTES.light);
    expect(paletteFor('dark')).toBe(PALETTES.dark);
  });
});
