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
  createCustomer(
    @Headers('x-company-id') cid: string,
    @Body() body: CustomerInput,
  ) {
    return this.sales.createCustomer(company(cid), body);
  }

  @Patch('customers/:id')
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
  createInvoice(
    @Headers('x-company-id') cid: string,
    @Body()
    body: {
      customerId: string;
      issueDate: string;
      dueDate?: string;
      currency?: string;
      memo?: string;
      lines: DocLineInput[];
    },
  ) {
    return this.sales.createInvoice(company(cid), body);
  }

  @Post('invoices/:id/finalize')
  finalize(@Headers('x-company-id') cid: string, @Param('id') id: string) {
    return this.sales.finalizeInvoice(company(cid), id);
  }

  @Post('invoices/:id/void')
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
  send(
    @Headers('x-company-id') cid: string,
    @Param('id') id: string,
    @Body() body: { to?: string },
  ) {
    return this.sales.sendInvoice(company(cid), id, body?.to);
  }

  @Delete('invoices/:id')
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
