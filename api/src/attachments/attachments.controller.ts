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
import { AttachmentsService } from './attachments.service';
import { RequirePermissions } from '../auth/decorators';

function company(id?: string): string {
  if (!id) throw new BadRequestException('Missing X-Company-Id header.');
  return id;
}

@ApiTags('attachments')
@ApiHeader({ name: 'X-Company-Id', required: true })
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post('upload-url')
  @RequirePermissions('expenses:manage')
  createUpload(
    @Headers('x-company-id') cid: string,
    @Body()
    body: {
      entityType: string;
      entityId: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
    },
  ) {
    return this.attachments.createUpload(company(cid), body);
  }

  @Post(':id/confirm')
  @RequirePermissions('expenses:manage')
  confirm(
    @Headers('x-company-id') cid: string,
    @Param('id') id: string,
    @Body() body: { checksum?: string },
  ) {
    return this.attachments.confirm(company(cid), id, body?.checksum);
  }

  @Get()
  @RequirePermissions('attachments:view')
  list(
    @Headers('x-company-id') cid: string,
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
  ) {
    return this.attachments.list(company(cid), entityType, entityId);
  }

  @Get(':id/download-url')
  @RequirePermissions('attachments:view')
  download(@Headers('x-company-id') cid: string, @Param('id') id: string) {
    return this.attachments.downloadUrl(company(cid), id);
  }
}
