/**
 * Enforces the stage-12 acceptance condition: **no raw colour literal anywhere
 * in `src/`** outside the palette.
 *
 * This exists as a TEST rather than as a grep someone runs by hand, because a
 * hand-run grep gets shaped to the claim it is meant to check. The first
 * attempt at verifying this condition matched only `#rrggbb` and therefore
 * could not see the two `rgba(...)` scrims that were actually present — it
 * reported a pass. A test in CI cannot be narrowed after the fact without the
 * narrowing showing up in a diff.
 *
 * `src/theme/tokens.ts` is the ONE place a colour may be spelled; every other
 * file asks the palette for a meaning.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(__dirname, '..');

/** The only file allowed to name a colour, plus this file (it quotes the patterns). */
const ALLOWED = new Set(['theme/tokens.ts', 'theme/no-raw-colours.test.ts']);

/** hex (#abc / #aabbcc / #aabbccdd), rgb()/rgba(), hsl()/hsla(). */
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/;

const sourceFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
};

describe('colour literals', () => {
  it('appear ONLY in the palette', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file).split('\\').join('/');
      if (ALLOWED.has(rel)) continue;

      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (COLOUR.test(line)) offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
        });
    }

    expect(offenders).toEqual([]);
  });

  it('the detector actually catches every form it claims to', () => {
    // Guards against the failure that motivated this file: a pattern narrowed
    // until it stops finding anything.
    for (const sample of [
      "backgroundColor: '#fff',",
      "color: '#1a2b3c',",
      "borderColor: '#1a2b3c80',",
      "backgroundColor: 'rgba(0,0,0,0.4)',",
      "backgroundColor: 'rgb(0, 0, 0)',",
      "backgroundColor: 'hsl(210, 50%, 40%)',",
      "backgroundColor: 'hsla(210, 50%, 40%, 0.5)',",
    ]) {
      expect(COLOUR.test(sample)).toBe(true);
    }
  });

  it('does not fire on things that merely look like colours', () => {
    for (const sample of [
      "const id = 'abc123';",
      '// see https://example.com/#anchor-name',
      "const key = 'ui/tools';",
      'const n = rgb;',
    ]) {
      expect(COLOUR.test(sample)).toBe(false);
    }
  });
});
