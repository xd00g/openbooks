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
import { CurrentUser, RequirePermissions } from '../auth/decorators';

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
  @RequirePermissions('banking:manage')
  print(
    @Headers('x-company-id') cid: string,
    @Body() body: { bankAccountId: string; startNumber: number; checkIds: string[] },
  ) {
    if (!Array.isArray(body?.checkIds) || body.checkIds.length === 0) {
      throw new BadRequestException('checkIds must be a non-empty array.');
    }
    if (!Number.isInteger(body?.startNumber) || body.startNumber <= 0) {
      throw new BadRequestException('startNumber must be a positive integer.');
    }
    return this.checks.startPrintBatch(company(cid), body);
  }

  @Get('print/:batchId/pdf')
  @RequirePermissions('banking:manage')
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
  @RequirePermissions('banking:manage')
  confirm(
    @Headers('x-company-id') cid: string,
    @Param('batchId') batchId: string,
    @Body() body: { ok: boolean; reprintFromNumber?: number },
  ) {
    return this.checks.confirmBatch(company(cid), batchId, body);
  }

  @Post(':id/void')
  @RequirePermissions('banking:manage')
  void(
    @Headers('x-company-id') cid: string,
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: { id: string },
  ) {
    return this.checks.voidCheck(company(cid), id, body?.reason ?? '', user?.id);
  }

  @Get('alignment-test')
  @RequirePermissions('banking:manage')
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
  @RequirePermissions('banking:manage')
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
