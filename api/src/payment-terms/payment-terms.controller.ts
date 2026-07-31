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
import { PaymentTermsService, PaymentTermInput } from './payment-terms.service';
import { RequirePermissions } from '../auth/decorators';

function company(id?: string): string {
  if (!id) throw new BadRequestException('Missing X-Company-Id header.');
  return id;
}

@ApiTags('payment-terms')
@ApiHeader({ name: 'X-Company-Id', required: true })
@Controller('payment-terms')
export class PaymentTermsController {
  constructor(private readonly svc: PaymentTermsService) {}

  @Get()
  list(@Headers('x-company-id') cid: string) {
    return this.svc.list(company(cid));
  }

  @Post()
  @RequirePermissions('settings:manage')
  create(@Headers('x-company-id') cid: string, @Body() body: PaymentTermInput) {
    return this.svc.create(company(cid), body);
  }

  @Patch(':id')
  @RequirePermissions('settings:manage')
  update(
    @Headers('x-company-id') cid: string,
    @Param('id') id: string,
    @Body() body: Partial<PaymentTermInput>,
  ) {
    return this.svc.update(company(cid), id, body);
  }
}
