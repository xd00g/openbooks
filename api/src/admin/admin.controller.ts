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
import { RequirePermissions } from '../auth/decorators';

function company(id?: string): string {
  if (!id) throw new BadRequestException('Missing X-Company-Id header.');
  return id;
}

@ApiTags('admin')
@ApiHeader({ name: 'X-Company-Id', required: true })
@Controller('admin')
export class AdminController {
  constructor(private readonly svc: AdminService) {}

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
  @RequirePermissions('user:manage')
  audit(@Headers('x-company-id') cid: string) {
    return this.svc.listAudit(company(cid));
  }
}
