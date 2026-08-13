import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  isKnownPermission,
  SYSTEM_ROLES,
} from '../permissions.catalog';

const SRC = resolve(__dirname, '../..');

/** Every *.controller.ts under api/src, recursively. */
function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...controllerFiles(full));
    } else if (entry.endsWith('.controller.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every string passed to @RequirePermissions(...) across all controllers.
 * Returns both the extracted permissions and any non-literal arguments.
 * Non-literals (constants, expressions) cannot be statically verified, so we
 * collect them and fail with a clear message if any are found.
 */
function enforcedPermissions(): {
  permissions: Set<string>;
  nonLiterals: Array<{ file: string; text: string }>;
} {
  const permissions = new Set<string>();
  const nonLiterals: Array<{ file: string; text: string }> = [];

  for (const file of controllerFiles(SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/@RequirePermissions\(([^)]*)\)/g)) {
      const argText = m[1];

      // Extract single-quoted strings
      for (const s of argText.matchAll(/'([^']+)'/g)) {
        permissions.add(s[1]);
      }

      // Extract double-quoted strings
      for (const s of argText.matchAll(/"([^"]+)"/g)) {
        permissions.add(s[1]);
      }

      // Check for non-literal arguments: anything that isn't just quoted
      // strings separated by commas/whitespace (multiple permissions, e.g.
      // @RequirePermissions('a:manage', 'b:manage'), are legitimate).
      const withoutQuotes = argText
        .replace(/'[^']+'/g, '')
        .replace(/"[^"]+"/g, '')
        .replace(/[\s,]/g, '');
      if (withoutQuotes.length > 0) {
        nonLiterals.push({ file, text: argText.trim() });
      }
    }
  }

  return { permissions, nonLiterals };
}

describe('permission catalog integrity', () => {
  it('has unique keys', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it('gives every entry a label, description and group', () => {
    for (const p of PERMISSION_CATALOG) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.group.length).toBeGreaterThan(0);
    }
  });

  it('uses only resource:action keys', () => {
    for (const key of PERMISSION_KEYS) {
      expect(key).toMatch(/^[a-z]+:[a-z]+$/);
    }
  });

  it('does not list the * wildcard as a grantable permission', () => {
    expect(PERMISSION_KEYS).not.toContain('*');
  });

  it('recognises known keys and rejects unknown ones', () => {
    expect(isKnownPermission('sales:manage')).toBe(true);
    expect(isKnownPermission('invoice:create')).toBe(false);
  });

  it('marks the irreversible actions as high risk', () => {
    const high = PERMISSION_CATALOG.filter((p) => p.risk === 'high').map((p) => p.key);
    expect(high).toEqual(
      expect.arrayContaining([
        'period:close',
        'payroll:run',
        'checks:print',
        'checks:void',
        'company:delete',
      ]),
    );
  });
});

describe('catalog matches enforcement', () => {
  it('discovers a non-zero set of controllers', () => {
    const controllers = controllerFiles(SRC);
    expect(controllers.length).toBeGreaterThan(0);
  });

  it('detects non-literal @RequirePermissions arguments and fails', () => {
    const { nonLiterals } = enforcedPermissions();
    if (nonLiterals.length > 0) {
      const msg = nonLiterals
        .map((nl) => `  ${nl.file}: @RequirePermissions(${nl.text})`)
        .join('\n');
      throw new Error(
        `Found non-literal permission arguments that cannot be verified:\n${msg}\n\nUse string literals (single or double quoted) so the drift test can extract and verify them.`,
      );
    }
    expect(nonLiterals).toEqual([]);
  });

  it('has no phantom enforcement: every decorator permission is in the catalog', () => {
    const { permissions } = enforcedPermissions();
    const unknown = [...permissions].filter((p) => !isKnownPermission(p));
    expect(unknown).toEqual([]);
  });

  it('has no phantom offers: every catalog permission is enforced somewhere', () => {
    const { permissions: enforced } = enforcedPermissions();
    const unenforced = PERMISSION_KEYS.filter((k) => !enforced.has(k));
    expect(unenforced).toEqual([]);
  });
});

describe('system roles', () => {
  it('grants Owner full access', () => {
    expect(SYSTEM_ROLES[0].name).toBe('Owner');
    expect(SYSTEM_ROLES[0].permissions).toEqual(['*']);
  });

  it('references only real permissions (or the wildcard)', () => {
    for (const role of SYSTEM_ROLES) {
      for (const p of role.permissions) {
        if (p === '*') continue;
        expect(isKnownPermission(p)).toBe(true);
      }
    }
  });

  it('grants Accountant exactly the expected permission set', () => {
    // Accountant is a deliberate literal allow-list (see the comment above
    // its definition in permissions.catalog.ts), not a filter over
    // PERMISSION_KEYS. That means adding a permission to PERMISSION_CATALOG
    // does NOT automatically reach Accountant — this test pins the exact
    // array so that any catalog addition trips this assertion instead of
    // silently doing nothing (the old failure mode) or silently granting
    // everything (the even older failure mode, before this refactor).
    //
    // If this test just failed because you added a new permission to
    // PERMISSION_CATALOG: that is the point. Decide whether Accountant
    // should get the new permission, then update the literal `permissions`
    // array on the Accountant entry in permissions.catalog.ts to match your
    // decision, and update the expected array below to match.
    const acct = SYSTEM_ROLES.find((r) => r.name === 'Accountant')!;
    expect(acct.permissions).toEqual([
      'company:manage',
      'account:manage',
      'settings:manage',
      'sales:manage',
      'expenses:manage',
      'banking:manage',
      'banking:reconcile',
      'checks:manage',
      'attachments:manage',
      'reports:view',
      'payroll:view',
      'attachments:view',
      'audit:view',
      'period:close',
      'payroll:manage',
      'payroll:run',
      'checks:print',
      'checks:void',
    ]);

    // Keep this explicit even though the exact-array check above subsumes
    // it: it states the security intent directly, without requiring a
    // reader to diff two 18-entry arrays to notice it holds.
    expect(acct.permissions).not.toContain('user:manage');
    expect(acct.permissions).not.toContain('system:manage');
  });

  it('forces a decision about Accountant when the catalog grows', () => {
    // The exact-array test above pins what Accountant holds today, but on its
    // own it does NOT bite when a permission is ADDED to the catalog: the
    // literal list simply stays as it was and the assertion still passes. That
    // fails closed, which is safe, but it is silent — nobody is prompted to
    // decide whether the new capability belongs to Accountant.
    //
    // This test closes that gap. Every catalog key must be either granted to
    // Accountant or listed in DELIBERATELY_WITHHELD below. A new key is in
    // neither, so this goes red and names it.
    const DELIBERATELY_WITHHELD = [
      'user:manage', // Accountant keeps the books; it does not administer people.
      'system:manage', // SSO/SMTP config is an operator concern, not an accounting one.
      // Destroying a company file is an ownership decision, not a bookkeeping
      // one, and it is unrecoverable without a database restore. Owner only.
      'company:delete',
    ];

    const acct = SYSTEM_ROLES.find((r) => r.name === 'Accountant')!;
    const unclassified = PERMISSION_KEYS.filter(
      (k) => !acct.permissions.includes(k) && !DELIBERATELY_WITHHELD.includes(k),
    );

    if (unclassified.length > 0) {
      throw new Error(
        `New permission(s) not yet classified for the Accountant role: ` +
          `${unclassified.join(', ')}.\n\n` +
          `Decide whether Accountant should hold each one, then either add it ` +
          `to the Accountant permissions array in permissions.catalog.ts (and ` +
          `to the expected array in the test above), or add it to ` +
          `DELIBERATELY_WITHHELD here with a one-line reason.`,
      );
    }
    expect(unclassified).toEqual([]);
  });

  it('keeps Bookkeeper away from the irreversible actions', () => {
    const bk = SYSTEM_ROLES.find((r) => r.name === 'Bookkeeper')!;
    for (const denied of ['period:close', 'checks:print', 'checks:void', 'payroll:run', 'payroll:manage']) {
      expect(bk.permissions).not.toContain(denied);
    }
  });

  it('gives Read-only nothing but view permissions', () => {
    const ro = SYSTEM_ROLES.find((r) => r.name === 'Read-only')!;
    for (const p of ro.permissions) expect(p.endsWith(':view')).toBe(true);
  });

  it('grants Bookkeeper attachments:manage but keeps Read-only off it', () => {
    const bk = SYSTEM_ROLES.find((r) => r.name === 'Bookkeeper')!;
    expect(bk.permissions).toContain('attachments:manage');
    const ro = SYSTEM_ROLES.find((r) => r.name === 'Read-only')!;
    expect(ro.permissions).not.toContain('attachments:manage');
  });

  it('uses unique role names', () => {
    const names = SYSTEM_ROLES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
