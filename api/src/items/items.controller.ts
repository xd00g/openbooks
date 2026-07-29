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
import { ItemsService, ItemInput } from './items.service';

function company(id?: string): string {
  if (!id) throw new BadRequestException('Missing X-Company-Id header.');
  return id;
}

@ApiTags('items')
@ApiHeader({ name: 'X-Company-Id', required: true })
@Controller('items')
export class ItemsController {
  constructor(private readonly svc: ItemsService) {}

  @Get()
  list(@Headers('x-company-id') cid: string) {
    return this.svc.list(company(cid));
  }

  @Post()
  create(@Headers('x-company-id') cid: string, @Body() body: ItemInput) {
    return this.svc.create(company(cid), body);
  }

  @Patch(':id')
  update(
    @Headers('x-company-id') cid: string,
    @Param('id') id: string,
    @Body() body: Partial<ItemInput>,
  ) {
    return this.svc.update(company(cid), id, body);
  }
}
