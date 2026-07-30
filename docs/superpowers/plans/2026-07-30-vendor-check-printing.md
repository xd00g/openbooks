# Vendor Check Printing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pay vendor bills, queue the payments for printing, print a batch of checks to PDF on pre-printed voucher stock, and confirm or reprint after a jam without corrupting the check number sequence.

**Architecture:** A new `api/src/checks/` NestJS module following the repo's mandatory pure-logic/IO split. All number and wording rules live in `check.logic.ts` with no DB access and full unit coverage; `checks.service.ts` does RLS-scoped persistence; `check-pdf.ts` draws with pdfkit exactly as `sales/invoice-pdf.ts` does. Check-number uniqueness is enforced by a Postgres partial unique index, not by application code.

**Tech Stack:** NestJS 10, Prisma 5, PostgreSQL 16, pdfkit 0.15, Jest 29, React 18 + Vite + Tailwind.

## Global Constraints

Copied verbatim from `CLAUDE.md` and the spec. Every task's requirements implicitly include this section.

- **Money is always `Decimal(19,4)`** — use `Money` from `api/src/ledger/money.ts`. Never floats. Never JS `number` for money.
- **The ledger is immutable.** Posted journal entries are never edited or deleted. Correct by posting a reversing entry via `LedgerService.reverseEntry`.
- **RLS multi-tenancy:** every tenant table has `companyId`. All tenant reads/writes go through `PrismaService.forCompany(companyId, cb)`.
- **Prisma columns are camelCase** (no `@map`), tables snake_case (via `@@map`). Raw SQL must quote camelCase columns: `"companyId"`, `"checkNumber"`.
- **Pure logic separated from I/O** and unit-tested: `*.logic.ts` files contain no imports from `@prisma/client` or NestJS.
- **`check` is a SQL reserved word.** Always quote the table name as `"check"` in raw SQL.
- Test commands: `cd api && npm test` (unit), `npm run test:int` (integration), `npm run typecheck`.
- Spec: `docs/superpowers/specs/2026-07-30-vendor-check-printing-design.md`

**Deviation from spec, deliberate:** The spec's §5 shows `POST /checks/print` returning the PDF directly. This plan splits it into `POST /checks/print` (returns `batchId` + assigned numbers) and `GET /checks/print/:batchId/pdf` (returns the PDF). Two reasons: the existing web helper `api.blobUrl` is GET-only, and separating the state change from rendering lets a user re-fetch the same PDF without re-allocating numbers.

---

## File Structure

**Create:**
- `api/src/checks/check.logic.ts` — pure rules: amount-to-words, number allocation, void preconditions
- `api/src/checks/__tests__/check.logic.spec.ts` — unit tests for the above
- `api/src/checks/check-pdf.ts` — pdfkit voucher layout + alignment test page
- `api/src/checks/checks.service.ts` — RLS-scoped persistence and orchestration
- `api/src/checks/checks.controller.ts` — HTTP endpoints
- `api/src/checks/checks.module.ts` — Nest wiring
- `web/src/pages/Checks.tsx` — queue, confirm, history UI

**Modify:**
- `api/prisma/schema.prisma` — add `Check` model; add fields to `BankAccount`; add relation on `Payment`
- `api/prisma/sql/accounting_core_constraints.sql` — add partial unique index
- `api/src/app.module.ts` — register `ChecksModule`
- `api/src/expenses/expenses.service.ts` — `payBills` accepts `printLater`
- `api/src/expenses/expenses.controller.ts` — pass `printLater` through
- `api/test/integration/db-guarantees.int.mjs` — prove the index and RLS
- `web/src/App.tsx` — add `/checks` route under the Banking nav group

---

## Task 1: Amount-to-words

**Files:**
- Create: `api/src/checks/check.logic.ts`
- Test: `api/src/checks/__tests__/check.logic.spec.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `class CheckError extends Error`, `function amountToWords(amount: string): string`

Amount-to-words is the single most bug-prone piece of check printing. It gets its own task and exhaustive tests.

- [ ] **Step 1: Write the failing test**

Create `api/src/checks/__tests__/check.logic.spec.ts`:

```typescript
import { amountToWords, CheckError } from '../check.logic';

describe('amountToWords', () => {
  it('writes a plain dollar amount', () => {
    expect(amountToWords('1240.00')).toBe(
      'One thousand two hundred forty and 00/100',
    );
  });

  it('writes zero dollars with cents', () => {
    expect(amountToWords('0.05')).toBe('Zero and 05/100');
  });

  it('writes exact millions without stray scale words', () => {
    expect(amountToWords('1000000.00')).toBe('One million and 00/100');
  });

  it('hyphenates the twenty-to-ninety-nine range', () => {
    expect(amountToWords('42.00')).toBe('Forty-two and 00/100');
  });

  it('writes teens without tens words', () => {
    expect(amountToWords('13.00')).toBe('Thirteen and 00/100');
    expect(amountToWords('19.99')).toBe('Nineteen and 99/100');
  });

  it('writes exact hundreds', () => {
    expect(amountToWords('300.00')).toBe('Three hundred and 00/100');
  });

  it('skips empty digit groups', () => {
    expect(amountToWords('1000005.00')).toBe(
      'One million five and 00/100',
    );
  });

  it('handles the largest value Decimal(19,4) allows', () => {
    expect(amountToWords('999999999999999.99')).toBe(
      'Nine hundred ninety-nine trillion nine hundred ninety-nine billion ' +
        'nine hundred ninety-nine million nine hundred ninety-nine thousand ' +
        'nine hundred ninety-nine and 99/100',
    );
  });

  it('accepts a trailing-zero 4dp string from Prisma Decimal', () => {
    expect(amountToWords('25.5000')).toBe('Twenty-five and 50/100');
  });

  it('rejects fractional cents', () => {
    expect(() => amountToWords('10.0050')).toThrow(CheckError);
  });

  it('rejects negative amounts', () => {
    expect(() => amountToWords('-5.00')).toThrow(CheckError);
  });

  it('rejects non-numeric input', () => {
    expect(() => amountToWords('abc')).toThrow(CheckError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/checks --verbose`
Expected: FAIL — `Cannot find module '../check.logic'`

- [ ] **Step 3: Write minimal implementation**

Create `api/src/checks/check.logic.ts`:

```typescript
/**
 * Pure check-printing rules — no DB, no NestJS (CLAUDE.md logic/IO split).
 *
 * Covers the three things that must never be wrong on a printed check:
 * the legal (written) amount, the number sequence, and void preconditions.
 */

export class CheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckError';
  }
}

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy',
  'eighty', 'ninety',
];
/** Index = group position from the right. 5 groups x 3 digits = the 15
 *  integer digits Decimal(19,4) permits. */
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

/** Words for 1..999. Callers skip zero groups, so 0 never reaches here. */
function groupToWords(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} hundred`);
  if (rest > 0) {
    if (rest < 20) {
      parts.push(ONES[rest]);
    } else {
      const t = Math.floor(rest / 10);
      const o = rest % 10;
      parts.push(o > 0 ? `${TENS[t]}-${ONES[o]}` : TENS[t]);
    }
  }
  return parts.join(' ');
}

function wholeToWords(digits: string): string {
  const trimmed = digits.replace(/^0+/, '');
  if (trimmed === '') return 'zero';

  // Split into 3-digit groups from the right: "1000005" -> [5, 0, 1]
  const groups: number[] = [];
  let rest = trimmed;
  while (rest.length > 0) {
    groups.push(Number(rest.slice(-3)));
    rest = rest.slice(0, -3);
  }
  if (groups.length > SCALES.length) {
    throw new CheckError(`Amount is too large to write on a check: ${digits}`);
  }

  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue; // "one million five", not "one million zero thousand five"
    const scale = SCALES[i];
    parts.push(scale ? `${groupToWords(groups[i])} ${scale}` : groupToWords(groups[i]));
  }
  return parts.join(' ');
}

/**
 * The legal amount line: "One thousand two hundred forty and 00/100".
 *
 * Accepts the 2- or 4-decimal strings Prisma returns for Decimal(19,4).
 * Rejects negatives (a negative check is not a thing) and fractional cents
 * (unprintable — a check is a whole number of cents).
 */
export function amountToWords(amount: string): string {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(amount.trim());
  if (!match) {
    throw new CheckError(`Amount must be a non-negative decimal: "${amount}"`);
  }
  const frac = (match[2] ?? '').padEnd(4, '0');
  if (frac.slice(2) !== '00') {
    throw new CheckError(
      `Amount ${amount} has fractional cents; a check must be a whole number of cents.`,
    );
  }
  const words = `${wholeToWords(match[1])} and ${frac.slice(0, 2)}/100`;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx jest src/checks --verbose`
Expected: PASS — 12 tests

- [ ] **Step 5: Commit**

```bash
git add api/src/checks/check.logic.ts api/src/checks/__tests__/check.logic.spec.ts
git commit -m "feat(checks): amount-to-words for the legal amount line"
```

---

## Task 2: Check number allocation and void preconditions

**Files:**
- Modify: `api/src/checks/check.logic.ts`
- Test: `api/src/checks/__tests__/check.logic.spec.ts`

**Interfaces:**
- Consumes: `CheckError` from Task 1
- Produces:
  - `function allocateCheckNumbers(startNumber: number, count: number, usedNumbers: Iterable<number>): number[]`
  - `type VoidKind = 'misprint' | 'cancel'`
  - `interface VoidableCheck { status: string; checkNumber: number | null }`
  - `function assertVoidable(check: VoidableCheck, kind: VoidKind): void`

**Why allocation must be contiguous:** check stock is physical paper sitting in the printer in sequential order. You cannot skip a number the way you can skip a database id. If any number in the requested range is already used, the whole range is unprintable and the user must pick a different start.

- [ ] **Step 1: Write the failing test**

Append to `api/src/checks/__tests__/check.logic.spec.ts`:

```typescript
import {
  allocateCheckNumbers,
  assertVoidable,
  type VoidableCheck,
} from '../check.logic';

describe('allocateCheckNumbers', () => {
  it('returns a contiguous range', () => {
    expect(allocateCheckNumbers(1001, 3, [])).toEqual([1001, 1002, 1003]);
  });

  it('allocates a single check', () => {
    expect(allocateCheckNumbers(500, 1, [])).toEqual([500]);
  });

  it('allows a start that is not adjacent to previous numbers', () => {
    expect(allocateCheckNumbers(2000, 2, [1001, 1002])).toEqual([2000, 2001]);
  });

  it('refuses a range colliding with a used number', () => {
    expect(() => allocateCheckNumbers(1001, 3, [1002])).toThrow(CheckError);
  });

  it('refuses when the collision is a voided number', () => {
    // Voided numbers stay spent — the paper was printed (spec 4.4).
    expect(() => allocateCheckNumbers(1001, 1, [1001])).toThrow(CheckError);
  });

  it('names the offending number in the error', () => {
    expect(() => allocateCheckNumbers(1001, 3, [1003])).toThrow(/1003/);
  });

  it('rejects a non-positive start', () => {
    expect(() => allocateCheckNumbers(0, 1, [])).toThrow(CheckError);
  });

  it('rejects a non-integer start', () => {
    expect(() => allocateCheckNumbers(10.5, 1, [])).toThrow(CheckError);
  });

  it('rejects an empty batch', () => {
    expect(() => allocateCheckNumbers(1001, 0, [])).toThrow(CheckError);
  });
});

describe('assertVoidable', () => {
  const printed: VoidableCheck = { status: 'printed', checkNumber: 1001 };

  it('permits voiding a printed check as a misprint', () => {
    expect(() => assertVoidable(printed, 'misprint')).not.toThrow();
  });

  it('permits cancelling a printed check', () => {
    expect(() => assertVoidable(printed, 'cancel')).not.toThrow();
  });

  it('refuses to void an already-voided check', () => {
    expect(() =>
      assertVoidable({ status: 'voided', checkNumber: 1001 }, 'cancel'),
    ).toThrow(CheckError);
  });

  it('refuses to void a queued check that was never printed', () => {
    expect(() =>
      assertVoidable({ status: 'queued', checkNumber: null }, 'cancel'),
    ).toThrow(CheckError);
  });

  it('refuses a printed check with no number', () => {
    expect(() =>
      assertVoidable({ status: 'printed', checkNumber: null }, 'cancel'),
    ).toThrow(CheckError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/checks --verbose`
Expected: FAIL — `allocateCheckNumbers is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `api/src/checks/check.logic.ts`:

```typescript
/**
 * Allocate a contiguous run of check numbers.
 *
 * Contiguity is not a simplification — check stock is physical paper in
 * sequential order in the printer tray, so a gap cannot be skipped over the
 * way a database id can. If any number in the range is spent, the whole range
 * is unprintable.
 *
 * `usedNumbers` must include voided numbers: once a number is on paper it is
 * spent regardless of what happened to that paper (spec 4.4).
 */
export function allocateCheckNumbers(
  startNumber: number,
  count: number,
  usedNumbers: Iterable<number>,
): number[] {
  if (!Number.isInteger(startNumber) || startNumber < 1) {
    throw new CheckError('Starting check number must be a positive whole number.');
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new CheckError('Select at least one check to print.');
  }

  const used = new Set(usedNumbers);
  const last = startNumber + count - 1;
  const range: number[] = [];
  for (let n = startNumber; n <= last; n++) {
    if (used.has(n)) {
      throw new CheckError(
        `Check number ${n} has already been used. Check stock is sequential, ` +
          `so the range ${startNumber}-${last} cannot be printed. ` +
          `Choose a different starting number.`,
      );
    }
    range.push(n);
  }
  return range;
}

/** A misprint burns the number only; a cancel also reverses the ledger. */
export type VoidKind = 'misprint' | 'cancel';

export interface VoidableCheck {
  status: string;
  checkNumber: number | null;
}

/**
 * Preconditions shared by both kinds of void. The kinds differ in ledger
 * impact (handled in the service), not in what may be voided.
 */
export function assertVoidable(check: VoidableCheck, _kind: VoidKind): void {
  if (check.status === 'voided') {
    throw new CheckError('This check is already voided.');
  }
  if (check.status !== 'printed') {
    throw new CheckError(
      `Only printed checks can be voided (this one is "${check.status}").`,
    );
  }
  if (check.checkNumber == null) {
    throw new CheckError('A printed check must have a number.');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx jest src/checks --verbose`
Expected: PASS — 26 tests total

- [ ] **Step 5: Commit**

```bash
git add api/src/checks/check.logic.ts api/src/checks/__tests__/check.logic.spec.ts
git commit -m "feat(checks): contiguous number allocation and void preconditions"
```

---

## Task 3: Schema and the uniqueness constraint

**Files:**
- Modify: `api/prisma/schema.prisma`
- Modify: `api/prisma/sql/accounting_core_constraints.sql`

**Interfaces:**
- Consumes: nothing
- Produces: Prisma model `Check`; `BankAccount.nextCheckNumber`, `BankAccount.printOffsetX`, `BankAccount.printOffsetY`; `Payment.check` back-relation

- [ ] **Step 1: Add the Check model**

Append to `api/prisma/schema.prisma`, after the `Payment`/`PaymentApplication` block:

```prisma
/// A physical check printed against a vendor Payment. payeeName and amount are
/// SNAPSHOTS taken at print time: renaming a vendor later must not rewrite what
/// was physically printed (spec 4.3).
model Check {
  id            String    @id @default(uuid()) @db.Uuid
  companyId     String    @db.Uuid
  bankAccountId String    @db.Uuid
  paymentId     String    @unique @db.Uuid
  checkNumber   Int?      // null until a print batch assigns one
  status        String    @default("queued") // queued | printed | voided
  payeeName     String
  amount        Decimal   @db.Decimal(19, 4)
  checkDate     DateTime  @db.Date
  memo          String?
  printBatchId  String?   @db.Uuid
  printedAt     DateTime?
  voidedAt      DateTime?
  voidReason    String?   // 'misprint' | free text; distinguishes the two voids
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  company     Company     @relation(fields: [companyId], references: [id], onDelete: Cascade)
  bankAccount BankAccount @relation(fields: [bankAccountId], references: [id])
  payment     Payment     @relation(fields: [paymentId], references: [id])

  @@index([companyId, bankAccountId, status])
  @@index([companyId, printBatchId])
  @@map("check")
}
```

- [ ] **Step 2: Add the BankAccount fields and back-relations**

In `api/prisma/schema.prisma`, inside `model BankAccount`, add these three fields next to the other scalars:

```prisma
  nextCheckNumber Int?
  printOffsetX    Int     @default(0) // alignment nudge, hundredths of an inch
  printOffsetY    Int     @default(0)
```

Still inside `model BankAccount`, add to the relation block:

```prisma
  checks          Check[]
```

Inside `model Payment`, add:

```prisma
  check        Check?
```

Inside `model Company`, add to its relation list:

```prisma
  checks       Check[]
```

- [ ] **Step 3: Add the uniqueness constraint**

Append to `api/prisma/sql/accounting_core_constraints.sql`:

```sql
-- ============================================================================
-- CHECK NUMBERING
-- Uniqueness is ABSOLUTE and deliberately does NOT exclude voided rows.
-- Once a number is printed onto paper it is spent, whether that paper was
-- cashed, jammed, or shredded. Reusing it would put two physical checks with
-- the same number into circulation, which is ambiguous on a bank statement
-- and breaks reconciliation. Gaps are expected; voided rows are retained so
-- the sequence stays auditable.
-- "check" is a SQL reserved word and must stay quoted.
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS check_number_unique_per_account
  ON "check" ("companyId", "bankAccountId", "checkNumber")
  WHERE "checkNumber" IS NOT NULL;
```

- [ ] **Step 4: Apply and verify**

```bash
cd api && npx prisma validate && npx prisma generate
```

Expected: `The schema at prisma/schema.prisma is valid` and a successful client generation.

Then push the schema and constraint to the running database:

```bash
cd /home/tcc-azure/openbooks && docker compose run --rm migrate
cd api && npm run db:constraints
```

Expected: both complete without error. Confirm the index exists:

```bash
docker compose exec -T postgres psql -U openbooks -d openbooks -c "\di check_number_unique_per_account"
```

Expected: one row listing the index.

- [ ] **Step 5: Commit**

```bash
git add api/prisma/schema.prisma api/prisma/sql/accounting_core_constraints.sql
git commit -m "feat(checks): Check model and absolute per-account number uniqueness"
```

---

## Task 4: Queue a check when paying bills

**Files:**
- Modify: `api/src/expenses/expenses.service.ts` (`PayBillsInput` interface and `payBills`)
- Modify: `api/src/expenses/expenses.controller.ts` (the `@Post('payments')` body type)

**Interfaces:**
- Consumes: `Check` model from Task 3
- Produces: `payBills` accepts `printLater?: boolean`; creates a `Check` row with `status='queued'`, `checkNumber=null`

- [ ] **Step 1: Extend the input type**

In `api/src/expenses/expenses.service.ts`, find the `PayBillsInput` interface (it already has `method?: string` and `reference?: string` around line 52) and add:

```typescript
  /** Queue a printed check for this payment instead of recording it as already paid. */
  printLater?: boolean;
```

- [ ] **Step 2: Create the queued check inside the existing transaction**

In `payBills`, after the `tx.payment.create({...})` call that assigns `const payment`, and before the `for (const u of result.updates)` loop, insert:

```typescript
      // Queue a check for printing. The number is assigned later, by a print
      // batch — not here — so a jam can't burn a number (spec 5.1).
      if (input.printLater) {
        const vendor = await tx.vendor.findFirst({
          where: { id: input.vendorId },
          select: { displayName: true },
        });
        await tx.check.create({
          data: {
            companyId,
            bankAccountId: bank.id,
            paymentId: payment.id,
            status: 'queued',
            payeeName: vendor?.displayName ?? 'Vendor',
            amount: result.totalApplied,
            checkDate: new Date(input.paymentDate),
            memo: input.reference ?? null,
          },
        });
      }
```

Note `bank.id` is the GL account id resolved just above by `this.accounts.byId`. The `Check.bankAccountId` column references `BankAccount.id`, so resolve the `BankAccount` row rather than reusing the GL account id:

```typescript
        const bankAccountRow = await tx.bankAccount.findFirst({
          where: { accountId: bank.id },
          select: { id: true },
        });
        if (!bankAccountRow) {
          throw new BadRequestException(
            'This GL account is not set up as a bank account, so checks cannot be printed from it.',
          );
        }
```

Place that lookup immediately before `tx.check.create` and use `bankAccountId: bankAccountRow.id`.

- [ ] **Step 3: Pass the flag through the controller**

In `api/src/expenses/expenses.controller.ts`, in the `@Post('payments')` handler body type, add `printLater?: boolean;` alongside `method?: string;` and `reference?: string;`.

- [ ] **Step 4: Verify it compiles**

Run: `cd api && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add api/src/expenses/expenses.service.ts api/src/expenses/expenses.controller.ts
git commit -m "feat(checks): queue a check when paying bills with printLater"
```

---

## Task 5: The check PDF

**Files:**
- Create: `api/src/checks/check-pdf.ts`

**Interfaces:**
- Consumes: `amountToWords` from Task 1
- Produces:
  - `interface CheckPdfData`
  - `function buildCheckPdf(checks: CheckPdfData[]): Promise<Buffer>`
  - `function buildAlignmentTestPdf(offsetX: number, offsetY: number): Promise<Buffer>`

Follow `api/src/sales/invoice-pdf.ts` for the pdfkit idiom: `new PDFDocument`, collect `data` chunks, resolve `Buffer.concat` on `end`.

- [ ] **Step 1: Write the PDF builder**

Create `api/src/checks/check-pdf.ts`:

```typescript
import PDFDocument from 'pdfkit';
import { amountToWords } from './check.logic';

/** One check's worth of print data. Amounts are Decimal strings. */
export interface CheckPdfData {
  checkNumber: number;
  checkDate: string; // ISO yyyy-mm-dd
  payeeName: string;
  amount: string;
  memo?: string | null;
  companyName: string;
  /** Bills this check pays, listed on the stub. */
  bills: { number: string; date: string; amount: string }[];
  /** Alignment nudge in hundredths of an inch. */
  offsetX: number;
  offsetY: number;
}

const PT_PER_INCH = 72;
/** Check occupies the top 3.5" of US Letter; the stub fills the rest. */
const CHECK_HEIGHT = 3.5 * PT_PER_INCH; // 252pt
const LEFT = 50;
const GREEN = '#0b3d2e';

const fmtMoney = (v: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    Number(v),
  );

const fmtDate = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString('en-US');

export function buildCheckPdf(checks: CheckPdfData[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    checks.forEach((c, i) => {
      if (i > 0) doc.addPage();
      drawCheck(doc, c);
    });

    doc.end();
  });
}

function drawCheck(doc: PDFKit.PDFDocument, c: CheckPdfData) {
  // Offsets are hundredths of an inch -> points.
  const dx = (c.offsetX / 100) * PT_PER_INCH;
  const dy = (c.offsetY / 100) * PT_PER_INCH;
  const x = (v: number) => v + dx;
  const y = (v: number) => v + dy;

  // ---- CHECK PORTION (top 3.5") -------------------------------------------
  // Nothing is drawn in the pre-printed zones: MICR band, bank name, company
  // address, routing/account numbers are already on the stock.

  doc.font('Helvetica').fontSize(10).fillColor('#000');
  doc.text(fmtDate(c.checkDate), x(430), y(70), { width: 120 });

  doc.font('Helvetica').fontSize(11);
  doc.text(c.payeeName, x(LEFT + 40), y(112), { width: 380 });

  doc.font('Helvetica-Bold').fontSize(11);
  doc.text(fmtMoney(c.amount), x(470), y(112), { width: 90, align: 'right' });

  // Legal amount. Trailing rule fills the line so nothing can be appended.
  doc.font('Helvetica').fontSize(10);
  const words = amountToWords(c.amount);
  doc.text(words, x(LEFT), y(146), { width: 430 });
  const wordsWidth = doc.widthOfString(words);
  doc
    .moveTo(x(LEFT + wordsWidth + 6), y(157))
    .lineTo(x(500), y(157))
    .strokeColor('#666')
    .lineWidth(0.5)
    .stroke();

  if (c.memo) {
    doc.fontSize(9).fillColor('#333');
    doc.text(`Memo: ${c.memo}`, x(LEFT), y(196), { width: 250 });
  }

  // Blank signature line — no stored signature image, by design (spec 2).
  doc
    .moveTo(x(330), y(212))
    .lineTo(x(560), y(212))
    .strokeColor('#000')
    .lineWidth(0.7)
    .stroke();
  doc.fontSize(7).fillColor('#666');
  doc.text('Authorized signature', x(330), y(216), { width: 230 });

  // ---- STUB ---------------------------------------------------------------
  let sy = y(CHECK_HEIGHT + 30);

  doc.font('Helvetica-Bold').fontSize(11).fillColor(GREEN);
  doc.text(c.companyName, x(LEFT), sy, { width: 300 });

  doc.font('Helvetica').fontSize(9).fillColor('#333');
  doc.text(`Check ${c.checkNumber}`, x(430), sy, { width: 120, align: 'right' });
  doc.text(fmtDate(c.checkDate), x(430), sy + 13, { width: 120, align: 'right' });

  sy += 34;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000');
  doc.text(c.payeeName, x(LEFT), sy, { width: 300 });

  sy += 22;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#555');
  doc.text('BILL', x(LEFT), sy);
  doc.text('DATE', x(200), sy);
  doc.text('AMOUNT', x(430), sy, { width: 120, align: 'right' });

  sy += 4;
  doc.moveTo(x(LEFT), sy + 8).lineTo(x(550), sy + 8).strokeColor('#999').lineWidth(0.5).stroke();
  sy += 16;

  // One page per check — overflow is summarized, never pushed to page 2.
  const MAX_ROWS = 12;
  const shown = c.bills.slice(0, MAX_ROWS);
  doc.font('Helvetica').fontSize(9).fillColor('#000');
  for (const b of shown) {
    doc.text(b.number, x(LEFT), sy, { width: 140 });
    doc.text(fmtDate(b.date), x(200), sy, { width: 120 });
    doc.text(fmtMoney(b.amount), x(430), sy, { width: 120, align: 'right' });
    sy += 14;
  }
  if (c.bills.length > MAX_ROWS) {
    doc.fillColor('#666').fontSize(8);
    doc.text(
      `… and ${c.bills.length - MAX_ROWS} more — see payment detail`,
      x(LEFT),
      sy,
      { width: 300 },
    );
    sy += 14;
  }

  doc.moveTo(x(380), sy + 4).lineTo(x(550), sy + 4).strokeColor('#000').lineWidth(0.7).stroke();
  sy += 10;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');
  doc.text('Total', x(380), sy, { width: 90 });
  doc.text(fmtMoney(c.amount), x(430), sy, { width: 120, align: 'right' });
}

/**
 * A calibration page: a labelled 1/2" grid plus the nominal check outline, so
 * the user can measure how far their stock is off and set the offsets.
 */
export function buildAlignmentTestPdf(
  offsetX: number,
  offsetY: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const dx = (offsetX / 100) * PT_PER_INCH;
    const dy = (offsetY / 100) * PT_PER_INCH;

    doc.font('Helvetica-Bold').fontSize(12).fillColor(GREEN);
    doc.text('OpenBooks check alignment test', 50 + dx, 24 + dy);
    doc.font('Helvetica').fontSize(9).fillColor('#333');
    doc.text(
      `Current offset: X ${offsetX}/100 in, Y ${offsetY}/100 in. ` +
        'Hold this against your check stock. If the boxes are off, adjust the ' +
        'offsets by the difference and print again.',
      50 + dx,
      40 + dy,
      { width: 480 },
    );

    // Half-inch grid with inch labels.
    doc.lineWidth(0.25).strokeColor('#ccc');
    for (let ix = 0; ix <= 8.5 * PT_PER_INCH; ix += PT_PER_INCH / 2) {
      doc.moveTo(ix + dx, dy).lineTo(ix + dx, 11 * PT_PER_INCH + dy).stroke();
    }
    for (let iy = 0; iy <= 11 * PT_PER_INCH; iy += PT_PER_INCH / 2) {
      doc.moveTo(dx, iy + dy).lineTo(8.5 * PT_PER_INCH + dx, iy + dy).stroke();
    }
    doc.fontSize(6).fillColor('#999');
    for (let inch = 1; inch < 11; inch++) {
      doc.text(`${inch}"`, 4 + dx, inch * PT_PER_INCH + 2 + dy);
    }

    // Nominal positions of the fields drawn by drawCheck.
    doc.lineWidth(0.8).strokeColor(GREEN);
    doc.rect(dx, dy, 8.5 * PT_PER_INCH, CHECK_HEIGHT).stroke();
    doc.fontSize(8).fillColor(GREEN);
    doc.text('CHECK REGION — top 3.5"', 50 + dx, CHECK_HEIGHT - 16 + dy);

    const boxes: [number, number, number, number, string][] = [
      [430, 62, 120, 20, 'date'],
      [90, 106, 380, 20, 'payee'],
      [470, 106, 90, 20, 'amount'],
      [50, 140, 450, 20, 'legal amount'],
      [330, 200, 230, 16, 'signature line'],
    ];
    doc.lineWidth(0.5).strokeColor('#c0392b');
    for (const [bx, by, bw, bh, label] of boxes) {
      doc.rect(bx + dx, by + dy, bw, bh).stroke();
      doc.fontSize(6).fillColor('#c0392b');
      doc.text(label, bx + dx + 2, by + dy - 8);
    }

    doc.end();
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd api && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Smoke-test the output**

```bash
cd api && npx ts-node -e "
import('./src/checks/check-pdf').then(async (m) => {
  const buf = await m.buildCheckPdf([{
    checkNumber: 1001, checkDate: '2026-07-30', payeeName: 'Acme Supply Co',
    amount: '1240.0000', memo: 'July invoices', companyName: 'Doogster Industries',
    bills: [
      { number: 'INV-88', date: '2026-07-01', amount: '740.00' },
      { number: 'INV-91', date: '2026-07-14', amount: '500.00' },
    ],
    offsetX: 0, offsetY: 0,
  }]);
  require('fs').writeFileSync('/tmp/check-sample.pdf', buf);
  console.log('wrote', buf.length, 'bytes');
});
"
```

Expected: `wrote <N> bytes` with N > 1000. Open `/tmp/check-sample.pdf` and confirm the legal amount reads `One thousand two hundred forty and 00/100`, the stub lists both bills, and the total is `$1,240.00`.

- [ ] **Step 4: Commit**

```bash
git add api/src/checks/check-pdf.ts
git commit -m "feat(checks): voucher check PDF and alignment test page"
```

---

## Task 6: ChecksService

**Files:**
- Create: `api/src/checks/checks.service.ts`

**Interfaces:**
- Consumes: `allocateCheckNumbers`, `assertVoidable`, `CheckError` (Tasks 1-2); `buildCheckPdf`, `buildAlignmentTestPdf`, `CheckPdfData` (Task 5); `Check` model (Task 3)
- Produces: `class ChecksService` with `listQueue`, `startPrintBatch`, `batchPdf`, `confirmBatch`, `voidCheck`, `listHistory`, `alignmentPdf`

- [ ] **Step 1: Write the service**

Create `api/src/checks/checks.service.ts`:

```typescript
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import {
  CheckError,
  allocateCheckNumbers,
  assertVoidable,
  type VoidKind,
} from './check.logic';
import {
  buildAlignmentTestPdf,
  buildCheckPdf,
  type CheckPdfData,
} from './check-pdf';

/** Translate pure-logic failures into HTTP 400s with their original message. */
function asHttp(e: unknown): never {
  if (e instanceof CheckError) throw new BadRequestException(e.message);
  throw e as Error;
}

@Injectable()
export class ChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /** Checks waiting to be printed for one bank account. */
  listQueue(companyId: string, bankAccountId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.check.findMany({
        where: { bankAccountId, status: 'queued' },
        orderBy: { checkDate: 'asc' },
      }),
    );
  }

  listHistory(companyId: string, bankAccountId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.check.findMany({
        where: { bankAccountId, status: { in: ['printed', 'voided'] } },
        orderBy: { checkNumber: 'desc' },
        take: 200,
      }),
    );
  }

  /**
   * Assign a contiguous number range to the selected checks and mark them
   * printed under a new batch id. Numbers are assigned here so they can be
   * drawn on paper, but are only *committed* by confirmBatch — a misprint
   * voids them and the checks return to the queue (spec 5.1).
   */
  async startPrintBatch(
    companyId: string,
    input: { bankAccountId: string; startNumber: number; checkIds: string[] },
  ) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const checks = await tx.check.findMany({
        where: {
          id: { in: input.checkIds },
          bankAccountId: input.bankAccountId,
          status: 'queued',
        },
        orderBy: { checkDate: 'asc' },
      });
      if (checks.length !== input.checkIds.length) {
        throw new BadRequestException(
          'One or more selected checks are no longer queued for this bank account.',
        );
      }

      // Every number ever assigned on this account, voided included (spec 4.4).
      const spent = await tx.check.findMany({
        where: { bankAccountId: input.bankAccountId, checkNumber: { not: null } },
        select: { checkNumber: true },
      });

      let numbers: number[];
      try {
        numbers = allocateCheckNumbers(
          input.startNumber,
          checks.length,
          spent.map((s) => s.checkNumber as number),
        );
      } catch (e) {
        asHttp(e);
      }

      const printBatchId = randomUUID();
      const printedAt = new Date();
      for (let i = 0; i < checks.length; i++) {
        await tx.check.update({
          where: { id: checks[i].id },
          data: {
            checkNumber: numbers[i],
            status: 'printed',
            printBatchId,
            printedAt,
          },
        });
      }

      await tx.bankAccount.update({
        where: { id: input.bankAccountId },
        data: { nextCheckNumber: numbers[numbers.length - 1] + 1 },
      });

      return {
        printBatchId,
        assigned: checks.map((c, i) => ({ checkId: c.id, checkNumber: numbers[i] })),
      };
    });
  }

  /** Render a batch. Safe to call repeatedly — it mutates nothing. */
  async batchPdf(companyId: string, printBatchId: string): Promise<Buffer> {
    const data = await this.prisma.forCompany(companyId, async (tx) => {
      const checks = await tx.check.findMany({
        where: { printBatchId },
        orderBy: { checkNumber: 'asc' },
      });
      if (checks.length === 0) throw new NotFoundException('Print batch not found.');

      const company = await tx.company.findFirst({ select: { legalName: true } });
      const bank = await tx.bankAccount.findFirst({
        where: { id: checks[0].bankAccountId },
        select: { printOffsetX: true, printOffsetY: true },
      });

      const out: CheckPdfData[] = [];
      for (const c of checks) {
        const applications = await tx.paymentApplication.findMany({
          where: { paymentId: c.paymentId },
          include: { bill: { select: { number: true, issueDate: true } } },
        });
        out.push({
          checkNumber: c.checkNumber as number,
          checkDate: c.checkDate.toISOString().slice(0, 10),
          payeeName: c.payeeName,
          amount: c.amount.toString(),
          memo: c.memo,
          companyName: company?.legalName ?? 'Company',
          bills: applications.map((a) => ({
            number: a.bill?.number ?? '—',
            date: (a.bill?.issueDate ?? c.checkDate).toISOString().slice(0, 10),
            amount: a.amount.toString(),
          })),
          offsetX: bank?.printOffsetX ?? 0,
          offsetY: bank?.printOffsetY ?? 0,
        });
      }
      return out;
    });

    try {
      return await buildCheckPdf(data);
    } catch (e) {
      return asHttp(e);
    }
  }

  /**
   * Commit a batch, or report a misprint. On misprint, every check from
   * `reprintFromNumber` onward has its number burned (status voided,
   * voidReason 'misprint') and is returned to the queue with a fresh row-level
   * reset. Payments and journal entries are untouched — a misprint is a paper
   * event, not an accounting one (spec 5.2).
   */
  async confirmBatch(
    companyId: string,
    printBatchId: string,
    input: { ok: boolean; reprintFromNumber?: number },
  ) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const checks = await tx.check.findMany({
        where: { printBatchId },
        orderBy: { checkNumber: 'asc' },
      });
      if (checks.length === 0) throw new NotFoundException('Print batch not found.');

      // Idempotent: a batch with nothing still 'printed' was already handled.
      if (!checks.some((c) => c.status === 'printed')) {
        return { committed: 0, requeued: 0, alreadyHandled: true };
      }

      if (input.ok) {
        return { committed: checks.length, requeued: 0, alreadyHandled: false };
      }

      const from = input.reprintFromNumber ?? (checks[0].checkNumber as number);
      let requeued = 0;
      for (const c of checks) {
        if ((c.checkNumber as number) < from) continue;
        await tx.check.update({
          where: { id: c.id },
          data: {
            status: 'voided',
            voidReason: 'misprint',
            voidedAt: new Date(),
          },
        });
        // A fresh queued row for the same payment, so it prints again with a
        // new number. The voided row stays as the audit trail.
        await tx.check.create({
          data: {
            companyId,
            bankAccountId: c.bankAccountId,
            paymentId: c.paymentId,
            status: 'queued',
            payeeName: c.payeeName,
            amount: c.amount,
            checkDate: c.checkDate,
            memo: c.memo,
          },
        });
        requeued++;
      }
      return { committed: checks.length - requeued, requeued, alreadyHandled: false };
    });
  }

  /**
   * True void: the check was issued but never cleared. Posts a reversing
   * journal entry (the ledger is immutable) and reopens the bills.
   */
  async voidCheck(companyId: string, checkId: string, reason: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const check = await tx.check.findFirst({ where: { id: checkId } });
      if (!check) throw new NotFoundException('Check not found.');

      const kind: VoidKind = 'cancel';
      try {
        assertVoidable({ status: check.status, checkNumber: check.checkNumber }, kind);
      } catch (e) {
        if (e instanceof CheckError && /already voided/.test(e.message)) {
          throw new ConflictException(e.message);
        }
        asHttp(e);
      }

      const payment = await tx.payment.findFirst({
        where: { id: check.paymentId },
        select: { id: true, journalEntryId: true },
      });
      if (!payment) throw new NotFoundException('Payment for this check not found.');
      if (!payment.journalEntryId) {
        throw new ConflictException(
          'This payment has no posted journal entry to reverse.',
        );
      }

      await this.ledger.reverseEntry(
        tx as never,
        companyId,
        payment.journalEntryId,
        new Date(),
      );

      // Reopen the bills this payment had settled.
      const applications = await tx.paymentApplication.findMany({
        where: { paymentId: payment.id },
      });
      for (const a of applications) {
        if (!a.billId) continue;
        const bill = await tx.bill.findFirst({ where: { id: a.billId } });
        if (!bill) continue;
        const newBalance = bill.balanceDue.add(a.amount);
        const newPaid = bill.amountPaid.sub(a.amount);
        await tx.bill.update({
          where: { id: bill.id },
          data: {
            balanceDue: newBalance,
            amountPaid: newPaid,
            status: newPaid.isZero() ? 'open' : 'partially_paid',
          },
        });
      }

      return tx.check.update({
        where: { id: checkId },
        data: {
          status: 'voided',
          voidReason: reason || 'cancelled',
          voidedAt: new Date(),
        },
      });
    });
  }

  async alignmentPdf(companyId: string, bankAccountId: string): Promise<Buffer> {
    const bank = await this.prisma.forCompany(companyId, (tx) =>
      tx.bankAccount.findFirst({
        where: { id: bankAccountId },
        select: { printOffsetX: true, printOffsetY: true },
      }),
    );
    if (!bank) throw new NotFoundException('Bank account not found.');
    return buildAlignmentTestPdf(bank.printOffsetX, bank.printOffsetY);
  }

  setOffsets(
    companyId: string,
    bankAccountId: string,
    offsets: { printOffsetX: number; printOffsetY: number },
  ) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.bankAccount.update({
        where: { id: bankAccountId },
        data: {
          printOffsetX: offsets.printOffsetX,
          printOffsetY: offsets.printOffsetY,
        },
      }),
    );
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd api && npm run typecheck`
Expected: no errors. If `reverseEntry`'s `tx` parameter type complains, the `as never` cast above matches how other services pass the scoped transaction client.

- [ ] **Step 3: Commit**

```bash
git add api/src/checks/checks.service.ts
git commit -m "feat(checks): ChecksService for queue, batch, confirm, and void"
```

---

## Task 7: Controller and module wiring

**Files:**
- Create: `api/src/checks/checks.controller.ts`
- Create: `api/src/checks/checks.module.ts`
- Modify: `api/src/app.module.ts`

**Interfaces:**
- Consumes: `ChecksService` (Task 6)
- Produces: the seven endpoints listed in the plan header

- [ ] **Step 1: Write the controller**

Create `api/src/checks/checks.controller.ts`. The `company(cid)` helper and `@Headers('x-company-id')` idiom mirror `expenses.controller.ts`; copy that helper's import path from there.

```typescript
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ChecksService } from './checks.service';

function company(cid: string): string {
  if (!cid) throw new BadRequestException('Missing X-Company-Id header.');
  return cid;
}

@Controller('checks')
export class ChecksController {
  constructor(private readonly checks: ChecksService) {}

  @Get('queue')
  queue(
    @Headers('x-company-id') cid: string,
    @Query('bankAccountId') bankAccountId: string,
  ) {
    if (!bankAccountId) throw new BadRequestException('bankAccountId is required.');
    return this.checks.listQueue(company(cid), bankAccountId);
  }

  @Get('history')
  history(
    @Headers('x-company-id') cid: string,
    @Query('bankAccountId') bankAccountId: string,
  ) {
    if (!bankAccountId) throw new BadRequestException('bankAccountId is required.');
    return this.checks.listHistory(company(cid), bankAccountId);
  }

  @Post('print')
  print(
    @Headers('x-company-id') cid: string,
    @Body() body: { bankAccountId: string; startNumber: number; checkIds: string[] },
  ) {
    return this.checks.startPrintBatch(company(cid), body);
  }

  @Get('print/:batchId/pdf')
  async batchPdf(
    @Headers('x-company-id') cid: string,
    @Param('batchId') batchId: string,
  ): Promise<StreamableFile> {
    const buffer = await this.checks.batchPdf(company(cid), batchId);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="checks-${batchId.slice(0, 8)}.pdf"`,
    });
  }

  @Post('print/:batchId/confirm')
  confirm(
    @Headers('x-company-id') cid: string,
    @Param('batchId') batchId: string,
    @Body() body: { ok: boolean; reprintFromNumber?: number },
  ) {
    return this.checks.confirmBatch(company(cid), batchId, body);
  }

  @Post(':id/void')
  void(
    @Headers('x-company-id') cid: string,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.checks.voidCheck(company(cid), id, body?.reason ?? '');
  }

  @Get('alignment-test')
  async alignment(
    @Headers('x-company-id') cid: string,
    @Query('bankAccountId') bankAccountId: string,
  ): Promise<StreamableFile> {
    if (!bankAccountId) throw new BadRequestException('bankAccountId is required.');
    const buffer = await this.checks.alignmentPdf(company(cid), bankAccountId);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: 'inline; filename="alignment-test.pdf"',
    });
  }

  @Post('offsets')
  offsets(
    @Headers('x-company-id') cid: string,
    @Body() body: { bankAccountId: string; printOffsetX: number; printOffsetY: number },
  ) {
    return this.checks.setOffsets(company(cid), body.bankAccountId, {
      printOffsetX: body.printOffsetX,
      printOffsetY: body.printOffsetY,
    });
  }
}
```

- [ ] **Step 2: Write the module**

Create `api/src/checks/checks.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ChecksController } from './checks.controller';
import { ChecksService } from './checks.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [PrismaModule, LedgerModule],
  controllers: [ChecksController],
  providers: [ChecksService],
  exports: [ChecksService],
})
export class ChecksModule {}
```

- [ ] **Step 3: Register it**

In `api/src/app.module.ts`, add the import at the top:

```typescript
import { ChecksModule } from './checks/checks.module';
```

and add `ChecksModule,` to the `imports` array, immediately after `ExpensesModule,`.

- [ ] **Step 4: Verify it compiles and boots**

```bash
cd api && npm run typecheck && npm test
```

Expected: typecheck clean; all unit tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/src/checks/checks.controller.ts api/src/checks/checks.module.ts api/src/app.module.ts
git commit -m "feat(checks): endpoints and module registration"
```

---

## Task 8: Integration test for the uniqueness guarantee

**Files:**
- Modify: `api/test/integration/db-guarantees.int.mjs`

**Interfaces:**
- Consumes: the index from Task 3
- Produces: no exports; extends the existing integration suite

Read the existing file first to match its style — it boots its own Postgres via `embedded-postgres` and asserts triggers and RLS with raw SQL.

- [ ] **Step 1: Add the assertions**

Append a new section to `api/test/integration/db-guarantees.int.mjs`, following the existing helper conventions in that file (reuse whatever `assert`/`query` helpers it already defines rather than inventing new ones):

```javascript
// ---------------------------------------------------------------------------
// Check numbering: uniqueness is absolute and includes voided numbers.
// ---------------------------------------------------------------------------
{
  const companyId = COMPANY_A; // reuse the company id the suite already seeds
  const bankAccountId = await insertBankAccount(companyId);

  // A live check claims 1001.
  await insertCheck({ companyId, bankAccountId, checkNumber: 1001, status: 'printed' });

  // A second live check on 1001 must be rejected.
  let rejectedLive = false;
  try {
    await insertCheck({ companyId, bankAccountId, checkNumber: 1001, status: 'printed' });
  } catch {
    rejectedLive = true;
  }
  assert(rejectedLive, 'duplicate live check number must be rejected');

  // Void 1001, then try to reuse it — must STILL be rejected (spec 4.4).
  await query(`UPDATE "check" SET status = 'voided' WHERE "checkNumber" = 1001`);
  let rejectedVoided = false;
  try {
    await insertCheck({ companyId, bankAccountId, checkNumber: 1001, status: 'printed' });
  } catch {
    rejectedVoided = true;
  }
  assert(rejectedVoided, 'a voided check number must never be reissued');

  // The same number on a DIFFERENT bank account is fine.
  const otherBank = await insertBankAccount(companyId);
  await insertCheck({ companyId, bankAccountId: otherBank, checkNumber: 1001, status: 'printed' });

  // RLS: company B cannot see company A's checks.
  await setCompany(COMPANY_B);
  const visible = await query(`SELECT count(*)::int AS n FROM "check"`);
  assert(visible.rows[0].n === 0, 'RLS must hide another company\'s checks');
  await setCompany(COMPANY_A);
}
```

Define `insertBankAccount` and `insertCheck` as small local helpers next to the file's existing insert helpers, matching their signature style and using quoted camelCase columns.

- [ ] **Step 2: Run the integration suite**

Run: `cd api && npm run test:int`
Expected: PASS, including the four new assertions.

- [ ] **Step 3: Commit**

```bash
git add api/test/integration/db-guarantees.int.mjs
git commit -m "test(checks): prove absolute check-number uniqueness under RLS"
```

---

## Task 9: Web UI

**Files:**
- Create: `web/src/pages/Checks.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: the endpoints from Task 7; UI primitives from `web/src/components/ui`
- Produces: a `/checks` route

Use only the existing primitives — `Page`, `Card`, `Table`, `Button`, `Empty`, `Banner` from `../components/ui` — and `api.blobUrl` for PDFs. Do not add design tokens; the redesign's system is already in place.

- [ ] **Step 1: Write the page**

Create `web/src/pages/Checks.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, date } from '../lib/format';
import { Page, Card, Table, Button, Empty, Banner } from '../components/ui';

export default function Checks() {
  const { companyId } = useAuth();
  const qc = useQueryClient();
  const [bankAccountId, setBankAccountId] = useState('');
  const [startNumber, setStartNumber] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const banks = useQuery({
    queryKey: ['bank-accounts', companyId],
    enabled: !!companyId,
    queryFn: () => api.get('/banking/accounts'),
  });

  const queue = useQuery({
    queryKey: ['check-queue', companyId, bankAccountId],
    enabled: !!companyId && !!bankAccountId,
    queryFn: () => api.get(`/checks/queue?bankAccountId=${bankAccountId}`),
  });

  const history = useQuery({
    queryKey: ['check-history', companyId, bankAccountId],
    enabled: !!companyId && !!bankAccountId,
    queryFn: () => api.get(`/checks/history?bankAccountId=${bankAccountId}`),
  });

  const print = useMutation({
    mutationFn: () =>
      api.post('/checks/print', {
        bankAccountId,
        startNumber: Number(startNumber),
        checkIds: selected,
      }),
    onSuccess: async (r: any) => {
      setBatchId(r.printBatchId);
      setSelected([]);
      setErr('');
      qc.invalidateQueries({ queryKey: ['check-queue'] });
      const url = await api.blobUrl(`/checks/print/${r.printBatchId}/pdf`);
      window.open(url, '_blank');
    },
    onError: (e: any) => setErr(e.message),
  });

  const confirm = useMutation({
    mutationFn: (body: { ok: boolean; reprintFromNumber?: number }) =>
      api.post(`/checks/print/${batchId}/confirm`, body),
    onSuccess: (r: any) => {
      setBatchId(null);
      setErr(
        r.requeued > 0
          ? `✓ ${r.committed} committed, ${r.requeued} returned to the queue to reprint.`
          : `✓ ${r.committed} checks committed.`,
      );
      qc.invalidateQueries({ queryKey: ['check-queue'] });
      qc.invalidateQueries({ queryKey: ['check-history'] });
    },
    onError: (e: any) => setErr(e.message),
  });

  const voidCheck = useMutation({
    mutationFn: (id: string) => {
      const reason = window.prompt('Reason for voiding this check?') ?? '';
      if (!reason) throw new Error('A reason is required to void a check.');
      return api.post(`/checks/${id}/void`, { reason });
    },
    onSuccess: () => {
      setErr('✓ Check voided and the payment reversed.');
      qc.invalidateQueries({ queryKey: ['check-history'] });
    },
    onError: (e: any) => setErr(e.message),
  });

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  if (!companyId) {
    return <Page title="Print checks"><Empty>Select a company to get started.</Empty></Page>;
  }

  const rows = queue.data ?? [];

  return (
    <Page title="Print checks">
      <Banner text={err} />

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide">Bank account</span>
          <select
            value={bankAccountId}
            onChange={(e) => { setBankAccountId(e.target.value); setSelected([]); }}
            className="min-w-56"
          >
            <option value="">Select…</option>
            {(banks.data ?? []).map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.account?.code} {b.account?.name}
                {b.mask ? ` ••${b.mask}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide">Starting check number</span>
          <input
            value={startNumber}
            onChange={(e) => setStartNumber(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            placeholder="1001"
            className="w-32"
          />
        </label>
        <Button
          onClick={() => print.mutate()}
          disabled={!bankAccountId || !startNumber || selected.length === 0 || print.isPending}
        >
          Print {selected.length > 0 ? `${selected.length} ` : ''}checks
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            api.blobUrl(`/checks/alignment-test?bankAccountId=${bankAccountId}`)
              .then((u) => window.open(u, '_blank'))
              .catch((e) => setErr(e.message))
          }
          disabled={!bankAccountId}
        >
          Alignment test page
        </Button>
      </div>

      {batchId && (
        <Card title="Did the checks print correctly?">
          <p className="mb-3 text-sm">
            Confirm to commit these numbers. If the printer jammed, report the first
            check number that failed — those checks return to the queue and reprint
            with new numbers.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => confirm.mutate({ ok: true })}>Yes, they printed</Button>
            <Button
              variant="ghost"
              onClick={() => {
                const n = window.prompt('First check number that failed to print?');
                if (n) confirm.mutate({ ok: false, reprintFromNumber: Number(n) });
              }}
            >
              Report a misprint
            </Button>
          </div>
        </Card>
      )}

      <div className="mt-6">
        {rows.length === 0 ? (
          <Empty>
            {bankAccountId
              ? 'Nothing queued. Pay a bill with "print check later" to add one.'
              : 'Select a bank account to see its check queue.'}
          </Empty>
        ) : (
          <Table head={['', 'Payee', 'Date', 'Memo', 'Amount']}>
            {rows.map((c: any) => (
              <tr key={c.id}>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                </td>
                <td className="px-4 py-2">{c.payeeName}</td>
                <td className="px-4 py-2">{date(c.checkDate)}</td>
                <td className="px-4 py-2">{c.memo ?? ''}</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(c.amount)}</td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">History</h2>
        {(history.data ?? []).length === 0 ? (
          <Empty>No checks printed yet.</Empty>
        ) : (
          <Table head={['Number', 'Payee', 'Date', 'Amount', 'Status', '']}>
            {(history.data ?? []).map((c: any) => (
              <tr key={c.id}>
                <td className="px-4 py-2 font-mono">{c.checkNumber}</td>
                <td className="px-4 py-2">{c.payeeName}</td>
                <td className="px-4 py-2">{date(c.checkDate)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(c.amount)}</td>
                <td className="px-4 py-2">
                  {c.status === 'voided' ? `Voided (${c.voidReason ?? ''})` : 'Printed'}
                </td>
                <td className="px-4 py-2">
                  {c.status === 'printed' && (
                    <button
                      onClick={() => voidCheck.mutate(c.id)}
                      className="text-xs underline"
                    >
                      Void
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </Page>
  );
}
```

- [ ] **Step 2: Add the route**

In `web/src/App.tsx`:

1. Add the import next to the other page imports:

```tsx
import Checks from './pages/Checks';
```

2. Add a leaf to the `Banking` group's `children` array in `NAV`, after the `/reconcile` entry:

```tsx
{ to: '/checks', label: 'Print Checks', icon: <ReceiptText size={15} /> },
```

3. Add the route inside `<Routes>`, after the `/reconcile` route:

```tsx
<Route path="/checks" element={<Checks />} />
```

- [ ] **Step 3: Verify the build**

```bash
cd web && npx tsc --noEmit && npm run build
```

Expected: no type errors; `vite build` succeeds.

**Verified while planning:** `GET /banking/accounts` exists (`@Controller('banking/accounts')`, `bank-accounts.controller.ts:30`) and its rows `include: { account: { select: { code: true, name: true } } }`, so `b.account.code` / `b.account.name` and the optional `b.mask` are the correct label fields. `Page`, `Card`, `Table`, `Button`, `Empty`, and `Banner` are all exported from `web/src/components/ui.tsx`.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Checks.tsx web/src/App.tsx
git commit -m "feat(checks): print checks UI with queue, confirm, and history"
```

---

## Task 10: End-to-end verification

**Files:** none created; this is a verification gate.

- [ ] **Step 1: Full test suite**

```bash
cd api && npm test && npm run typecheck && npm run test:int
cd ../web && npx tsc --noEmit && npm run build
```

Expected: all green.

- [ ] **Step 2: Rebuild and restart the running stack**

```bash
cd /home/tcc-azure/openbooks && docker compose build api web && docker compose up -d
```

- [ ] **Step 3: Manual walkthrough against the live app**

Sign in at https://books.doogster.com and confirm, in order:

1. Pay a vendor bill with `printLater` set; the check appears in the queue.
2. Print the alignment test page; the grid renders and is labelled.
3. Print a two-check batch starting at 1001; the PDF has two pages, correct legal amounts, and stubs listing the right bills.
4. Report a misprint from 1002; check 1002 is voided and a fresh queued row appears, while 1001 stays committed.
5. Reprint the requeued check starting at 1003; it succeeds.
6. Try to print starting at 1001 again; it is rejected naming 1001.
7. Void a printed check; the bill returns to open and a reversing entry exists in the register.

- [ ] **Step 4: Update project memory**

Add a short entry to `CLAUDE.md` under "Architecture notes":

```markdown
- Check printing (`api/src/checks/`): vendor checks on pre-printed voucher
  stock. Numbers are per bank account and unique ABSOLUTELY — voided numbers
  are never reissued (paper is spent). "Void" means two things: a misprint
  burns the number only, a cancel also posts a reversing entry and reopens the
  bills. Payroll checks are NOT supported; a compliant paystub needs itemized
  deductions and `PayrollLine.employeeTaxes` is still one lump Decimal.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note check printing conventions in project memory"
```

---

## Self-Review Notes

**Spec coverage.** Every numbered spec section maps to a task: §3 architecture → Tasks 1, 2, 5, 6, 7; §4 data model → Task 3; §4.4 constraint → Tasks 3 and 8; §5 flow → Tasks 4, 6, 7; §5.2 both voids → Tasks 2, 6; §6 PDF and §6.1 amount-to-words → Tasks 5, 1; §7 UI → Task 9; §8 error handling → Tasks 6, 7; §9 testing → Tasks 1, 2, 8, 10; §11.1 stock measurement → Task 10 step 3.

**Known gap, deliberate:** spec §11.2 (backfilling `Payment.reference` with the check number) is **not** implemented. It was listed as optional and low-risk either way. Add it as a follow-up if the check number should appear in existing vendor statements.

**Type consistency:** `CheckError`, `amountToWords`, `allocateCheckNumbers`, `assertVoidable`, `VoidKind`, `VoidableCheck`, `CheckPdfData`, `buildCheckPdf`, `buildAlignmentTestPdf`, and `ChecksService` are each defined once and referenced with the same names and signatures in every later task.
