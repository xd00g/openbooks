import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { TaxService } from './tax.service';
import { TaxController } from './tax.controller';

@Module({
  imports: [AccountsModule],
  controllers: [TaxController],
  providers: [TaxService],
  exports: [TaxService],
})
export class TaxModule {}
