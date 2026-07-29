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
import { BankFeedService } from './bankfeed/bankfeed.service';
import { RequirePermissions } from '../auth/decorators';

function company(id?: string): string {
  if (!id) throw new BadRequestException('Missing X-Company-Id header.');
  return id;
}

@ApiTags('banking')
@ApiHeader({ name: 'X-Company-Id', required: true })
@Controller('banking/accounts')
export class BankAccountsController {
  constructor(
    private readonly svc: BankAccountsService,
    private readonly feed: BankFeedService,
  ) {}

  @Get()
  list(@Headers('x-company-id') cid: string) {
    return this.svc.list(company(cid));
  }

  /** SimpleFIN step 1: claim a setup token and list its accounts. */
  @Post('simplefin/claim')
  @RequirePermissions('banking:manage')
  claimSimpleFin(
    @Headers('x-company-id') cid: string,
    @Body() body: { setupToken: string },
  ) {
    return this.feed.claimSimpleFin(company(cid), body?.setupToken);
  }

  /** SimpleFIN step 2: link one discovered account to a GL account. */
  @Post('simplefin/link')
  @RequirePermissions('banking:manage')
  linkSimpleFin(
    @Headers('x-company-id') cid: string,
    @Body()
    body: {
      externalAccountId: string;
      accountId: string;
      institution?: string;
      mask?: string;
    },
  ) {
    return this.feed.linkSimpleFin(company(cid), body);
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
