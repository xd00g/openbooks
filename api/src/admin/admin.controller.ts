import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { AdminOrgService } from './admin-org.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { PERMISSION_CATALOG } from '../auth/permissions.catalog';

function company(id?: string): string {
  if (!id) throw new BadRequestException('Missing X-Company-Id header.');
  return id;
}

@ApiTags('admin')
@ApiHeader({ name: 'X-Company-Id', required: true })
@Controller('admin')
export class AdminController {
  constructor(
    private readonly svc: AdminService,
    private readonly org: AdminOrgService,
    private readonly attachments: AttachmentsService,
  ) {}

  // ---- Organization-wide (cross-company) management ----------------------

  @Get('org/users')
  @RequirePermissions('user:manage')
  orgUsers(@Headers('x-company-id') cid: string) {
    return this.org.listUsers(company(cid));
  }

  @Post('org/users')
  @RequirePermissions('user:manage')
  createUser(@Headers('x-company-id') cid: string, @Body() body: { email: string; fullName?: string; password: string }) {
    return this.org.createUser(company(cid), body);
  }

  @Patch('org/users/:id')
  @RequirePermissions('user:manage')
  updateUser(
    @Headers('x-company-id') cid: string,
    @Param('id') id: string,
    @Body() body: { fullName?: string; isActive?: boolean },
    @CurrentUser() user: { id: string },
  ) {
    return this.org.updateUser(company(cid), id, body, user?.id);
  }

  @Post('org/users/:id/reset-password')
  @RequirePermissions('user:manage')
  resetPassword(@Headers('x-company-id') cid: string, @Param('id') id: string, @Body() body: { password: string }) {
    return this.org.resetPassword(company(cid), id, body?.password);
  }

  @Get('org/companies')
  @RequirePermissions('user:manage')
  orgCompanies(@Headers('x-company-id') cid: string) {
    return this.org.listCompanies(company(cid));
  }

  @Get('org/roles')
  @RequirePermissions('user:manage')
  orgRoles(@Headers('x-company-id') cid: string) {
    return this.org.listRoles(company(cid));
  }

  /**
   * Permanently delete a company file and everything in it. No undo — recovery
   * means restoring a database backup (docs/RESTORE.md).
   *
   * The caller must retype the exact legal name in the body. Refuses to delete
   * the company you are currently working in, so the deletion is always made
   * deliberately from somewhere else.
   */
  @Delete('org/companies/:id')
  @RequirePermissions('company:delete')
  async purgeCompany(
    @Headers('x-company-id') cid: string,
    @Param('id') id: string,
    @Body() body: { confirmLegalName: string },
    @CurrentUser() user: { id: string },
  ) {
    if (id === company(cid)) {
      throw new BadRequestException(
        'Switch to a different company before deleting this one.',
      );
    }

    const result = await this.org.purgeCompany(
      company(cid),
      id,
      body?.confirmLegalName,
      user?.id,
    );

    // Only after the rows are gone. An orphaned object is recoverable; a row
    // pointing at a deleted object is not — so storage is always cleaned last,
    // and a failure here is reported rather than thrown, because the
    // irreversible part already succeeded.
    let objectsDeleted: number | null = null;
    let storageError: string | undefined;
    try {
      objectsDeleted = await this.attachments.deleteCompanyObjects(id);
    } catch (e) {
      storageError = (e as Error).message;
    }

    return { ...result, objectsDeleted, storageError };
  }

  @Post('org/memberships')
  @RequirePermissions('user:manage')
  assign(@Headers('x-company-id') cid: string, @Body() body: { userId: string; companyId: string; roleId: string }) {
    return this.org.assignMembership(company(cid), body.userId, body.companyId, body.roleId);
  }

  @Post('org/memberships/remove')
  @RequirePermissions('user:manage')
  unassign(@Headers('x-company-id') cid: string, @Body() body: { userId: string; companyId: string }) {
    return this.org.removeMembership(company(cid), body.userId, body.companyId);
  }

  @Get('members')
  @RequirePermissions('user:manage')
  members(@Headers('x-company-id') cid: string) {
    return this.svc.listMembers(company(cid));
  }

  @Post('members')
  @RequirePermissions('user:manage')
  addMember(
    @Headers('x-company-id') cid: string,
    @Body() body: { email: string; roleId: string; fullName?: string; password?: string },
  ) {
    return this.svc.addMember(company(cid), body);
  }

  @Patch('members/:userId')
  @RequirePermissions('user:manage')
  setRole(
    @Headers('x-company-id') cid: string,
    @Param('userId') userId: string,
    @Body() body: { roleId: string },
  ) {
    return this.svc.updateMemberRole(company(cid), userId, body.roleId);
  }

  @Delete('members/:userId')
  @RequirePermissions('user:manage')
  removeMember(@Headers('x-company-id') cid: string, @Param('userId') userId: string) {
    return this.svc.removeMember(company(cid), userId);
  }

  @Get('roles')
  @RequirePermissions('user:manage')
  roles(@Headers('x-company-id') cid: string) {
    return this.svc.listRoles(company(cid));
  }

  @Post('roles')
  @RequirePermissions('user:manage')
  createRole(
    @Headers('x-company-id') cid: string,
    @Body() body: { name: string; description?: string; permissions: string[] },
  ) {
    return this.svc.createRole(company(cid), body);
  }

  @Get('audit')
  @RequirePermissions('audit:view')
  audit(@Headers('x-company-id') cid: string) {
    return this.svc.listAudit(company(cid));
  }

  @Get('permissions')
  @RequirePermissions('user:manage')
  permissions() {
    return PERMISSION_CATALOG;
  }
}
