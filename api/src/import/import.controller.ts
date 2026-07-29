import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { ImportService } from './import.service';
import { RequirePermissions } from '../auth/decorators';

function company(id?: string): string {
  if (!id) throw new BadRequestException('Missing X-Company-Id header.');
  return id;
}

@ApiTags('import')
@ApiHeader({ name: 'X-Company-Id', required: true })
@Controller('import/iif')
export class ImportController {
  constructor(private readonly svc: ImportService) {}

  /** Parse an uploaded IIF and return what WOULD be imported (no writes). */
  @Post('preview')
  @RequirePermissions('account:manage')
  preview(@Body() body: { content: string }) {
    if (!body?.content?.trim()) throw new BadRequestException('content is required.');
    return this.svc.previewIif(body.content);
  }

  /** Commit the selected entity types from the IIF into the active company. */
  @Post('commit')
  @RequirePermissions('account:manage')
  commit(
    @Headers('x-company-id') cid: string,
    @Body()
    body: {
      content: string;
      accounts?: boolean;
      customers?: boolean;
      vendors?: boolean;
    },
  ) {
    if (!body?.content?.trim()) throw new BadRequestException('content is required.');
    return this.svc.commitIif(company(cid), body.content, {
      accounts: body.accounts,
      customers: body.customers,
      vendors: body.vendors,
    });
  }
}
