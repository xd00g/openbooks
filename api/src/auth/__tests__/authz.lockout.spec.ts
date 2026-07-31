import {
  grantsUserManage,
  wouldOrphanCompany,
  type MemberPermissionView,
} from '../authz';

describe('grantsUserManage', () => {
  it('accepts the exact permission', () => {
    expect(grantsUserManage(['user:manage'])).toBe(true);
  });

  it('accepts the superuser wildcard', () => {
    expect(grantsUserManage(['*'])).toBe(true);
  });

  it('accepts the resource wildcard', () => {
    expect(grantsUserManage(['user:*'])).toBe(true);
  });

  it('rejects unrelated permissions', () => {
    expect(grantsUserManage(['sales:manage', 'reports:view'])).toBe(false);
  });

  it('rejects an empty permission set', () => {
    expect(grantsUserManage([])).toBe(false);
  });
});

describe('wouldOrphanCompany', () => {
  const owner: MemberPermissionView = { userId: 'u1', permissions: ['*'] };
  const clerk: MemberPermissionView = { userId: 'u2', permissions: ['sales:manage'] };
  const admin2: MemberPermissionView = { userId: 'u3', permissions: ['user:manage'] };

  it('blocks demoting the only admin', () => {
    expect(
      wouldOrphanCompany([owner, clerk], { userId: 'u1', newPermissions: ['sales:manage'] }),
    ).toBe(true);
  });

  it('blocks removing the only admin', () => {
    expect(
      wouldOrphanCompany([owner, clerk], { userId: 'u1', newPermissions: null }),
    ).toBe(true);
  });

  it('allows demoting one admin when another remains', () => {
    expect(
      wouldOrphanCompany([owner, admin2], { userId: 'u1', newPermissions: ['sales:manage'] }),
    ).toBe(false);
  });

  it('allows removing a non-admin', () => {
    expect(
      wouldOrphanCompany([owner, clerk], { userId: 'u2', newPermissions: null }),
    ).toBe(false);
  });

  it('allows promoting a member to admin', () => {
    expect(
      wouldOrphanCompany([owner, clerk], { userId: 'u2', newPermissions: ['user:manage'] }),
    ).toBe(false);
  });

  it('treats a change to an unknown member as adding them', () => {
    expect(
      wouldOrphanCompany([owner], { userId: 'new', newPermissions: ['sales:manage'] }),
    ).toBe(false);
  });
});
