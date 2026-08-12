import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { PeriodCloseService } from './period-close.service';
import { RequirePermissions } from '../auth/decorators';

function requireCompany(companyId?: string): string {
  if (!companyId) throw new BadRequestException('Missing X-Company-Id header.');
  return companyId;
}

@ApiTags('period')
@ApiHeader({ name: 'X-Company-Id', required: true })
@Controller('period-close')
export class PeriodCloseController {
  constructor(private readonly svc: PeriodCloseService) {}

  @Post()
  @RequirePermissions('period:close')
  close(
    @Headers('x-company-id') companyId: string,
    @Body() body: { asOf: string },
  ) {
    if (!body?.asOf) throw new BadRequestException('asOf (YYYY-MM-DD) required.');
    return this.svc.close(requireCompany(companyId), body.asOf);
  }

  @Post('reopen')
  @RequirePermissions('period:close')
  reopen(
    @Headers('x-company-id') companyId: string,
    @Body() body: { closedThrough: string | null },
  ) {
    return this.svc.setClosedThrough(
      requireCompany(companyId),
      body?.closedThrough ?? null,
    );
  }
}
