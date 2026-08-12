import { NotFoundException } from '@nestjs/common';
import { AdminOrgService } from '../admin-org.service';

/**
 * AdminOrgService runs on the RLS-bypassing admin connection, and
 * PermissionsGuard only ever checks `user:manage` against the caller's own
 * X-Company-Id — it never looks at the `userId` in the path. Org scoping is
 * therefore the *only* thing standing between an Owner of one organization and
 * every user account in the deployment.
 *
 * These tests pin that boundary. They previously failed: resetPassword,
 * updateUser and removeMembership took `_currentCompanyId` and ignored it.
 */
describe('AdminOrgService org scoping', () => {
  const CALLER_COMPANY = 'company-in-org-A';
  const ORG_A = 'org-A';

  /** Victim belongs to org B; the caller is an Owner of org A. */
  const OUTSIDER = 'user-in-org-B';
  const INSIDER = 'user-in-org-A';

  function makeAdmin() {
    return {
      company: {
        findUnique: jest.fn(async () => ({ organizationId: ORG_A })),
        findFirst: jest.fn(async ({ where }: any) =>
          where.organizationId === ORG_A ? { id: where.id } : null,
        ),
      },
      membership: {
        // Only the insider has a membership in org A.
        findFirst: jest.fn(async ({ where }: any) =>
          where.userId === INSIDER && where.organizationId === ORG_A ? { id: 'm1' } : null,
        ),
        findMany: jest.fn(async () => []),
        delete: jest.fn(async () => ({})),
      },
      user: { update: jest.fn(async () => ({ id: INSIDER })) },
    };
  }

  let admin: ReturnType<typeof makeAdmin>;
  let svc: AdminOrgService;

  beforeEach(() => {
    admin = makeAdmin();
    svc = new AdminOrgService(admin as any);
  });

  describe('resetPassword', () => {
    it('refuses to reset the password of a user outside the caller\'s org', async () => {
      await expect(
        svc.resetPassword(CALLER_COMPANY, OUTSIDER, 'a-long-enough-password'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(admin.user.update).not.toHaveBeenCalled();
    });

    it('still works for a user inside the org', async () => {
      await expect(
        svc.resetPassword(CALLER_COMPANY, INSIDER, 'a-long-enough-password'),
      ).resolves.toEqual({ reset: true });

      expect(admin.user.update).toHaveBeenCalledTimes(1);
    });

    it('checks org membership before validating the password, so a short password cannot be used to probe', async () => {
      // Both rejections must look the same from outside: if a weak password
      // returned BadRequest for an existing user and NotFound for a missing
      // one, the endpoint would confirm which user ids exist.
      await expect(svc.resetPassword(CALLER_COMPANY, OUTSIDER, 'x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateUser', () => {
    it('refuses to deactivate a user outside the caller\'s org', async () => {
      await expect(
        svc.updateUser(CALLER_COMPANY, OUTSIDER, { isActive: false }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(admin.user.update).not.toHaveBeenCalled();
    });

    it('refuses to rename a user outside the caller\'s org', async () => {
      await expect(
        svc.updateUser(CALLER_COMPANY, OUTSIDER, { fullName: 'renamed' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(admin.user.update).not.toHaveBeenCalled();
    });
  });

  describe('removeMembership', () => {
    it('refuses to remove a membership for a user outside the caller\'s org', async () => {
      await expect(
        svc.removeMembership(CALLER_COMPANY, OUTSIDER, 'some-company'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(admin.membership.delete).not.toHaveBeenCalled();
    });

    it('refuses to remove a membership in a company outside the caller\'s org', async () => {
      // Target user is in org A, but the company named is not.
      admin.company.findFirst.mockResolvedValueOnce(null);

      await expect(
        svc.removeMembership(CALLER_COMPANY, INSIDER, 'company-in-org-B'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(admin.membership.delete).not.toHaveBeenCalled();
    });
  });
});
