import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { AccountResolverService } from './account-resolver.service';
import { CoaSeederService } from './coa-seeder.service';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';

@Module({
  imports: [LedgerModule],
  controllers: [AccountsController],
  providers: [AccountResolverService, CoaSeederService, AccountsService],
  exports: [AccountResolverService, CoaSeederService, AccountsService],
})
export class AccountsModule {}
