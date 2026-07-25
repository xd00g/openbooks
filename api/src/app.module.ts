import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { TenantMiddleware } from './common/tenant/tenant.middleware';
import { LedgerModule } from './ledger/ledger.module';
import { AccountsModule } from './accounts/accounts.module';
import { PostingModule } from './posting/posting.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    LedgerModule,
    AccountsModule,
    PostingModule,
    // Feature modules land here as they are built:
    //   AuthModule, CompaniesModule, SalesModule, ExpensesModule,
    //   BankingModule, PayrollModule, ReportsModule, AttachmentsModule
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Resolve the active company per request and set the RLS GUC.
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
