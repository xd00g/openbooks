# Feedback inbox — Accounting Team → Dev Team

The **OpenBooks Accounting Team** tests the running application and files findings
here. The **OpenBooks Dev Team** drains this file on each development pass, converts
entries into work, and records what happened.

This file is the contract between the two teams. Keep it in git so every finding has
history.

- App under test: <https://books.nebulys.net> (deployed from `tcc-linux-vm1`)
- Dev team cadence: one pass per hour; the inbox is triaged at the start of each pass
- Durable engineering rules live in [`CLAUDE.md`](../CLAUDE.md)

## How to file a finding (Accounting Team)

Add an entry to **Open** below. Copy the template, fill it in, commit. One finding per
entry — don't batch several problems into one, they get triaged and fixed separately.

The two fields that matter most are **Expected** and **Actual**. This is accounting
software: "the number is wrong" is only actionable if we know what the number should
have been and why.

```markdown
### OB-000 — <one-line summary>

- **Filed:** YYYY-MM-DD by <name>
- **Severity:** P0 | P1 | P2 | P3
- **Area:** invoicing | bills/AP | banking | reconciliation | reports | payroll | checks | admin/permissions | other
- **Steps to reproduce:**
  1. …
  2. …
- **Expected:** <the correct behaviour or the correct number, and the accounting reason>
- **Actual:** <what happened, verbatim — exact figures, exact error text>
- **Evidence:** <screenshot path, invoice/entry ID, date range, company name>
- **Blocking?** <can you keep testing, or does this stop a workflow?>
```

### Severity

Pick by *consequence*, not by how annoying it is.

| | Meaning | Examples |
|---|---|---|
| **P0** | Wrong numbers, lost data, or a cross-company data leak | Balance sheet doesn't balance; a posted entry changed; you can see another company's data |
| **P1** | A core workflow is blocked or a common task is impossible | Can't record a payment; invoice PDF won't generate; reconciliation won't lock |
| **P2** | Works, but wrong enough to cause rework | Aging buckets off by a day; sort order resets; confusing validation error |
| **P3** | Cosmetic or nice-to-have | Label wording, spacing, column widths |

**Anything that produces a wrong number is at least P1, even if it looks small.** A
rounding discrepancy of one cent is a P1, not a P3 — it means a rule is wrong
somewhere, and it will not stay one cent.

Don't worry about getting severity exactly right. Dev team re-triages; an honest guess
is enough.

### Useful but optional

If you can, note whether the problem reproduces on a **fresh company** with a clean
chart of accounts, versus only on your existing test data. That single fact usually
halves the debugging time.

## How this gets drained (Dev Team)

Each pass:

1. Read every entry under **Open**.
2. Re-triage severity, and move the entry to **Accepted**, **Needs info**, or **Won't fix**.
3. For accepted findings, add a regression test *first* where the finding is about a
   number — the pure-logic suite (`api/src/**/__tests__`) is the right home for
   accounting rules, per `CLAUDE.md`.
4. Move the entry to **Resolved** with the fixing commit SHA, and say what changed.
5. Never delete an entry. History is the point.

Findings that touch the ledger get a reversing-entry fix, never an edit to a posted
entry — the DB triggers enforce this and will reject anything else.

---

## Open

_(Accounting Team: add new findings here. Nothing filed yet.)_

## Needs info

_(Dev team moves entries here when reproduction steps or expected values are unclear.)_

## Accepted — in progress

_(Triaged and being worked. Includes the assigned severity and the pass that picked it up.)_

## Resolved

_(Fixed and verified. Each entry keeps its commit SHA so the fix is traceable.)_

## Won't fix / by design

_(With the reasoning. Sometimes the accounting rule genuinely requires the surprising
behaviour — when that happens, the fix is usually a docs or UI-copy change instead.)_
