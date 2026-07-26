import { BadRequestException, Body, Controller, Get, Headers, Patch } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { CompanyService } from './company.service';
import { RequirePermissions } from '../auth/decorators';

function company(id?: string): string {
  if (!id) throw new BadRequestException('Missing X-Company-Id header.');
  return id;
}

@ApiTags('company')
@ApiHeader({ name: 'X-Company-Id', required: true })
@Controller('company')
export class CompanyController {
  constructor(private readonly svc: CompanyService) {}

  @Get()
  get(@Headers('x-company-id') cid: string) {
    return this.svc.get(company(cid));
  }

  @Patch()
  @RequirePermissions('company:manage')
  update(@Headers('x-company-id') cid: string, @Body() body: Record<string, unknown>) {
    return this.svc.update(company(cid), body);
  }
}
