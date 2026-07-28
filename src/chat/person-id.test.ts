/**
 * Unit: resolvePersonId — the ONLY place the app-default fallback lives
 * (stage 10). Send sites consume ActiveConnection.personId, which the
 * connections context builds with exactly this function.
 */

import { OWNER_PERSON_ID, resolvePersonId } from './person-id';

describe('resolvePersonId', () => {
  it('falls back to the app default for null (pre-v3 rows / blank field)', () => {
    expect(resolvePersonId(null)).toBe(OWNER_PERSON_ID);
  });

  it('falls back to the app default for undefined', () => {
    expect(resolvePersonId(undefined)).toBe(OWNER_PERSON_ID);
  });

  it('defensively falls back for empty and whitespace-only strings', () => {
    expect(resolvePersonId('')).toBe(OWNER_PERSON_ID);
    expect(resolvePersonId('   ')).toBe(OWNER_PERSON_ID);
  });

  it('returns a stored value verbatim (trimmed)', () => {
    expect(resolvePersonId('owner-alpha')).toBe('owner-alpha');
    expect(resolvePersonId('  owner-alpha  ')).toBe('owner-alpha');
  });

  it('the default is the canonical example owner id (stage-4 pin, unchanged)', () => {
    expect(OWNER_PERSON_ID).toBe('owner-nightshift');
  });
});
