# Vendor Check Printing — Design

**Date:** 2026-07-30
**Status:** Approved, ready for implementation planning
**Scope:** Printing checks for vendor/bill payments on pre-printed check stock

---

## 1. Purpose

OpenBooks records vendor payments (`POST /expenses/payments` → `payBills`) but
cannot produce a physical check. This adds a print queue, an auditable check
number sequence, and a PDF laid out for pre-printed voucher check stock.

**Success criteria:**

- A user can pay bills, queue the payments for printing, print a batch to PDF,
  and confirm or reprint after a paper jam without corrupting the number sequence.
- Check numbers are unique per bank account, enforced by the database.
- A voided check reverses its ledger impact without mutating posted entries.
- Amount-to-words is correct for every value the system can represent.

---

## 2. Decisions made during brainstorming

| Decision | Choice | Rationale |
|---|---|---|
| Check stock | **Pre-printed** | No MICR E-13B font licensing, no magnetic toner, no bank-rejection risk. App prints variable data only. |
| Check types | **Vendor only** | Payroll paystubs require itemized deductions (e.g. California Labor Code §226); `PayrollLine.employeeTaxes` is a single lump Decimal today. Payroll checks wait for the tax-itemization project. |
| Workflow | **Queue + confirm** | Batch printing with a post-print confirmation step is the only model that survives a paper jam. |
| Signature | **Blank ruled line** | No signature image is stored, so a DB/backup/MinIO leak cannot yield forgeable signed checks. |
| Format | **Check-on-top voucher** | Standard for A/P; stub below lists the bills paid. |

---

## 3. Architecture

New module `api/src/checks/`, following the pure-logic/IO split required by
CLAUDE.md:

```
api/src/checks/
  check.logic.ts               pure: number allocation, gap rules, amount-to-words
  check-pdf.ts                 pdfkit layout (mirrors sales/invoice-pdf.ts)
  checks.service.ts            I/O, RLS-scoped via prisma.forCompany
  checks.controller.ts         HTTP endpoints
  checks.module.ts             Nest wiring
  __tests__/check.logic.spec.ts
```

**Why the split matters here:** amount-to-words is deceptively bug-prone —
zero, teens, hundred boundaries, millions, and the cents fraction all have
edge cases. It must be a pure, unit-tested function, never inlined into PDF
drawing code.

Module depends on: `PrismaService`, `LedgerService` (for void reversals),
`AccountResolverService` (bank account → GL account).

---

## 4. Data model

### 4.1 New model

```prisma
model Check {
  id            String    @id @default(uuid()) @db.Uuid
  companyId     String    @db.Uuid
  bankAccountId String    @db.Uuid
  paymentId     String    @unique @db.Uuid
  checkNumber   Int?                                  // null until print confirmed
  status        String    @default("queued")          // queued | printed | voided
  payeeName     String                                // snapshot at print time
  amount        Decimal   @db.Decimal(19, 4)          // snapshot at print time
  checkDate     DateTime  @db.Date
  memo          String?
  printBatchId  String?   @db.Uuid
  printedAt     DateTime?
  voidedAt      DateTime?
  voidReason    String?                               // 'misprint' | free text; see §5.2
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  company     Company     @relation(fields: [companyId], references: [id], onDelete: Cascade)
  bankAccount BankAccount @relation(fields: [bankAccountId], references: [id])
  payment     Payment     @relation(fields: [paymentId], references: [id])

  @@index([companyId, bankAccountId, status])
  @@map("check")
}
```

### 4.2 Fields added to `BankAccount`

```prisma
nextCheckNumber Int?    // next number to suggest; user may override per batch
printOffsetX    Int  @default(0)   // alignment nudge, hundredths of an inch
printOffsetY    Int  @default(0)
```

### 4.3 Why `payeeName` and `amount` are snapshots

They are copied onto the `Check` row rather than joined from `Vendor`/`Payment`
at render time. If a vendor is renamed a year later, the historical check must
still show what was physically printed. This mirrors the immutable-ledger
principle already in force.

### 4.4 Integrity constraint

A partial unique index, added to
`api/prisma/sql/accounting_core_constraints.sql` alongside the existing ledger
triggers:

```sql
CREATE UNIQUE INDEX check_number_unique_per_account
  ON "check" ("companyId", "bankAccountId", "checkNumber")
  WHERE "checkNumber" IS NOT NULL;
```

Enforcement lives in the database, not only in application code — consistent
with how balance and immutability are enforced. Note the table name `check` is
a SQL reserved word and must be quoted in all raw SQL.

**Uniqueness is absolute — voided numbers are never reissued.** The index
deliberately does *not* exclude `status='voided'`. Once a number has been
printed onto physical paper it is spent, whether that paper was cashed, jammed,
or shredded. Allowing reuse would put two physical checks bearing the same
number into circulation, which is ambiguous on a bank statement and defeats
reconciliation.

Gaps in the sequence are therefore permitted and expected, and voided rows are
**retained** so the sequence stays auditable. A missing number with no row is a
red flag; a missing number with a voided row is explained.

---

## 5. Flow

```
POST /expenses/payments  { printLater: true }   → Payment + Check(queued, no number)
GET  /checks/queue?bankAccountId=…              → queued checks for that account
POST /checks/print       { bankAccountId, startNumber, checkIds[] }
                                                → PDF; batch marked printed with
                                                  tentative numbers
POST /checks/print/:batchId/confirm { ok, reprintFromNumber? }
                                                → commit numbers, or void the
                                                  tentative ones and requeue
POST /checks/:id/void    { reason }             → reversing journal entry
GET  /checks/alignment-test?bankAccountId=      → single calibration page
```

### 5.1 Number assignment timing

Numbers are assigned when the batch is generated (so they can be printed) but
are only **committed** on confirm. If the user reports a misprint, the tentative
numbers are marked voided and the affected checks return to `queued`, to be
reprinted from a new starting number.

### 5.2 Two distinct operations both called "void"

Conflating these is the classic defect in check-printing implementations.

Both land on `status='voided'`; **`voidReason` is what distinguishes them**, and
the two paths differ entirely in ledger impact. Neither reissues the number
(§4.4).

**Misprint** — paper jam or misfeed, reported at the confirm step.
The check *number* is burned (row retained, `status='voided'`,
`voidReason='misprint'`). The `Payment` and its journal entry are untouched.
The bills stay paid. Reprinting draws a fresh number.
**No GL impact.**

**True void** — the check was issued but never cleared and is being cancelled.
Posts a **reversing journal entry** via `LedgerService` per the immutable-ledger
rule, un-applies the `PaymentApplication` rows so the bills return to open, and
marks the check `voided`. The original entry is never edited or deleted.
**GL impact.**

---

## 6. PDF layout

US Letter, 8.5″ × 11″, portrait. Coordinates in PDF points (72/inch).

```
┌──────────────────────────────────────┐  y=0
│  CHECK PORTION                       │
│    date, payee, numeric amount,      │
│    written amount, memo,             │  check region: top 3.5" (252pt)
│    blank ruled signature line        │
├──────────────────────────────────────┤  y=252
│  STUB — bills paid                   │
│    vendor, check date, check number  │
│    table: bill #, bill date, amount  │  remaining 7.5"
│    total                             │
└──────────────────────────────────────┘
```

- Nothing is drawn in the pre-printed zones (MICR band, bank name, company
  address, routing/account numbers).
- Every coordinate is offset by the bank account's `printOffsetX/Y`.
- The alignment test page prints a labelled grid plus a specimen check outline
  so the user can measure and set the offsets.
- Typography follows `sales/invoice-pdf.ts`: Helvetica/Helvetica-Bold, with the
  ledger green `#0b3d2e` for headings.
- If more bills are paid than fit on one stub, the stub prints the first N rows
  and a `"… and X more — see payment detail"` line. Check stock is one page per
  check; overflow must never push content onto a second sheet.

### 6.1 Amount-to-words

Pure function in `check.logic.ts`:

```
1240.00  → "One thousand two hundred forty and 00/100"
0.05     → "Zero and 05/100"
1000000  → "One million and 00/100"
```

Required test coverage: zero; cents-only; teens (13, 19); the 20–99 hyphen
boundary; exact hundreds; thousand/million boundaries; the maximum value
`Decimal(19,4)` permits. Reject negative amounts — a negative check is not a
thing.

---

## 7. Web UI

New page `web/src/pages/Checks.tsx`, routed at `/checks` under the existing
**Banking** nav group in `App.tsx`.

Built on the primitives from the 2026-07-30 redesign: hairline `Table`, `Card`,
IBM Plex Mono for check numbers and amounts, `Banner` for status messages. No
new design tokens.

Screens:

1. **Queue** — bank account selector, table of queued checks (payee, date,
   amount), multi-select, starting check number input, "Print checks" action.
2. **Confirmation** — after the PDF opens: "Did the checks print correctly?"
   with confirm / report-misprint. Misprint asks which number printing failed
   from.
3. **History** — printed and voided checks with number, payee, amount, status.
   Void action with a reason prompt.
4. **Alignment** — offset fields and a "print test page" action, reachable from
   the bank account settings.

---

## 8. Error handling

| Condition | Response |
|---|---|
| Duplicate check number (index violation) | 409 with the conflicting number |
| Bank account has no `nextCheckNumber` set | 400, prompt to set a starting number |
| Print with an empty selection | 400 |
| Confirm an already-confirmed batch | 200, idempotent no-op |
| Void an already-voided check | 409 |
| Void a check whose payment is already reversed | 409 |
| Amount ≤ 0 reaching the PDF builder | throw in `check.logic.ts`, never render |

---

## 9. Testing

**Unit** (`check.logic.spec.ts`, no DB — runs in `npm test`):

- Number allocation across a batch, including a non-contiguous start.
- Misprint requeue produces a fresh, non-colliding range.
- Amount-to-words: the full edge-case list from §6.1.
- Void rules: misprint leaves payment intact; true void requires a reversal.

**Integration** (extends `test/integration/db-guarantees.int.mjs`):

- The partial unique index rejects a duplicate number, **including reuse of a
  voided one** (§4.4).
- RLS: a check created under company A is invisible to company B.

**Manual:** print an alignment page, verify offsets against real stock, print a
two-check batch, confirm the numbers commit.

---

## 10. Out of scope

Deliberately excluded, with the reason:

- **MICR encoding / blank stock** — pre-printed stock chosen; would add font
  licensing, magnetic toner, and bank-rejection risk.
- **Payroll checks and paystubs** — blocked on tax itemization (§2).
- **Stored signature images** — rejected on forgery risk.
- **ACH / direct deposit** — unrelated payment rail.
- **Check reconciliation against bank feed** — existing reconciliation module
  already handles matching; no check-specific work needed.

---

## 11. Open questions for implementation

None blocking. Two items to confirm while building:

1. Exact check region height varies slightly by stock vendor (3.5″ is the
   common standard). The alignment test page exists to absorb this; verify
   against the user's actual stock before finalizing default coordinates.
2. ~~Whether `Payment.reference` should be backfilled with the check number on
   confirm.~~ **Decided 2026-07-30: yes.** Committing a check stamps
   `Payment.reference` with `Check <number>`, so the number surfaces in vendor
   statements (which render `p.reference ?? p.method ?? 'Payment'`). Misprinted
   numbers are never stamped; a reprint overwrites with its new number.
