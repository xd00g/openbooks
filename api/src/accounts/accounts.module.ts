import { Module } from '@nestjs/common';
import { AccountResolverService } from './account-resolver.service';
import { CoaSeederService } from './coa-seeder.service';

@Module({
  providers: [AccountResolverService, CoaSeederService],
  exports: [AccountResolverService, CoaSeederService],
})
export class AccountsModule {}
