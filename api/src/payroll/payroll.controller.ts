import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { PayrollService } from './payroll.service';
import { PayrollLineInput } from './payroll.logic';
import { RequirePermissions } from '../auth/decorators';

function company(id?: string): string {
  if (!id) throw new BadRequestException('Missing X-Company-Id header.');
  return id;
}

@ApiTags('payroll')
@ApiHeader({ name: 'X-Company-Id', required: true })
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Post('employees')
  @RequirePermissions('payroll:manage')
  createEmployee(
    @Headers('x-company-id') cid: string,
    @Body()
    body: {
      firstName: string;
      lastName: string;
      email?: string;
      payType?: string;
      payRate?: string;
      filingStatus?: string;
      hireDate?: string;
    },
  ) {
    return this.payroll.createEmployee(company(cid), body);
  }

  @Get('employees')
  listEmployees(@Headers('x-company-id') cid: string) {
    return this.payroll.listEmployees(company(cid));
  }

  @Patch('employees/:id')
  @RequirePermissions('payroll:manage')
  updateEmployee(
    @Headers('x-company-id') cid: string,
    @Param('id') id: string,
    @Body() body: Record<string, string>,
  ) {
    return this.payroll.updateEmployee(company(cid), id, body);
  }

  @Post('runs')
  @RequirePermissions('payroll:manage')
  createRun(
    @Headers('x-company-id') cid: string,
    @Body()
    body: {
      payDate: string;
      periodStart: string;
      periodEnd: string;
      lines: PayrollLineInput[];
    },
  ) {
    return this.payroll.createRun(company(cid), body);
  }

  @Patch('runs/:id')
  @RequirePermissions('payroll:manage')
  updateRun(
    @Headers('x-company-id') cid: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.payroll.updateRun(company(cid), id, body as never);
  }

  @Get('runs')
  listRuns(@Headers('x-company-id') cid: string) {
    return this.payroll.listRuns(company(cid));
  }

  @Get('runs/:id')
  getRun(@Headers('x-company-id') cid: string, @Param('id') id: string) {
    return this.payroll.getRun(company(cid), id);
  }

  @Post('runs/:id/finalize')
  @RequirePermissions('payroll:run')
  finalize(@Headers('x-company-id') cid: string, @Param('id') id: string) {
    return this.payroll.finalizeRun(company(cid), id);
  }
}
