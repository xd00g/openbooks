/**
 * Bank-feed provider abstraction (docs/DESIGN.md §9). The rest of the app only
 * knows this interface, so SimpleFIN, Plaid, file-import, etc. are drop-in.
 * Amounts are SIGNED strings: + inflow to the account, - outflow.
 */
export interface NormalizedTxn {
  externalId: string; // stable id for idempotent import
  postedDate: string; // YYYY-MM-DD
  amount: string; // signed
  description: string;
  raw?: unknown;
}

export interface BankFeedProvider {
  readonly name: string;
  /** Pull transactions for a linked account since an optional cursor/date. */
  fetchTransactions(args: {
    accessToken?: string;
    externalAccountId?: string;
    since?: string;
  }): Promise<NormalizedTxn[]>;
}
