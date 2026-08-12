import { Module } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { BankFeedService } from './bankfeed/bankfeed.service';
import { BankFeedController } from './bankfeed/bankfeed.controller';
import { BankAccountsService } from './bank-accounts.service';
import { BankAccountsController } from './bank-accounts.controller';

@Module({
  controllers: [
    BankAccountsController,
    ReconciliationController,
    BankFeedController,
  ],
  providers: [ReconciliationService, BankFeedService, BankAccountsService],
  exports: [ReconciliationService, BankFeedService, BankAccountsService],
})
export class BankingModule {}
