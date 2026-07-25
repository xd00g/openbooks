import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { AccountsModule } from '../accounts/accounts.module';
import { InvoicePostingService } from './invoice-posting.service';
import { PaymentPostingService } from './payment-posting.service';
import { PayrollPostingService } from './payroll-posting.service';

@Module({
  imports: [LedgerModule, AccountsModule],
  providers: [
    InvoicePostingService,
    PaymentPostingService,
    PayrollPostingService,
  ],
  exports: [
    InvoicePostingService,
    PaymentPostingService,
    PayrollPostingService,
  ],
})
export class PostingModule {}
