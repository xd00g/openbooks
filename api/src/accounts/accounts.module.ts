import { Module } from '@nestjs/common';
import { AccountResolverService } from './account-resolver.service';

@Module({
  providers: [AccountResolverService],
  exports: [AccountResolverService],
})
export class AccountsModule {}
