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
import { AccountsService } from './accounts.service';
import { RequirePermissions } from '../auth/decorators';

function company(id?: string): string {
  if (!id) throw new BadRequestException('Missing X-Company-Id header.');
  return id;
}

@ApiTags('accounts')
@ApiHeader({ name: 'X-Company-Id', required: true })
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(@Headers('x-company-id') cid: string) {
    return this.accounts.list(company(cid));
  }

  @Get(':id/register')
  register(@Headers('x-company-id') cid: string, @Param('id') id: string) {
    return this.accounts.register(company(cid), id);
  }

  @Post()
  @RequirePermissions('account:manage')
  create(
    @Headers('x-company-id') cid: string,
    @Body()
    body: {
      code: string;
      name: string;
      subtype: string;
      type?: string;
      parentId?: string;
      description?: string;
    },
  ) {
    return this.accounts.create(company(cid), body);
  }

  @Patch(':id')
  @RequirePermissions('account:manage')
  update(
    @Headers('x-company-id') cid: string,
    @Param('id') id: string,
    @Body()
    body: {
      code?: string;
      name?: string;
      subtype?: string;
      parentId?: string | null;
      description?: string;
      isActive?: boolean;
    },
  ) {
    return this.accounts.update(company(cid), id, body);
  }

  @Delete(':id')
  @RequirePermissions('account:manage')
  remove(@Headers('x-company-id') cid: string, @Param('id') id: string) {
    return this.accounts.remove(company(cid), id);
  }
}
