import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { AccountsModule } from '../accounts/accounts.module';
import { PeriodCloseService } from './period-close.service';
import { PeriodCloseController } from './period-close.controller';

@Module({
  imports: [LedgerModule, AccountsModule],
  controllers: [PeriodCloseController],
  providers: [PeriodCloseService],
  exports: [PeriodCloseService],
})
export class PeriodModule {}
