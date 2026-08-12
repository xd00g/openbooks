import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AccountResolverService } from '../accounts/account-resolver.service';
import {
  buildPaymentPaidPosting,
  buildPaymentReceivedPosting,
} from './posting.builders';

@Injectable()
export class PaymentPostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly accounts: AccountResolverService,
  ) {}

  /**
   * Post a payment to the GL. Direction decides the mapping:
   *   received -> Dr Bank/Undeposited / Cr Accounts Receivable
   *   paid     -> Dr Accounts Payable / Cr Bank
   */
  async post(companyId: string, paymentId: string, createdById?: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
      });
      if (!payment) throw new NotFoundException('Payment not found.');
      if (payment.journalEntryId) {
        throw new ConflictException('Payment is already posted.');
      }

      const amount = payment.amount.toString();
      let lines;

      if (payment.direction === 'received') {
        if (!payment.customerId) {
          throw new ConflictException('Received payment needs a customer.');
        }
        const ar = await this.accounts.bySubtype(
          tx,
          companyId,
          'accounts_receivable',
        );
        // Deposit to the specified account, else Undeposited Funds.
        const deposit = payment.depositAccountId
          ? await this.accounts.byId(tx, companyId, payment.depositAccountId)
          : await this.accounts.bySubtype(tx, companyId, 'undeposited_funds');

        lines = buildPaymentReceivedPosting({
          depositAccountId: deposit.id,
          arAccountId: ar.id,
          amount,
          customerId: payment.customerId,
        });
      } else {
        if (!payment.vendorId) {
          throw new ConflictException('Paid payment needs a vendor.');
        }
        const ap = await this.accounts.bySubtype(
          tx,
          companyId,
          'accounts_payable',
        );
        if (!payment.depositAccountId) {
          throw new ConflictException(
            'Paid payment needs a source bank account (depositAccountId).',
          );
        }
        const bank = await this.accounts.byId(
          tx,
          companyId,
          payment.depositAccountId,
        );

        lines = buildPaymentPaidPosting({
          bankAccountId: bank.id,
          apAccountId: ap.id,
          amount,
          vendorId: payment.vendorId,
        });
      }

      const entryId = await this.ledger.createPostedEntry(tx, {
        companyId,
        entryDate: payment.paymentDate,
        sourceType: 'payment',
        sourceId: payment.id,
        currency: payment.currency,
        memo: `Payment ${payment.direction}`,
        createdById,
        lines,
      });

      await tx.payment.update({
        where: { id: payment.id },
        data: { journalEntryId: entryId },
      });

      return { entryId };
    });
  }
}
