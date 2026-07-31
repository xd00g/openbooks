import { isValidPermissionGrant } from '../permissions.catalog';

describe('isValidPermissionGrant', () => {
  it('accepts the superuser wildcard', () => {
    expect(isValidPermissionGrant('*')).toBe(true);
  });

  it('accepts a resource wildcard for a real resource', () => {
    expect(isValidPermissionGrant('sales:*')).toBe(true);
  });

  it('rejects a resource wildcard for a resource that does not exist', () => {
    expect(isValidPermissionGrant('invoice:*')).toBe(false);
  });

  it('accepts a known exact permission', () => {
    expect(isValidPermissionGrant('sales:manage')).toBe(true);
  });

  it('rejects a misspelled permission', () => {
    expect(isValidPermissionGrant('sales:mange')).toBe(false);
  });
});
