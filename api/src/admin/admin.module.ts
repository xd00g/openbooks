import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { AdminService } from './admin.service';
import { AdminOrgService } from './admin-org.service';
import { AdminController } from './admin.controller';

@Module({
  // AttachmentsModule for its S3 client: purging a company must also remove
  // its stored objects, or the bytes outlive the records pointing at them.
  imports: [AuthModule, AttachmentsModule],
  controllers: [AdminController],
  providers: [AdminService, AdminOrgService],
  exports: [AdminService],
})
export class AdminModule {}
