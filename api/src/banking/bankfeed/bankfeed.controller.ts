import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { BankFeedService } from './bankfeed.service';
import { CsvMapping } from './bankfeed.logic';

function company(id?: string): string {
  if (!id) throw new BadRequestException('Missing X-Company-Id header.');
  return id;
}

@ApiTags('banking')
@ApiHeader({ name: 'X-Company-Id', required: true })
@Controller('banking/accounts/:bankAccountId')
export class BankFeedController {
  constructor(private readonly feed: BankFeedService) {}

  @Post('import')
  import(
    @Headers('x-company-id') cid: string,
    @Param('bankAccountId') bankAccountId: string,
    @Body()
    body: { format?: 'csv' | 'ofx'; content: string; mapping?: CsvMapping },
  ) {
    if (!body?.content) throw new BadRequestException('content is required.');
    const c = company(cid);
    return body.format === 'ofx'
      ? this.feed.importOfx(c, bankAccountId, body.content)
      : this.feed.importCsv(c, bankAccountId, body.content, body.mapping);
  }

  @Post('sync')
  sync(
    @Headers('x-company-id') cid: string,
    @Param('bankAccountId') bankAccountId: string,
    @Body() body: { since?: string },
  ) {
    return this.feed.syncSimpleFin(company(cid), bankAccountId, body?.since);
  }
}
