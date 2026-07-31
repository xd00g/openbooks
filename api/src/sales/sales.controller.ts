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
  StreamableFile,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { SalesService, CustomerInput } from './sales.service';
import { DocLineInput } from '../documents/document.logic';
import { RequirePermissions } from '../auth/decorators';

function company(id?: string): string {
  if (!id) throw new BadRequestException('Missing X-Company-Id header.');
  return id;
}

@ApiTags('sales')
@ApiHeader({ name: 'X-Company-Id', required: true })
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Post('customers')
  @RequirePermissions('sales:manage')
  createCustomer(
    @Headers('x-company-id') cid: string,
    @Body() body: CustomerInput,
  ) {
    return this.sales.createCustomer(company(cid), body);
  }

  @Patch('customers/:id')
  @RequirePermissions('sales:manage')
  updateCustomer(
    @Headers('x-company-id') cid: string,
    @Param('id') id: string,
    @Body() body: Partial<CustomerInput>,
  ) {
    return this.sales.updateCustomer(company(cid), id, body);
  }

  @Get('customers')
  listCustomers(@Headers('x-company-id') cid: string) {
    return this.sales.listCustomers(company(cid));
  }

  @Post('invoices')
  @RequirePermissions('sales:manage')
  createInvoice(
    @Headers('x-company-id') cid: string,
    @Body()
    body: {
      customerId: string;
      issueDate: string;
      dueDate?: string;
      paymentTermId?: string;
      currency?: string;
      memo?: string;
      lines: DocLineInput[];
    },
  ) {
    return this.sales.createInvoice(company(cid), body);
  }

  @Patch('invoices/:id')
  @RequirePermissions('sales:manage')
  updateInvoice(
    @Headers('x-company-id') cid: string,
    @Param('id') id: string,
    @Body()
    body: {
      customerId: string;
      issueDate: string;
      dueDate?: string;
      paymentTermId?: string;
      currency?: string;
      memo?: string;
      lines: DocLineInput[];
    },
  ) {
    return this.sales.updateInvoice(company(cid), id, body);
  }

  @Post('invoices/:id/revert')
  @RequirePermissions('sales:manage')
  revertInvoice(@Headers('x-company-id') cid: string, @Param('id') id: string) {
    return this.sales.revertInvoice(company(cid), id);
  }

  @Post('invoices/:id/finalize')
  @RequirePermissions('sales:manage')
  finalize(@Headers('x-company-id') cid: string, @Param('id') id: string) {
    return this.sales.finalizeInvoice(company(cid), id);
  }

  @Post('invoices/:id/void')
  @RequirePermissions('sales:manage')
  voidInvoice(@Headers('x-company-id') cid: string, @Param('id') id: string) {
    return this.sales.voidInvoice(company(cid), id);
  }

  @Get('invoices/:id/pdf')
  async pdf(@Headers('x-company-id') cid: string, @Param('id') id: string): Promise<StreamableFile> {
    const { buffer, number } = await this.sales.invoicePdf(company(cid), id);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="${number}.pdf"`,
    });
  }

  @Post('invoices/:id/send')
  @RequirePermissions('sales:manage')
  send(
    @Headers('x-company-id') cid: string,
    @Param('id') id: string,
    @Body() body: { to?: string; cc?: string },
  ) {
    return this.sales.sendInvoice(company(cid), id, body?.to, body?.cc);
  }

  @Delete('invoices/:id')
  @RequirePermissions('sales:manage')
  deleteInvoice(@Headers('x-company-id') cid: string, @Param('id') id: string) {
    return this.sales.deleteInvoice(company(cid), id);
  }

  @Get('invoices/:id')
  getInvoice(@Headers('x-company-id') cid: string, @Param('id') id: string) {
    return this.sales.getInvoice(company(cid), id);
  }

  @Get('invoices')
  listInvoices(@Headers('x-company-id') cid: string) {
    return this.sales.listInvoices(company(cid));
  }

  @Post('payments')
  @RequirePermissions('sales:manage')
  recordPayment(
    @Headers('x-company-id') cid: string,
    @Body()
    body: {
      customerId: string;
      paymentDate: string;
      method?: string;
      reference?: string;
      depositAccountId?: string;
      allocations: { invoiceId: string; amount: string }[];
    },
  ) {
    return this.sales.recordPayment(company(cid), body);
  }
}
