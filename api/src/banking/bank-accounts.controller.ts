import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { BankAccountsService } from './bank-accounts.service';
import { RequirePermissions } from '../auth/decorators';

function company(id?: string): string {
  if (!id) throw new BadRequestException('Missing X-Company-Id header.');
  return id;
}

@ApiTags('banking')
@ApiHeader({ name: 'X-Company-Id', required: true })
@Controller('banking/accounts')
export class BankAccountsController {
  constructor(private readonly svc: BankAccountsService) {}

  @Get()
  list(@Headers('x-company-id') cid: string) {
    return this.svc.list(company(cid));
  }

  @Post()
  @RequirePermissions('banking:manage')
  create(
    @Headers('x-company-id') cid: string,
    @Body()
    body: { accountId: string; provider?: string; institution?: string; mask?: string },
  ) {
    return this.svc.create(company(cid), body);
  }

  @Get(':id/transactions')
  transactions(
    @Headers('x-company-id') cid: string,
    @Param('id') id: string,
    @Query('status') status?: string,
  ) {
    return this.svc.transactions(company(cid), id, status);
  }
}
