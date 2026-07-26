import { Module } from '@nestjs/common';
import { AccountResolverService } from './account-resolver.service';
import { CoaSeederService } from './coa-seeder.service';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';

@Module({
  controllers: [AccountsController],
  providers: [AccountResolverService, CoaSeederService, AccountsService],
  exports: [AccountResolverService, CoaSeederService, AccountsService],
})
export class AccountsModule {}
