import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { ReportingService } from './reporting.service';
import { AccountingMethod } from './reporting.types';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function requireCompany(companyId?: string): string {
  if (!companyId) {
    throw new BadRequestException('Missing X-Company-Id header.');
  }
  return companyId;
}

/**
 * Read-only financial statement endpoints. Company scope comes from the
 * X-Company-Id header (validated against the user's memberships once AuthModule
 * lands — see TenantMiddleware).
 */
@ApiTags('reports')
@ApiHeader({ name: 'X-Company-Id', required: true })
@Controller('reports')
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  @Get('trial-balance')
  trialBalance(
    @Headers('x-company-id') companyId: string,
    @Query('asOf') asOf?: string,
    @Query('method') method: AccountingMethod = 'accrual',
  ) {
    return this.reporting.trialBalance(
      requireCompany(companyId),
      asOf ?? isoDate(new Date()),
      method,
    );
  }

  @Get('income-statement')
  incomeStatement(
    @Headers('x-company-id') companyId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('method') method: AccountingMethod = 'accrual',
  ) {
    const now = new Date();
    const startOfYear = `${now.getUTCFullYear()}-01-01`;
    return this.reporting.incomeStatement(
      requireCompany(companyId),
      from ?? startOfYear,
      to ?? isoDate(now),
      method,
    );
  }

  @Get('balance-sheet')
  balanceSheet(
    @Headers('x-company-id') companyId: string,
    @Query('asOf') asOf?: string,
    @Query('method') method: AccountingMethod = 'accrual',
  ) {
    return this.reporting.balanceSheet(
      requireCompany(companyId),
      asOf ?? isoDate(new Date()),
      method,
    );
  }

  @Get('ar-aging')
  arAging(
    @Headers('x-company-id') companyId: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.reporting.arAging(
      requireCompany(companyId),
      asOf ?? isoDate(new Date()),
    );
  }

  @Get('ap-aging')
  apAging(
    @Headers('x-company-id') companyId: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.reporting.apAging(
      requireCompany(companyId),
      asOf ?? isoDate(new Date()),
    );
  }
}
