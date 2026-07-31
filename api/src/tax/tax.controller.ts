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
import { TaxService, TaxRateInput } from './tax.service';
import { RequirePermissions } from '../auth/decorators';

function company(id?: string): string {
  if (!id) throw new BadRequestException('Missing X-Company-Id header.');
  return id;
}

@ApiTags('tax')
@ApiHeader({ name: 'X-Company-Id', required: true })
@Controller('tax')
export class TaxController {
  constructor(private readonly svc: TaxService) {}

  @Get('rates')
  listRates(@Headers('x-company-id') cid: string) {
    return this.svc.listRates(company(cid));
  }

  @Get('agencies')
  listAgencies(@Headers('x-company-id') cid: string) {
    return this.svc.listAgencies(company(cid));
  }

  @Post('rates')
  @RequirePermissions('settings:manage')
  createRate(@Headers('x-company-id') cid: string, @Body() body: TaxRateInput) {
    return this.svc.createRate(company(cid), body);
  }

  @Patch('rates/:id')
  @RequirePermissions('settings:manage')
  updateRate(
    @Headers('x-company-id') cid: string,
    @Param('id') id: string,
    @Body() body: Partial<TaxRateInput>,
  ) {
    return this.svc.updateRate(company(cid), id, body);
  }
}
