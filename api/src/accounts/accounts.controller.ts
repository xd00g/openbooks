import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
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

  @Post()
  @RequirePermissions('account:manage')
  create(
    @Headers('x-company-id') cid: string,
    @Body()
    body: {
      code: string;
      name: string;
      type: string;
      subtype: string;
      parentId?: string;
    },
  ) {
    return this.accounts.create(company(cid), body);
  }
}
