import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminService } from './admin.service';
import { AdminOrgService } from './admin-org.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminService, AdminOrgService],
  exports: [AdminService],
})
export class AdminModule {}
