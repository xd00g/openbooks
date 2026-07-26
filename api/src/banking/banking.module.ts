import { Module } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { BankFeedService } from './bankfeed/bankfeed.service';
import { BankFeedController } from './bankfeed/bankfeed.controller';

@Module({
  controllers: [ReconciliationController, BankFeedController],
  providers: [ReconciliationService, BankFeedService],
  exports: [ReconciliationService, BankFeedService],
})
export class BankingModule {}
