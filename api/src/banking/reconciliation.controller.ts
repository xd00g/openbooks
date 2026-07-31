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
import { ReconciliationService } from './reconciliation.service';
import { RequirePermissions } from '../auth/decorators';

function requireCompany(companyId?: string): string {
  if (!companyId) throw new BadRequestException('Missing X-Company-Id header.');
  return companyId;
}

@ApiTags('banking')
@ApiHeader({ name: 'X-Company-Id', required: true })
@Controller('banking/reconciliations')
export class ReconciliationController {
  constructor(private readonly svc: ReconciliationService) {}

  @Post()
  @RequirePermissions('banking:reconcile')
  start(
    @Headers('x-company-id') companyId: string,
    @Body()
    body: {
      bankAccountId: string;
      statementDate: string;
      beginningBalance: string;
      endingBalance: string;
    },
  ) {
    return this.svc.start(requireCompany(companyId), body.bankAccountId, body);
  }

  @Get()
  @RequirePermissions('banking:reconcile')
  list(
    @Headers('x-company-id') companyId: string,
    @Query('bankAccountId') bankAccountId?: string,
  ) {
    return this.svc.list(requireCompany(companyId), bankAccountId);
  }

  @Get('suggestions')
  @RequirePermissions('banking:reconcile')
  suggestions(
    @Headers('x-company-id') companyId: string,
    @Query('bankAccountId') bankAccountId: string,
    @Query('dateToleranceDays') tol?: string,
  ) {
    return this.svc.suggestions(
      requireCompany(companyId),
      bankAccountId,
      tol ? Number(tol) : undefined,
    );
  }

  @Post(':id/cleared')
  @RequirePermissions('banking:reconcile')
  setCleared(
    @Headers('x-company-id') companyId: string,
    @Param('id') reconciliationId: string,
    @Body() body: { bankTransactionId: string; cleared: boolean },
  ) {
    return this.svc.setCleared(
      requireCompany(companyId),
      reconciliationId,
      body.bankTransactionId,
      body.cleared,
    );
  }

  @Get(':id/summary')
  @RequirePermissions('banking:reconcile')
  summary(
    @Headers('x-company-id') companyId: string,
    @Param('id') reconciliationId: string,
  ) {
    return this.svc.summary(requireCompany(companyId), reconciliationId);
  }

  @Post(':id/complete')
  @RequirePermissions('banking:reconcile')
  complete(
    @Headers('x-company-id') companyId: string,
    @Param('id') reconciliationId: string,
  ) {
    return this.svc.complete(requireCompany(companyId), reconciliationId);
  }

  @Get(':id')
  @RequirePermissions('banking:reconcile')
  get(
    @Headers('x-company-id') companyId: string,
    @Param('id') reconciliationId: string,
  ) {
    return this.svc.get(requireCompany(companyId), reconciliationId);
  }
}
