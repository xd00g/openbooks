import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { TenantMiddleware } from './common/tenant/tenant.middleware';
import { LedgerModule } from './ledger/ledger.module';
import { AccountsModule } from './accounts/accounts.module';
import { PostingModule } from './posting/posting.module';
import { ReportingModule } from './reporting/reporting.module';
import { BankingModule } from './banking/banking.module';
import { PeriodModule } from './period/period.module';
import { SalesModule } from './sales/sales.module';
import { ExpensesModule } from './expenses/expenses.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule, // installs global auth + RBAC guards
    LedgerModule,
    AccountsModule,
    PostingModule,
    ReportingModule,
    BankingModule,
    PeriodModule,
    SalesModule,
    ExpensesModule,
    AttachmentsModule,
    // Feature modules land here as they are built:
    //   CompaniesModule, PayrollModule
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Resolve the active company per request and set the RLS GUC.
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
