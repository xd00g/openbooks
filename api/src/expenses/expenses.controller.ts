import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { ExpensesService, VendorInput } from './expenses.service';
import { DocLineInput } from '../documents/document.logic';

function company(id?: string): string {
  if (!id) throw new BadRequestException('Missing X-Company-Id header.');
  return id;
}

@ApiTags('expenses')
@ApiHeader({ name: 'X-Company-Id', required: true })
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Post('vendors')
  createVendor(
    @Headers('x-company-id') cid: string,
    @Body() body: VendorInput,
  ) {
    return this.expenses.createVendor(company(cid), body);
  }

  @Patch('vendors/:id')
  updateVendor(
    @Headers('x-company-id') cid: string,
    @Param('id') id: string,
    @Body() body: Partial<VendorInput>,
  ) {
    return this.expenses.updateVendor(company(cid), id, body);
  }

  @Get('vendors')
  listVendors(@Headers('x-company-id') cid: string) {
    return this.expenses.listVendors(company(cid));
  }

  @Get('vendors/:id/statement')
  vendorStatement(@Headers('x-company-id') cid: string, @Param('id') id: string) {
    return this.expenses.vendorStatement(company(cid), id);
  }

  @Post('bills')
  createBill(
    @Headers('x-company-id') cid: string,
    @Body()
    body: {
      vendorId: string;
      number?: string;
      issueDate: string;
      dueDate?: string;
      currency?: string;
      memo?: string;
      lines: DocLineInput[];
    },
  ) {
    return this.expenses.createBill(company(cid), body);
  }

  @Patch('bills/:id')
  updateBill(
    @Headers('x-company-id') cid: string,
    @Param('id') id: string,
    @Body()
    body: {
      vendorId: string;
      number?: string;
      issueDate: string;
      dueDate?: string;
      currency?: string;
      memo?: string;
      lines: DocLineInput[];
    },
  ) {
    return this.expenses.updateBill(company(cid), id, body);
  }

  @Post('bills/:id/revert')
  revertBill(@Headers('x-company-id') cid: string, @Param('id') id: string) {
    return this.expenses.revertBill(company(cid), id);
  }

  @Post('bills/:id/finalize')
  finalize(@Headers('x-company-id') cid: string, @Param('id') id: string) {
    return this.expenses.finalizeBill(company(cid), id);
  }

  @Post('bills/:id/void')
  voidBill(@Headers('x-company-id') cid: string, @Param('id') id: string) {
    return this.expenses.voidBill(company(cid), id);
  }

  @Delete('bills/:id')
  deleteBill(@Headers('x-company-id') cid: string, @Param('id') id: string) {
    return this.expenses.deleteBill(company(cid), id);
  }

  @Get('bills')
  listBills(@Headers('x-company-id') cid: string) {
    return this.expenses.listBills(company(cid));
  }

  @Get('bills/:id')
  getBill(@Headers('x-company-id') cid: string, @Param('id') id: string) {
    return this.expenses.getBill(company(cid), id);
  }

  @Post('payments')
  payBills(
    @Headers('x-company-id') cid: string,
    @Body()
    body: {
      vendorId: string;
      paymentDate: string;
      bankAccountId: string;
      method?: string;
      reference?: string;
      printLater?: boolean;
      allocations: { billId: string; amount: string }[];
    },
  ) {
    return this.expenses.payBills(company(cid), body);
  }
}
