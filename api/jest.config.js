/**
 * Jest config for the OpenBooks API.
 *
 * The unit suite covers the PURE accounting/auth logic (no DB, no network), so
 * it runs anywhere in milliseconds and is the gate on every commit. ts-jest
 * runs in isolatedModules (transpile-only) mode so a test never drags in the
 * Prisma client or other I/O modules it doesn't import.
 *
 * Integration tests that need Postgres/Redis can live under test/ later and run
 * in a separate CI job with services; keep them out of this fast unit lane.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {}],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
  // Coverage is scoped to the pure logic these specs exercise, so enabling
  // --coverage never tries to load an I/O module for a 0% report.
  collectCoverageFrom: [
    'src/ledger/money.ts',
    'src/ledger/ledger.types.ts',
    'src/posting/posting.builders.ts',
    'src/accounts/coa-template.ts',
    'src/reporting/reporting.builders.ts',
    'src/reporting/reporting.types.ts',
    'src/reporting/aging.builders.ts',
    'src/banking/reconciliation.logic.ts',
    'src/banking/bankfeed/bankfeed.logic.ts',
    'src/period/period-close.logic.ts',
    'src/documents/document.logic.ts',
    'src/auth/crypto/*.ts',
    'src/auth/authz.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov'],
};
