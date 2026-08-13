import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AdminOrgService } from '../admin-org.service';

/**
 * Company purge is the only unrecoverable operation in the product — the ledger
 * is otherwise immutable, and every other "delete" is a reversing entry. These
 * tests pin the guards that stand in front of it. Each one exists because
 * getting it wrong destroys a real business's books with no undo.
 */
describe('AdminOrgService.purgeCompany', () => {
  const CALLER_COMPANY = 'caller-company';
  const ORG_A = 'org-A';
  const TARGET = 'target-company';
  const TARGET_NAME = 'Hospice Del Sol';

  function makeAdmin(opts: { companiesInOrg?: number; targetInOrg?: boolean } = {}) {
    const { companiesInOrg = 3, targetInOrg = true } = opts;
    return {
      company: {
        findUnique: jest.fn(async () => ({ organizationId: ORG_A })),
        findFirst: jest.fn(async ({ where }: any) =>
          targetInOrg && where.id === TARGET && where.organizationId === ORG_A
            ? { id: TARGET, legalName: TARGET_NAME }
            : null,
        ),
        count: jest.fn(async () => companiesInOrg),
      },
      $transaction: jest.fn(async () => 2003),
    };
  }

  const svc = (admin: any) => new AdminOrgService(admin as any);

  it('purges when the org, the name and the company count all check out', async () => {
    const admin = makeAdmin();
    const result = await svc(admin).purgeCompany(CALLER_COMPANY, TARGET, TARGET_NAME, 'u1');

    expect(result).toEqual({
      companyId: TARGET,
      legalName: TARGET_NAME,
      rowsDeleted: 2003,
    });
    expect(admin.$transaction).toHaveBeenCalledTimes(1);
  });

  it('refuses a company outside the caller\'s organization', async () => {
    const admin = makeAdmin({ targetInOrg: false });
    await expect(
      svc(admin).purgeCompany(CALLER_COMPANY, TARGET, TARGET_NAME),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(admin.$transaction).not.toHaveBeenCalled();
  });

  describe('name confirmation', () => {
    it('refuses when the confirmation does not match', async () => {
      const admin = makeAdmin();
      await expect(
        svc(admin).purgeCompany(CALLER_COMPANY, TARGET, 'Hospice del Sol'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(admin.$transaction).not.toHaveBeenCalled();
    });

    it('refuses when the confirmation is missing entirely', async () => {
      const admin = makeAdmin();
      await expect(
        svc(admin).purgeCompany(CALLER_COMPANY, TARGET, undefined as never),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(admin.$transaction).not.toHaveBeenCalled();
    });

    it('tolerates surrounding whitespace, since it comes from a text input', async () => {
      const admin = makeAdmin();
      await expect(
        svc(admin).purgeCompany(CALLER_COMPANY, TARGET, `  ${TARGET_NAME}  `),
      ).resolves.toMatchObject({ companyId: TARGET });
    });

    it('names the expected value so the operator can see what to type', async () => {
      const admin = makeAdmin();
      await expect(
        svc(admin).purgeCompany(CALLER_COMPANY, TARGET, 'wrong'),
      ).rejects.toThrow(new RegExp(TARGET_NAME));
    });
  });

  it('refuses to delete the last company in the organization', async () => {
    // Otherwise the org's users are stranded: no company to select, and no
    // route back in.
    const admin = makeAdmin({ companiesInOrg: 1 });
    await expect(
      svc(admin).purgeCompany(CALLER_COMPANY, TARGET, TARGET_NAME),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(admin.$transaction).not.toHaveBeenCalled();
  });

  it('checks every guard before opening the transaction', async () => {
    // The transaction disables the ledger immutability triggers. Nothing that
    // can be rejected should ever get that far.
    for (const attempt of [
      () => svc(makeAdmin({ targetInOrg: false })).purgeCompany(CALLER_COMPANY, TARGET, TARGET_NAME),
      () => svc(makeAdmin()).purgeCompany(CALLER_COMPANY, TARGET, 'wrong'),
      () => svc(makeAdmin({ companiesInOrg: 1 })).purgeCompany(CALLER_COMPANY, TARGET, TARGET_NAME),
    ]) {
      await expect(attempt()).rejects.toBeTruthy();
    }
  });
});
