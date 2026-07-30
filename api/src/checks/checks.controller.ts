import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ChecksService } from './checks.service';
import { CurrentUser } from '../auth/decorators';

function company(cid: string): string {
  if (!cid) throw new BadRequestException('Missing X-Company-Id header.');
  return cid;
}

@Controller('checks')
export class ChecksController {
  constructor(private readonly checks: ChecksService) {}

  @Get('queue')
  queue(
    @Headers('x-company-id') cid: string,
    @Query('bankAccountId') bankAccountId: string,
  ) {
    if (!bankAccountId) throw new BadRequestException('bankAccountId is required.');
    return this.checks.listQueue(company(cid), bankAccountId);
  }

  @Get('history')
  history(
    @Headers('x-company-id') cid: string,
    @Query('bankAccountId') bankAccountId: string,
  ) {
    if (!bankAccountId) throw new BadRequestException('bankAccountId is required.');
    return this.checks.listHistory(company(cid), bankAccountId);
  }

  @Post('print')
  print(
    @Headers('x-company-id') cid: string,
    @Body() body: { bankAccountId: string; startNumber: number; checkIds: string[] },
  ) {
    return this.checks.startPrintBatch(company(cid), body);
  }

  @Get('print/:batchId/pdf')
  async batchPdf(
    @Headers('x-company-id') cid: string,
    @Param('batchId') batchId: string,
  ): Promise<StreamableFile> {
    const buffer = await this.checks.batchPdf(company(cid), batchId);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="checks-${batchId.slice(0, 8)}.pdf"`,
    });
  }

  @Post('print/:batchId/confirm')
  confirm(
    @Headers('x-company-id') cid: string,
    @Param('batchId') batchId: string,
    @Body() body: { ok: boolean; reprintFromNumber?: number },
  ) {
    return this.checks.confirmBatch(company(cid), batchId, body);
  }

  @Post(':id/void')
  void(
    @Headers('x-company-id') cid: string,
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: { id: string },
  ) {
    return this.checks.voidCheck(company(cid), id, body?.reason ?? '', user?.id);
  }

  @Get('alignment-test')
  async alignment(
    @Headers('x-company-id') cid: string,
    @Query('bankAccountId') bankAccountId: string,
  ): Promise<StreamableFile> {
    if (!bankAccountId) throw new BadRequestException('bankAccountId is required.');
    const buffer = await this.checks.alignmentPdf(company(cid), bankAccountId);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: 'inline; filename="alignment-test.pdf"',
    });
  }

  @Post('offsets')
  offsets(
    @Headers('x-company-id') cid: string,
    @Body() body: { bankAccountId: string; printOffsetX: number; printOffsetY: number },
  ) {
    return this.checks.setOffsets(company(cid), body.bankAccountId, {
      printOffsetX: body.printOffsetX,
      printOffsetY: body.printOffsetY,
    });
  }
}
