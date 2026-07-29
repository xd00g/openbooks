import { Module } from '@nestjs/common';
import { PostingModule } from '../posting/posting.module';
import { LedgerModule } from '../ledger/ledger.module';
import { EncryptionModule } from '../common/crypto/encryption.module';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';

@Module({
  imports: [PostingModule, LedgerModule, EncryptionModule],
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
