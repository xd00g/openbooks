import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { AccountsModule } from '../accounts/accounts.module';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';

@Module({
  imports: [LedgerModule, AccountsModule],
  controllers: [ExpensesController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
