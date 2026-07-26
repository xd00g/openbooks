import { BankFeedProvider, NormalizedTxn } from './provider.interface';

/**
 * SimpleFIN provider (docs/DESIGN.md §9). Two-step model:
 *   1. Claim a one-time setup token -> an access URL (with basic-auth creds).
 *      Store that access URL encrypted as the bank account's accessToken.
 *   2. GET {accessUrl}/accounts?start-date=... to fetch balances + transactions.
 *
 * Network calls use global fetch (Node 18+). Live behavior isn't exercised in
 * this repo's tests; the parsing shape below follows the SimpleFIN protocol.
 */
export class SimpleFinProvider implements BankFeedProvider {
  readonly name = 'simplefin';

  /** Exchange a base64 setup token for a durable access URL. */
  static async claimAccessUrl(setupToken: string): Promise<string> {
    const claimUrl = Buffer.from(setupToken, 'base64').toString('utf8');
    const res = await fetch(claimUrl, { method: 'POST' });
    if (!res.ok) {
      throw new Error(`SimpleFIN claim failed: ${res.status}`);
    }
    return (await res.text()).trim(); // the access URL
  }

  async fetchTransactions(args: {
    accessToken?: string; // the access URL
    externalAccountId?: string;
    since?: string;
  }): Promise<NormalizedTxn[]> {
    if (!args.accessToken) throw new Error('SimpleFIN access URL missing.');

    const url = new URL(`${args.accessToken.replace(/\/$/, '')}/accounts`);
    if (args.since) {
      const startEpoch = Math.floor(new Date(args.since).getTime() / 1000);
      url.searchParams.set('start-date', String(startEpoch));
    }

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`SimpleFIN fetch failed: ${res.status}`);
    const data = (await res.json()) as {
      accounts: {
        id: string;
        transactions: {
          id: string;
          posted: number; // epoch seconds
          amount: string; // signed
          description?: string;
          payee?: string;
        }[];
      }[];
    };

    const out: NormalizedTxn[] = [];
    for (const acct of data.accounts ?? []) {
      if (args.externalAccountId && acct.id !== args.externalAccountId) continue;
      for (const t of acct.transactions ?? []) {
        out.push({
          externalId: `sf_${t.id}`,
          postedDate: new Date(t.posted * 1000).toISOString().slice(0, 10),
          amount: t.amount,
          description: t.description ?? t.payee ?? '',
          raw: t,
        });
      }
    }
    return out;
  }
}
