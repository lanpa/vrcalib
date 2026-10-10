import { describe, expect, it } from 'vitest';
import { describeError } from './errors';

describe('describeError', () => {
  it('explains permission errors (unpublished rules)', () => {
    const e = new Error("permission_denied at /sessions/abc: Client doesn't have permission to access the desired data.");
    expect(describeError(e)).toMatch(/rules may not be published/);
  });
  it('explains disabled anonymous sign-in', () => {
    expect(describeError(new Error('Firebase: Error (auth/admin-restricted-operation).'))).toMatch(/anonymous sign-in/);
  });
  it('passes other messages through', () => {
    expect(describeError('something odd')).toBe('something odd');
  });
});
